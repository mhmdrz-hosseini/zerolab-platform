import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { images } from "@/db/schema";
import { getOrCreateSession } from "@/server/credits";
import { getStorage } from "@/server/storage";

/**
 * Library listing API (ticket 15).
 *
 * GET /api/library?tab=all|mine&category=<slug>&q=<text>
 * - `all`  → public seed rows (is_seed = true) of every session.
 * - `mine` → this session's images (kind generated/uploaded/saved/standardized,
 *   never seeds). Seeds carry their title/category/description/seedPrompt in
 *   the `meta` jsonb (issue 08 decision).
 * - `q` searches title/description; «مولد»/«مالد» normalize as synonyms of
 *   «قالب فوندانت» (issues 03 + 08).
 */

/** 7-category taxonomy (issues 03 + 08) — hand-synced twin in LibraryDrawer.tsx and the other library routes. */
const CATEGORIES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "confectionery", label: "قنادی و خوراکی" },
  { slug: "resin", label: "رزین و زیورآلات" },
  { slug: "candle", label: "شمع" },
  { slug: "soap", label: "صابون و بهداشتی" },
  { slug: "plaster", label: "گچ، بتن و پودر سنگ" },
  { slug: "figures", label: "فیگور و مینیاتور" },
  { slug: "keepsake", label: "یادگاری و سفارشی" },
];

const MINE_KINDS = [
  "generated",
  "uploaded",
  "saved",
  "standardized",
] as const;

const FONDANT = "قالب فوندانت";

/** Persian-tolerant normalization: Arabic yeh/kaf → Persian, ZWNJ → space. */
function normalizePersian(value: string): string {
  return value
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * «مولد» (و نگارش «مالد») با هر پسوندی به «قالب فوندانت» بازمی‌نگارد تا
 * جست‌وجوی کاربر با متادیتای فارسی seedها هم‌معنا شود. Same replacement must
 * run over the haystack — see matchesQuery.
 */
function expandSynonyms(value: string): string {
  return normalizePersian(value).replace(/(?:مولد|مالد)\S*/g, FONDANT);
}

/** Every query token must appear in the (equally expanded) haystack. */
function matchesQuery(haystack: string, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return true;
  const hay = expandSynonyms(haystack);
  return queryTokens.every((token) => hay.includes(token));
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** First ~40 chars of a prompt, as a display title for untitled generations. */
function titleFromPrompt(prompt: string | null): string | null {
  if (!prompt) return null;
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
}

interface LibraryItemDto {
  id: string;
  title: string;
  category: string | null;
  categoryLabel: string | null;
  description: string;
  seedPrompt: string | null;
  url: string;
  kind: string;
  isSeed: boolean;
  createdAt: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") === "mine" ? "mine" : "all";
  const categoryParam = (url.searchParams.get("category") ?? "").trim();
  const category = CATEGORIES.some((c) => c.slug === categoryParam)
    ? categoryParam
    : null;
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);

  const sessionId = await getOrCreateSession();
  const db = getDb();

  const conditions = [];
  if (tab === "all") {
    conditions.push(eq(images.isSeed, true));
  } else {
    conditions.push(eq(images.sessionId, sessionId));
    conditions.push(eq(images.isSeed, false));
    conditions.push(inArray(images.kind, [...MINE_KINDS]));
  }
  if (category) {
    conditions.push(sql`${images.meta} ->> 'category' = ${category}`);
  }

  const rows = await db
    .select()
    .from(images)
    .where(and(...conditions))
    .orderBy(desc(images.createdAt))
    .limit(200);

  const storage = getStorage();
  const queryTokens = q ? expandSynonyms(q).split(" ").filter(Boolean) : [];

  const items: LibraryItemDto[] = [];
  for (const row of rows) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const categorySlug = metaString(meta, "category");
    const known = CATEGORIES.find((c) => c.slug === categorySlug);
    const title =
      metaString(meta, "title") ??
      titleFromPrompt(metaString(meta, "prompt")) ??
      (row.isSeed ? "طرح لایبریری" : "طرح من");
    const item: LibraryItemDto = {
      id: row.id,
      title,
      category: known ? known.slug : null,
      categoryLabel: known ? known.label : null,
      description: metaString(meta, "description") ?? "",
      seedPrompt: metaString(meta, "seedPrompt"),
      url: storage.publicUrl(row.storageKey),
      kind: row.kind,
      isSeed: row.isSeed,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
    };
    if (matchesQuery(`${item.title} ${item.description}`, queryTokens)) {
      items.push(item);
    }
  }

  return NextResponse.json({ items });
}
