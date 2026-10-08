#!/usr/bin/env node
/**
 * MS Mold (ms-mold.ir) catalog importer.
 *
 * Reads .scratch/msmold/catalog-raw.json (fetched from the public WooCommerce
 * Store API /wp-json/wc/store/v1/products) and POSTs each product to
 * POST /api/library/import as a public library seed. Re-runs are idempotent
 * (dedupe by meta.source.handle = WooCommerce product id).
 *
 * Scope & category decisions (store's own taxonomy → ours):
 * - «قالب رزین» products            → resin   (رزین و زیورآلات)
 * - «سنگ مصنوعی» products           → plaster (گچ، بتن و پودر سنگ)
 * - «قالب شمع» / شمع-titled products → candle  (شمع)
 * - Product id 15649 (titled «قالب», keyword-stuffed alts, garbled
 *   description) is SEO junk → SKIPPED.
 * Titles/descriptions are already Persian — no translation pass needed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/msmold/catalog-raw.json";

const SKIP_IDS = new Set([15649]); // untitled SEO-junk product

const MATERIAL_BY_CATEGORY = {
  candle: "موم صیقلی با جزئیات واضح",
  resin: "رزین شفاف و براق، بدون حباب",
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

function mapCategory(product) {
  const cats = (product.categories ?? []).map((c) => c.name);
  if (cats.some((c) => /رزین/.test(c))) return "resin";
  if (cats.some((c) => /سنگ مصنوعی/.test(c))) return "plaster";
  if (cats.some((c) => /شمع/.test(c)) || /شمع/.test(product.name)) return "candle";
  return null;
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
    if (SKIP_IDS.has(p.id) || p.id === 15649) {
      skipped.push(`${p.name} (#${p.id}, SEO junk)`);
      continue;
    }
    const category = mapCategory(p);
    const image = (p.images ?? [])[0];
    if (!category || !image?.src) {
      skipped.push(`${p.name} (#${p.id}, no category/image)`);
      continue;
    }
    const cleanDesc = decode(p.short_description);
    const title = decode(p.name).slice(0, 120);
    const description = (
      cleanDesc
        ? cleanDesc.slice(0, 320).replace(/[.،…]+$/, "") + ". "
        : `${title} از فروشگاه ام‌اس مولد. `
    ) + "منبع: MS Mold (ms-mold.ir).";
    jobs.push({
      product: p,
      category,
      title,
      description: description.slice(0, 400),
      seedPrompt: `${title}، با جزئیات برجستهٔ نرم و سطح داخلی صاف`.slice(0, 800),
      image,
    });
  }

  if (skipped.length) {
    console.log("Skipped:");
    for (const s of skipped) console.log("  - " + s);
  }

  const byCat = {};
  for (const j of jobs) byCat[j.category] = (byCat[j.category] ?? 0) + 1;
  console.log(`Importing ${jobs.length} MS Mold product(s) -> ${base}/api/library/import`, JSON.stringify(byCat));

  let ok = 0, dup = 0, failed = 0;
  for (const [index, j] of jobs.entries()) {
    const tag = `[${index + 1}/${jobs.length}] ${j.title}`;
    if (dryRun) {
      console.log(`${tag} [${j.category}] — would import ${j.image.src.slice(0, 70)}`);
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
          imageUrl: j.image.src,
          source: {
            site: "MS Mold (ms-mold.ir)",
            url: j.product.permalink,
            handle: String(j.product.id),
            productId: String(j.product.id),
            price: j.product.prices?.price || undefined,
            currency: j.product.prices?.currency_code ?? "IRT",
            shopCategory: (j.product.categories ?? []).map((c) => c.name).join(" > ") || undefined,
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
