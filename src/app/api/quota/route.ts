import { NextResponse } from "next/server";
import { COSTS, CREDIT_SERVICES, type CreditService } from "@/config/credits";
import { getOrCreateSession, getQuota } from "@/server/credits";

interface UsedTotal {
  used: number;
  total: number;
}

/**
 * Quota snapshot for the lab top bar (ticket 16 owns the full credit UI).
 * Shape:
 * {
 *   chat: {used, total}, image: {...}, threed: {...},
 *   paid,
 *   warnings: {chat, image, threed},   // ticket-05 20% rule
 *   locked:   {chat, image, threed}    // free quota gone + paid can't cover
 * }
 *
 * warnings[kind] — free quota at/below 20% remaining with some use already
 * made (the `used > 0` guard keeps a fresh threed grant of 1 from warning
 * on arrival). locked[kind] — free quota exhausted AND the paid pool cannot
 * cover the kind's cost. Derived here so the credit UI stays dumb.
 */
export async function GET() {
  const sessionId = await getOrCreateSession();
  const quota = await getQuota(sessionId);

  const out: Record<CreditService, UsedTotal> & {
    paid: number;
    warnings: Record<CreditService, boolean>;
    locked: Record<CreditService, boolean>;
  } = {
    chat: { used: 0, total: 0 },
    image: { used: 0, total: 0 },
    threed: { used: 0, total: 0 },
    mold: { used: 0, total: 0 },
    paid: 0,
    warnings: { chat: false, image: false, threed: false, mold: false },
    locked: { chat: false, image: false, threed: false, mold: false },
  };
  for (const kind of CREDIT_SERVICES) {
    const q = quota[kind];
    out[kind] = {
      used: q.freeGrant - q.freeRemaining,
      total: q.freeGrant,
    };
    out.paid = q.paidBalance;
    out.warnings[kind] =
      q.freeGrant - q.freeRemaining > 0 &&
      q.freeRemaining > 0 &&
      q.freeRemaining <= Math.ceil(q.freeGrant * 0.2);
    out.locked[kind] =
      q.freeRemaining <= 0 && q.paidBalance < COSTS[kind];
  }

  return NextResponse.json(out);
}
