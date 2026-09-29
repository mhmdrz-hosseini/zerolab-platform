#!/usr/bin/env node
/**
 * Muse Molds shop importer.
 *
 * Reads .scratch/musemolds/products.json (produced by
 * scripts/crawl-musemolds.mjs) and POSTs each silicone candle mold to
 * POST /api/library/import as a public library seed. Re-runs are idempotent
 * (dedupe by meta.source.handle = product URL slug).
 *
 * Scope decisions:
 * - Category: Muse Molds is a candle-mold-only studio (tapers, pillars, wax
 *   melts, 2D relief candles) → ALL products map to "candle" (شمع).
 * - The Canva flyer template (digital download) and the cotton wick spool
 *   (supply, not a mold) → SKIPPED, like the tools in the Dinara Kasko import.
 *
 * Usage:
 *   node scripts/import-musemolds.mjs --sample=5            # print samples only
 *   node scripts/import-musemolds.mjs --url=http://localhost:3001 --limit=3
 *   node scripts/import-musemolds.mjs --url=http://localhost:3001
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/musemolds/products.json";
const CATEGORY = "candle";
const MATERIAL = "سیلیکون مقاوم به حرارت موم با جزئیات دقیق و سطح داخلی صاف";
const BRAND_FA = "میوز مولدز";

/** Mold body → Persian type word (title) + prompt phrase + shop category. */
const TYPE_FA = {
  taper: { word: "شمع مخروطی", prompt: "شمع مخروطی باریک (تیپر)", shop: "taper" },
  pillar: { word: "شمع پیلار", prompt: "شمع پیلار (ستونی)", shop: "pillar" },
  waxmelt: { word: "وکس ملت", prompt: "وکس ملت تزئینی", shop: "wax-melt" },
  flat2d: { word: "شمع تخت", prompt: "شمع تخت با نقش برجسته (ریلیف)", shop: "2d" },
};

/** handle → { type, motif, note?, set? }; absent handle = skipped. */
const MOLDS = {
  "silicone-taper-candle-mold-lily": { type: "taper", motif: "سوسن" },
  "silicone-taper-candle-mold-spray-rose": { type: "taper", motif: "رز خوشه" },
  "silicone-taper-candle-mold-elegant-swirl": { type: "taper", motif: "موج ظریف" },
  "silicone-taper-candle-mold-grapevine": { type: "taper", motif: "تاک انگور" },
  "silicone-taper-candle-mold-wildflower": { type: "taper", motif: "گل‌های وحشی" },
  "silicone-taper-candle-mold-peony": { type: "taper", motif: "پیونی" },
  "silicone-taper-candle-mold-veil": { type: "taper", motif: "مارپیچ پرده" },
  "silicone-pillar-candle-mold-peony": { type: "pillar", motif: "پیونی" },
  "silicone-taper-candle-mold-heritage": { type: "taper", motif: "میراث" },
  "silicone-pillar-candle-mold-wildflower": { type: "pillar", motif: "گل‌های وحشی" },
  "silicone-wax-melt-molds-botanical-flowers": { type: "waxmelt", motif: "گل‌های گیاهی" },
  "lavender-silicone-taper-candle-mold": { type: "taper", motif: "اسطوخودوس" },
  "large-moth-pillar-candle-mold": { type: "pillar", motif: "شب‌پروی بزرگ" },
  "fall-harvest-wax-melt-mold": { type: "waxmelt", motif: "برداشت پاییزی" },
  "gothic-column-pillar-candle-mold": { type: "pillar", motif: "ستون گوتیک" },
  "cute-ghost-pillar-candle-mold": { type: "pillar", motif: "روح بامزه" },
  "mushroom-taper-candle-mold": { type: "taper", motif: "قارچ" },
  "mushroom-pillar-candle-mold": { type: "pillar", motif: "قارچ پاییزی" },
  "gothic-mansion-house-candle-mold": { type: "flat2d", motif: "عمارت گوتیک" },
  "witch-cat-pillar-candle-mold": { type: "pillar", motif: "جادوگر و گربه" },
  "witchy-cat-pillar-candle-mold": { type: "pillar", motif: "گربهٔ جادویی" },
  "ghost-pillar-candle-mold": { type: "pillar", motif: "روح" },
  "christmas-cat-pillar-candle-mold": { type: "pillar", motif: "گربهٔ کریسمس" },
  "christmas-door-candle-mold": { type: "flat2d", motif: "درِ کریسمس" },
  "snowflake-taper-candle-mold": { type: "taper", motif: "دانهٔ برف" },
  "ribbon-ornament-taper-candle-mold": { type: "taper", motif: "تزئین روبان", set: true },
  "cardinal-taper-candle-mold": { type: "taper", motif: "پرندهٔ کاردینال", set: true },
  "merry-christmas-taper-candle-mold": { type: "taper", motif: "کریسمس مبارک", set: true },
};

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(raw);
    if (match) args[match[1]] = match[2] ?? "true";
  }
  return args;
}

function loadSeedSecret() {
  try {
    const lines = readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = /^SEED_SECRET=(.*)$/.exec(line.trim());
      if (match && match[1]) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  return process.env.SEED_SECRET ?? null;
}

function persianMeta(product, spec) {
  const fmt = TYPE_FA[spec.type];
  const title = `قالب ${fmt.word} ${spec.motif}${spec.set ? " (ست)" : ""} — ${BRAND_FA}`;
  const description =
    `قالب سیلیکونی ${fmt.word} ${spec.motif} از مجموعهٔ ${BRAND_FA}؛ طراحی و تولید آمریکا (شارلوت). ` +
    `${spec.set ? "ست چندحفره‌ای با طرح‌های هم‌خانواده؛ " : ""}مناسب موم سویا، موم زنبور و واکس ملت. منبع الهام: Muse Molds.`;
  const seedPrompt =
    `قالب سیلیکونی ${fmt.prompt} با نقش ${spec.motif}، جزئیات برجستهٔ نرم و سطح داخلی صاف، طراحی ${BRAND_FA}`;
  return { title: title.slice(0, 120), description: description.slice(0, 400), seedPrompt: seedPrompt.slice(0, 800) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = (args.url ?? process.env.ZEROLAB_BASE_URL ?? BASE_URL_DEFAULT).replace(/\/$/, "");
  const catalogPath = args.file ?? CATALOG_PATH_DEFAULT;
  const dryRun = Boolean(args["dry-run"]);
  const sample = args.sample ? parseInt(args.sample, 10) : null;
  const limit = args.limit ? parseInt(args.limit, 10) : null;
  const secret = loadSeedSecret();
  if (!secret && !dryRun) {
    console.error("SEED_SECRET not found — set it in .env.local first.");
    process.exit(1);
  }

  const catalog = JSON.parse(readFileSync(path.join(process.cwd(), catalogPath), "utf8"));
  const products = catalog.products ?? [];

  const jobs = [];
  let skippedNonMold = 0;
  for (const p of products) {
    const spec = MOLDS[p.handle];
    if (!spec) {
      skippedNonMold += 1;
      continue;
    }
    if (!p.image) {
      console.warn(`! no image for ${p.handle} — skipped`);
      continue;
    }
    jobs.push({ product: p, spec, meta: persianMeta(p, spec) });
  }

  if (sample) {
    for (const j of jobs.slice(0, sample)) {
      console.log("—", j.meta.title);
      console.log("  ", j.meta.description);
      console.log("  ", j.meta.seedPrompt);
      console.log("   img:", j.product.image);
    }
    console.log(`\n(prepared ${jobs.length} mold jobs; ${skippedNonMold} non-mold items skipped)`);
    return;
  }

  const runJobs = limit ? jobs.slice(0, limit) : jobs;
  console.log(`Importing ${runJobs.length}/${jobs.length} Muse Molds candle mold(s) -> ${base}/api/library/import (${skippedNonMold} non-mold items skipped)`);
  let ok = 0, skipped = 0, failed = 0;
  for (const [index, j] of runJobs.entries()) {
    const tag = `[${index + 1}/${runJobs.length}] ${j.meta.title}`;
    if (dryRun) {
      console.log(`${tag} — would import ${j.product.image}`);
      continue;
    }
    process.stdout.write(`${tag} … `);
    try {
      // Shopify CDN serves a scaled rendition with ?width= — keeps payloads small.
      const imageUrl = `${j.product.image}?width=1000`;
      const res = await fetch(`${base}/api/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-seed-key": secret },
        body: JSON.stringify({
          category: CATEGORY,
          title: j.meta.title,
          description: j.meta.description,
          seedPrompt: j.meta.seedPrompt,
          material: MATERIAL,
          imageUrl,
          source: {
            site: "Muse Molds",
            url: j.product.url,
            handle: j.product.handle,
            price: j.product.price ?? undefined,
            currency: j.product.currency ?? "USD",
            shopCategory: TYPE_FA[j.spec.type].shop,
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = (await res.json().catch(() => ({}))) ?? {};
      if (res.ok && data.imageId && data.skipped) {
        skipped += 1;
        console.log(`SKIPPED (${data.imageId})`);
      } else if (res.ok && data.imageId) {
        ok += 1;
        console.log(`OK`);
      } else {
        failed += 1;
        console.log(`FAIL ${res.status} ${data.error ?? ""} ${data.message ?? ""}`.trim());
      }
    } catch (err) {
      failed += 1;
      console.log(`FAIL ${err?.message ?? err}`);
    }
  }
  console.log(`Done: ${ok} imported, ${skipped} skipped, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
