#!/usr/bin/env node
/**
 * Moomasali (moomasali.ir — «موم عسلی») catalog importer.
 *
 * Reads .scratch/moomasali/catalog-molds.json (mold products only, built from
 * the site's own /v3/search/ JSON API with per-category queries; see
 * .scratch/moomasali/build-catalog.mjs) and POSTs each product to
 * POST /api/library/import as a public library seed. Re-runs are idempotent
 * (dedupe by meta.source.handle = shop product id).
 *
 * Scope & category decisions (shop is a candle-supplies store; only MOLD
 * products are "related" — paraffin/dye/wick/jar/accessory SKUs are skipped
 * at scrape time). Shop taxonomy → ours, precedence order:
 * - «قالب سنگ مصنوعی» (84)                    → plaster   (گچ، بتن و پودر سنگ)
 * - «قالب خوراکی» (50)                        → confectionery (قنادی و خوراکی)
 * - تدی/حیوانات/چهره/کوبیسم/ماشین/اسب/دختر/
 *   سافاری/فرشته subcategories                 → figures   (فیگور و مینیاتور)
 * - «قالب نوزادی» (48) / «ساخت گیفت» (61)     → keepsake  (یادگاری و سفارشی)
 * - every other mold (گل، پروانه، قلمی، …)     → candle    (شمع)
 * The /v3/search API exposes no per-product descriptions (only generic shop
 * meta), so descriptions are generated from the title, like msmold's fallback.
 * Titles are already Persian — no translation pass needed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/moomasali/catalog-molds.json";
const SITE_URL = "https://moomasali.ir";

const DESCRIPTION_BY_CATEGORY = {
  candle: "قالب سیلیکونی مناسب ساخت شمع و دکور.",
  figures: "قالب سیلیکونی فیگور و مجسمه با جزئیات برجسته.",
  confectionery: "قالب سیلیکونی خوراکی و دکور قنادی.",
  keepsake: "قالب سیلیکونی مناسب ساخت هدیه و یادگاری.",
  plaster: "قالب مناسب ریخته‌گری سنگ مصنوعی و گچ.",
};

const MATERIAL_BY_CATEGORY = {
  candle: "موم صیقلی با جزئیات واضح",
  figures: "موم صیقلی با جزئیات واضح",
  confectionery: "موم صیقلی با جزئیات واضح",
  keepsake: "موم صیقلی با جزئیات واضح",
  plaster: "پودر سنگ با سطح مات و لبه‌های تمیز",
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

const decode = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function absoluteImage(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return SITE_URL + (url.startsWith("/") ? "" : "/") + url;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = (args.url ?? process.env.ZEROLAB_BASE_URL ?? BASE_URL_DEFAULT).replace(/\/$/, "");
  const catalogPath = args.file ?? CATALOG_PATH_DEFAULT;
  const dryRun = Boolean(args["dry-run"]);
  const secret = loadSeedSecret();
  if (!secret && !dryRun) {
    console.error("SEED_SECRET not found — set it in .env.local first.");
    process.exit(1);
  }

  const products = JSON.parse(readFileSync(path.join(process.cwd(), catalogPath), "utf8"));

  const jobs = [];
  const skipped = [];
  for (const p of products) {
    const category = DESCRIPTION_BY_CATEGORY[p.category] ? p.category : null;
    if (!category || !p.image_url) {
      skipped.push(`${p.name} (#${p.id}, no category/image)`);
      continue;
    }
    const title = decode(p.name).slice(0, 120);
    const description = (
      `${title} — ${DESCRIPTION_BY_CATEGORY[category]} `
    ).slice(0, 340) + "منبع: موم عسلی (moomasali.ir).";
    jobs.push({
      product: p,
      category,
      title,
      description: description.slice(0, 400),
      seedPrompt: `${title}، قالب سیلیکونی با حفرهٔ عمیق، دیواره‌های صاف و جزئیات برجستهٔ نرم`.slice(0, 800),
      imageUrl: absoluteImage(p.image_url),
      canonicalUrl: SITE_URL + decode(p.url).replace(/\?vid=\d+$/, ""),
    });
  }

  if (skipped.length) {
    console.log("Skipped:");
    for (const s of skipped) console.log("  - " + s);
  }

  const byCat = {};
  for (const j of jobs) byCat[j.category] = (byCat[j.category] ?? 0) + 1;
  console.log(`Importing ${jobs.length} Moomasali product(s) -> ${base}/api/library/import`, JSON.stringify(byCat));

  let ok = 0, dup = 0, failed = 0;
  for (const [index, j] of jobs.entries()) {
    const tag = `[${index + 1}/${jobs.length}] ${j.title}`;
    if (dryRun) {
      console.log(`${tag} [${j.category}] — would import ${j.imageUrl.slice(0, 70)}`);
      continue;
    }
    process.stdout.write(`${tag} [${j.category}] … `);
    try {
      const res = await fetch(`${base}/api/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-seed-key": secret },
        body: JSON.stringify({
          category: j.category,
          title: j.title,
          description: j.description,
          seedPrompt: j.seedPrompt,
          material: MATERIAL_BY_CATEGORY[j.category],
          imageUrl: j.imageUrl,
          source: {
            site: "Moomasali — موم عسلی (moomasali.ir)",
            url: j.canonicalUrl,
            handle: String(j.product.id),
            productId: String(j.product.id),
            price: j.product.price != null ? String(j.product.price) : undefined,
            currency: "IRT",
            shopCategory: (j.product.shopCategories ?? []).join(" > ") || undefined,
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = (await res.json().catch(() => ({}))) ?? {};
      if (res.ok && data.imageId && data.skipped) {
        dup += 1;
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

  console.log(`Done: ${ok} imported, ${dup} skipped, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
