#!/usr/bin/env node
/**
 * Mr Molds (mrmolds.ir) catalog importer.
 *
 * Reads .scratch/mrmold/catalog-raw.json (list API /backend/customer/product/s/)
 * joined with details.json (per-product /backend/customer/product/s/<id>/)
 * and POSTs each product to POST /api/library/import as a public library
 * seed. Re-runs are idempotent (dedupe by meta.source.handle = product id).
 *
 * Category mapping (Digify shop categories/titles → our 7-category taxonomy;
 * specific shapes first, decorative default last):
 * - مدلهای سنگ مصنوعی / ظروف سنگی / گلجا / استوانه, or گلدان/شات/جا-…/سینی/
 *   بیسخام titles → plaster (گچ، بتن و پودر سنگ)
 * - تدی category, باب و پاتریک/فلامینگو/بوسه زوج titles → figures
 * - گیفتی category (عروس/داماد figurines) → keepsake (یادگاری و سفارشی)
 * - خوراکی category, کیک/کوکی titles → confectionery
 * - everything else (flowers, قلمی pieces, seasonal بلوط/کدو/یلدا, …) →
 *   candle — same market default as ms-mold.ir, where the general decorative
 *   silicone-mold line lives under «قالب شمع».
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const DIR_DEFAULT = ".scratch/mrmolds";

const MATERIAL_BY_CATEGORY = {
  candle: "موم صیقلی با جزئیات واضح",
  resin: "رزین شفاف و براق، بدون حباب",
  plaster: "پودر سنگ با سطح مات و لبه‌های تمیز",
  confectionery: "سیلیکون غذایی با سطح داخلی صاف",
  figures: "جزئیات تمیز و برجستگی ملایم",
  keepsake: "پودر سنگ نرم با جزئیات واضح",
};

const faDigits = (s) => String(s).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

const decode = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function mapCategory(name, cats) {
  const has = (re) => re.test(name) || cats.some((c) => re.test(c));
  // 1) stone/casting decor
  if (
    cats.some((c) => /سنگ مصنوعی|ظروف سنگی|گلجا|استوانه/.test(c)) ||
    has(/گلدان|شات |جا مدادی|جا قیچی|جا مداد|سینی|بیسخام|گلجا/)
  ) {
    return "plaster";
  }
  // 2) figurines
  if (cats.some((c) => /تدی/.test(c)) || has(/باب و پاتریک|فلامینگو|بوسه زوج/)) {
    return "figures";
  }
  // 3) wedding keepsake figurines
  if (cats.some((c) => /گیفتی/.test(c))) return "keepsake";
  // 4) edible
  if (cats.some((c) => /خوراکی/.test(c)) || has(/کیک|کوکی|چاکلت|شکلات/)) {
    return "confectionery";
  }
  // 5) candle-titled + decorative default
  return "candle";
}

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = (args.url ?? process.env.ZEROLAB_BASE_URL ?? BASE_URL_DEFAULT).replace(/\/$/, "");
  const dir = args.dir ?? DIR_DEFAULT;
  const dryRun = Boolean(args["dry-run"]);
  const secret = loadSeedSecret();
  if (!secret && !dryRun) {
    console.error("SEED_SECRET not found — set it in .env.local first.");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(path.join(process.cwd(), dir, "catalog-raw.json"), "utf8"));
  const details = JSON.parse(readFileSync(path.join(process.cwd(), dir, "details.json"), "utf8"));
  const catMap = JSON.parse(readFileSync(path.join(process.cwd(), dir, "category-map.json"), "utf8"));
  const detailById = new Map(details.map((d) => [d.id, d]));
  const id2cats = {};
  for (const [cat, ids] of Object.entries(catMap)) {
    for (const id of ids) (id2cats[id] ??= []).push(cat);
  }

  const jobs = [];
  for (const p of raw) {
    const d = detailById.get(p.id) ?? {};
    const name = decode(d.name || p.label);
    const cats = [
      ...(d.category ? [d.category.title] : []),
      ...(id2cats[p.id] ?? []).filter((c) => c !== d.category?.title && c !== "محصولات"),
    ];
    const category = mapCategory(name, cats);
    const image = p.main_image?.image ?? (p.images ?? [])[0]?.image;
    if (!name || !image) {
      console.log(`SKIP (no name/image): #${p.id}`);
      continue;
    }
    const descClean = decode(d.description).replace(/\s*تمامی قالب ها با بهترین متریال ساخته و تقدیم شما میشوند\s*/g, "").trim();
    const description =
      (descClean ? descClean.slice(0, 300).replace(/[.،…]+$/, "") + ". " : `${name} از فروشگاه مستر مولد. `) +
      "منبع: Mr Molds (mrmolds.ir).";
    jobs.push({
      id: p.id,
      category,
      title: name.slice(0, 120),
      description: description.slice(0, 400),
      seedPrompt: `${name}، با جزئیات برجستهٔ نرم و سطح داخلی صاف`.slice(0, 800),
      image,
      price: p.min_variant?.cost,
      cats,
      desc: descClean,
    });
  }

  const byCat = {};
  for (const j of jobs) byCat[j.category] = (byCat[j.category] ?? 0) + 1;
  console.log(`Prepared ${jobs.length} products:`, JSON.stringify(byCat));

  if (dryRun) {
    for (const j of jobs.slice(0, 10)) {
      console.log(`— [${j.category}] ${j.title} | ${faDigits(j.price ?? "?")} تومان`);
      console.log("   ", j.description.slice(0, 120));
      console.log("   ", j.image.slice(0, 80));
    }
    return;
  }

  console.log(`Importing ${jobs.length} Mr Molds product(s) -> ${base}/api/library/import`);
  let ok = 0, dup = 0, failed = 0;
  for (const [index, j] of jobs.entries()) {
    const tag = `[${index + 1}/${jobs.length}] [${j.category}] ${j.title}`;
    process.stdout.write(`${tag} … `);
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
          imageUrl: j.image,
          source: {
            site: "Mr Molds (mrmolds.ir)",
            url: `https://mrmolds.ir/product/${j.id}/`,
            handle: String(j.id),
            productId: String(j.id),
            price: j.price ? String(j.price) : undefined,
            currency: "IRT",
            shopCategory: j.cats.join(" > ") || undefined,
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = (await res.json().catch(() => ({}))) ?? {};
      if (res.ok && data.imageId && data.skipped) {
        dup += 1;
        console.log(`SKIPPED`);
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
