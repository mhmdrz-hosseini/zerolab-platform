import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { images } from "@/db/schema";
import { getOrCreateSession } from "@/server/credits";
import { getStorage } from "@/server/storage";

/**
 * Library import API: turns an EXTERNAL product/reference image into a public
 * seed row (is_seed=true). Companion to /api/library/seed, which *generates*
 * images via Aval — this one downloads existing bytes instead. Operator-only,
 * protected by the same `x-seed-key` header (SEED_SECRET in .env.local).
 *
 * POST {
 *   category, title, description, imageUrl,
 *   seedPrompt?, material?,
 *   source?: { site, url, handle?, productId?, price?, currency? }
 * }
 * → { imageId, url } | { imageId, url, skipped: true } when the handle exists.
 *
 * The download tries the origin URL first and falls back to the
 * images.weserv.nl proxy — some origins (e.g. cdn.shopify.com behind
 * region-level blocks) are unreachable from the server's network.
 */

/** 7-category taxonomy — hand-synced twin of the list in /api/library. */
const CATEGORIES: ReadonlyArray<{ slug: string }> = [
  { slug: "confectionery" },
  { slug: "resin" },
  { slug: "candle" },
  { slug: "soap" },
  { slug: "plaster" },
  { slug: "figures" },
  { slug: "keepsake" },
];

const MAX_BYTES = 10 * 1024 * 1024;

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".png";
}

/** Constant-time compare of the seed key against SEED_SECRET. */
function isAuthorized(req: Request): boolean {
  const secret = process.env.SEED_SECRET;
  const provided = req.headers.get("x-seed-key") ?? "";
  if (!secret || !provided) return false;
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

/** Fetch image bytes from the origin, then via the weserv proxy (width-capped). */
async function downloadImage(
  imageUrl: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&n=-1&w=1600&we`;
  const attempts = [
    { url: imageUrl, via: "origin" },
    { url: proxied, via: "weserv" },
  ];
  let lastError = "download failed";
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
          Accept: "image/*",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        lastError = `${attempt.via} HTTP ${res.status}`;
        continue;
      }
      const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!mime.startsWith("image/")) {
        lastError = `${attempt.via} returned non-image content-type: ${mime}`;
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) {
        lastError = `${attempt.via} returned empty payload`;
        continue;
      }
      if (bytes.length > MAX_BYTES) {
        throw new Error(
          `Image too large (${Math.round(bytes.length / 1024 / 1024)}MB > 10MB)`,
        );
      }
      return { bytes, mime };
    } catch (err) {
      if (err instanceof Error && /too large/i.test(err.message)) throw err;
      lastError = `${attempt.via}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(lastError);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    category?: unknown;
    title?: unknown;
    description?: unknown;
    seedPrompt?: unknown;
    material?: unknown;
    imageUrl?: unknown;
    source?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const category =
    typeof body.category === "string" &&
    CATEGORIES.some((c) => c.slug === body.category)
      ? body.category
      : null;
  const title =
    typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const description =
    typeof body.description === "string"
      ? body.description.trim().slice(0, 400)
      : "";
  const seedPrompt =
    typeof body.seedPrompt === "string"
      ? body.seedPrompt.trim().slice(0, 800)
      : "";
  const material =
    typeof body.material === "string" && body.material.trim()
      ? body.material.trim().slice(0, 200)
      : undefined;
  const imageUrl =
    typeof body.imageUrl === "string" && /^https?:\/\//i.test(body.imageUrl.trim())
      ? body.imageUrl.trim()
      : null;

  if (!category || !title || !description || !imageUrl) {
    return NextResponse.json(
      { error: "invalid_body", message: "دسته/عنوان/توضیح/آدرس تصویر الزامی است." },
      { status: 400 },
    );
  }

  // Optional source block for attribution + idempotent re-runs (by handle).
  const source =
    body.source && typeof body.source === "object"
      ? (body.source as Record<string, unknown>)
      : null;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  const handle = source ? str(source.handle, 255) : undefined;

  const sessionId = await getOrCreateSession();
  const db = getDb();

  if (handle) {
    const existing = await db
      .select({ id: images.id, key: images.storageKey })
      .from(images)
      .where(
        and(
          eq(images.isSeed, true),
          sql`${images.meta} -> 'source' ->> 'handle' = ${handle}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({
        imageId: existing[0].id,
        url: getStorage().publicUrl(existing[0].key),
        skipped: true,
      });
    }
  }

  try {
    const { bytes, mime } = await downloadImage(imageUrl);
    const storage = getStorage();
    const imageId = randomUUID();
    const key = `images/${sessionId}/${imageId}${extForMime(mime)}`;
    await storage.put(key, bytes, mime);

    await db.insert(images).values({
      id: imageId,
      sessionId,
      kind: "uploaded",
      storageKey: key,
      mime,
      isSeed: true,
      meta: {
        title,
        category,
        description,
        ...(seedPrompt ? { seedPrompt } : {}),
        ...(material ? { material } : {}),
        imported: true,
        ...(source
          ? {
              source: {
                site: str(source.site, 120) ?? new URL(imageUrl).hostname,
                ...(str(source.url, 500) ? { url: str(source.url, 500) } : {}),
                ...(handle ? { handle } : {}),
                ...(str(source.productId, 60)
                  ? { productId: str(source.productId, 60) }
                  : {}),
                ...(str(source.price, 20) ? { price: str(source.price, 20) } : {}),
                ...(str(source.currency, 8)
                  ? { currency: str(source.currency, 8) }
                  : {}),
              },
            }
          : {}),
      },
    });

    return NextResponse.json({ imageId, url: storage.publicUrl(key) });
  } catch (err) {
    console.error("[api/library/import] download failed", err);
    return NextResponse.json(
      {
        error: "import_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}
