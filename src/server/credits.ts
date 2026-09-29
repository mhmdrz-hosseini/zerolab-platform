import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import "server-only";
import { getDb } from "@/db";
import { creditLedger, sessions } from "@/db/schema";
import { COSTS, FREE_GRANT, type CreditService } from "@/config/credits";

const SESSION_COOKIE = "zl_sid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Thrown when both the per-kind free quota and the paid pool are exhausted.
 * Routes should map it to HTTP 402 with the Persian wall copy (ticket 16).
 */
export class InsufficientCreditsError extends Error {
  readonly kind: CreditService;
  constructor(kind: CreditService) {
    super(`Insufficient credits for: ${kind}`);
    this.name = "InsufficientCreditsError";
    this.kind = kind;
  }
}

export interface QuotaSnapshot {
  kind: CreditService;
  freeGrant: number;
  /** FREE_GRANT[kind] minus consumed free rows. */
  freeRemaining: number;
  /** Sum of paid-ledger deltas (purchased credits, never negative here). */
  paidBalance: number;
  /** How many uses of this kind the paid balance still covers. */
  paidAffordable: number;
}

export interface CreditMovement {
  ledgerId: string;
  source: "free" | "paid";
  cost: number;
}

/**
 * Free-quota model (issue 05): the grant itself is implicit in FREE_GRANT;
 * each free use appends one ledger row with source='free', so
 * remaining = FREE_GRANT[kind] - count(rows with source='free', reason=kind).
 * Paid credits are a plain pool: balance = sum(delta) over source='paid' rows.
 */
export async function getOrCreateSession(): Promise<string> {
  const jar = await cookies();
  const db = getDb();
  const existing = jar.get(SESSION_COOKIE)?.value;

  if (existing && isUuid(existing)) {
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, existing))
      .limit(1);
    if (rows.length > 0) return existing;
    // DB was reset while the cookie survived — reuse the id so the client
    // keeps a stable identity (fresh anonymous quota either way).
    await db
      .insert(sessions)
      .values({ id: existing, ipHash: await hashIp() })
      .onConflictDoNothing();
    return existing;
  }

  const id = randomUUID();
  await db.insert(sessions).values({ id, ipHash: await hashIp() });
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return id;
}

export async function getQuota(
  sessionId: string,
): Promise<Record<CreditService, QuotaSnapshot>> {
  const db = getDb();
  const freeUsed = await db
    .select({
      reason: creditLedger.reason,
      used: sql<number>`count(*)::int`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.sessionId, sessionId),
        eq(creditLedger.source, "free"),
      ),
    )
    .groupBy(creditLedger.reason);

  const paidRows = await db
    .select({
      balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.sessionId, sessionId),
        eq(creditLedger.source, "paid"),
      ),
    );
  const paidBalance = Number(paidRows[0]?.balance ?? 0);

  const usedByKind = new Map(
    freeUsed.map((r) => [r.reason as CreditService, Number(r.used)]),
  );

  const out = {} as Record<CreditService, QuotaSnapshot>;
  for (const kind of Object.keys(COSTS) as CreditService[]) {
    const freeGrant = FREE_GRANT[kind];
    const cost = COSTS[kind];
    out[kind] = {
      kind,
      freeGrant,
      freeRemaining: Math.max(0, freeGrant - (usedByKind.get(kind) ?? 0)),
      paidBalance: Math.max(0, paidBalance),
      paidAffordable:
        cost > 0 ? Math.floor(Math.max(0, paidBalance) / cost) : 0,
    };
  }
  return out;
}

/** Spend one use of `kind`: free quota first, then the paid pool. */
export async function consume(
  sessionId: string,
  kind: CreditService,
  ref?: string,
): Promise<CreditMovement> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Serialize concurrent spends per session (cheap row lock).
    await tx.execute(sql`select id from sessions where id = ${sessionId} for update`);

    const freeRows = await tx
      .select({ used: sql<number>`count(*)::int` })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.sessionId, sessionId),
          eq(creditLedger.source, "free"),
          eq(creditLedger.reason, kind),
        ),
      );
    const freeRemaining =
      FREE_GRANT[kind] - Number(freeRows[0]?.used ?? 0);

    if (freeRemaining > 0) {
      const [row] = await tx
        .insert(creditLedger)
        .values({
          sessionId,
          delta: -1,
          source: "free",
          reason: kind,
          ref: ref ?? null,
        })
        .returning({ id: creditLedger.id });
      return { ledgerId: row.id, source: "free" as const, cost: 1 };
    }

    const paidRows = await tx
      .select({
        balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int`,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.sessionId, sessionId),
          eq(creditLedger.source, "paid"),
        ),
      );
    const balance = Number(paidRows[0]?.balance ?? 0);
    const cost = COSTS[kind];
    if (balance < cost) throw new InsufficientCreditsError(kind);

    const [row] = await tx
      .insert(creditLedger)
      .values({
        sessionId,
        delta: -cost,
        source: "paid",
        reason: kind,
        ref: ref ?? null,
      })
      .returning({ id: creditLedger.id });
    return { ledgerId: row.id, source: "paid" as const, cost };
  });
}

/**
 * Undo a spend when the upstream provider failed after the credit was taken.
 * Free quota is row-counted, so the failed row is removed; paid spends get a
 * compensating positive ledger row.
 */
export async function refund(
  sessionId: string,
  movement: CreditMovement,
  ref?: string,
): Promise<void> {
  const db = getDb();
  if (movement.source === "free") {
    await db
      .delete(creditLedger)
      .where(
        and(
          eq(creditLedger.id, movement.ledgerId),
          eq(creditLedger.sessionId, sessionId),
        ),
      );
    return;
  }
  await db.insert(creditLedger).values({
    sessionId,
    delta: movement.cost,
    source: "paid",
    reason: "refund",
    ref: ref ?? null,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function hashIp(): Promise<string | null> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}
