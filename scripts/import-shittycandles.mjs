#!/usr/bin/env node
/**
 * Shitty Candles catalog importer.
 *
 * Reads .scratch/shittycandlestore/products.json (fetched directly from
 * https://shittycandlestore.com/products.json) and POSTs each product to
 * POST /api/library/import as a public library seed. Re-runs are idempotent
 * (dedupe by meta.source.handle).
 *
 * Scope decisions:
 * - Category: the shop sells finished sculptural/decorative candles (+ one
 *   candle holder) → ALL map to "candle" (شمع), matching the Muse Molds
 *   candle-mold seeds already in the library.
 * - The digital Gift Card is not a product design → SKIPPED.
 *
 * Usage:
 *   node scripts/import-shittycandles.mjs --url=http://localhost:3001
 *   node scripts/import-shittycandles.mjs --dry-run
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/shittycandlestore/products.json";
const CATEGORY = "candle";
const MATERIAL = "موم صیقلی با جزئیات واضح";

const SKIP_HANDLES = new Set(["gift-card"]);

/** Hand-written Persian metadata, keyed by Shopify handle. */
const PERSIAN = {
  "winged-golden-ball": {
    title: "شمع گوی طلایی بال‌دار",
    description:
      "شمع مجسمه‌ای گوی طلایی با بال‌های ظریف؛ قطعه‌ای دکوراتیو و مجلسی. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای به فرم گوی طلایی با بال‌های برجستهٔ ظریف، موم صیقلی و جزئیات متقارن",
  },
  "set-of-2-daffodil-candle-holder": {
    title: "جاشمعی گل نرگس",
    description:
      "جاشمعی مجسمه‌ای به فرم گل نرگس؛ تکی یا ست دوتایی برای دکور میز. منبع الهام: Shitty Candles.",
    seedPrompt:
      "جاشمعی مجسمه‌ای به فرم گل نرگس با گلبرگ‌های بازشده دور جای شمع، سطوح صاف و فرم متقارن",
  },
  "mini-pumpkin": {
    title: "شمع کدو حلوایی مینی",
    description:
      "شمع مجسمه‌ای کدو حلوایی در سایز کوچک با شیارهای طبیعی؛ حس پاییز و هالووین. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای مینی به فرم کدو حلوایی با شیارهای عمودی نرم و ساقهٔ کوتاه، موم مات با جزئیات واضح",
  },
  "wizard-castle": {
    title: "شمع قلعهٔ جادوگر",
    description:
      "شمع مجسمه‌ای قلعهٔ افسانه‌ای با برج‌ها و سنگ‌های ظریف؛ برای عاشقان فانتزی. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای به فرم قلعهٔ فانتزی با برج‌های متعدد و جزئیات معماری برجسته، موم مات با خطوط تمیز",
  },
  "velvet-pumpkin": {
    title: "شمع کدو مخملی",
    description:
      "شمع کدو حلوایی با ظاهر مخملی و ساقهٔ برجسته؛ لوکس و پاییزی. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای به فرم کدو حلوایی با بافت مخملی نرم و ساقهٔ پیچ‌خورده، سطوح یکنواخت",
  },
  "peony-bouquet-in-ceramic-vase": {
    title: "شمع دسته‌گل پیونی در گلدان سرامیکی",
    description:
      "دسته‌گل شمعی پیونی در گلدان سرامیکی؛ هدیه‌ای ماندگار برای مناسبت‌ها. منبع الهام: Shitty Candles.",
    seedPrompt:
      "دسته‌گل شمعی از گل‌های پیونی لایه‌لایه در گلدان سرامیکی ساده، گلبرگ‌های برجستهٔ نرم و چیدمان طبیعی",
  },
  "peony-flower-candle": {
    title: "شمع گل پیونی",
    description:
      "شمع مجسمه‌ای گل پیونی با گلبرگ‌های لایه‌لایه؛ ظریف و رمانتیک. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای به فرم گل پیونی با گلبرگ‌های چین‌دار لایه‌لایه و مرکز گرد، موم صیقلی",
  },
  "pumpkin-candle-raven-or-classic-lid": {
    title: "شمع کدو با درپوش کلاغی یا کلاسیک",
    description:
      "شمع کدو حلوایی با درپوش فلزی به انتخاب: کلاغ (حس هالووینی) یا کلاسیک. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع کدو حلوایی با درپوش فلزی تزئینی، بدنهٔ شیاردار و ساقهٔ برجسته، ترکیب موم مات و فلز",
  },
  aetherwing: {
    title: "شمع قفس پرندهٔ وینتیج",
    description:
      "شمع مجسمه‌ای قفس پرنده با طرح وینتیج؛ پرندهٔ کوچک داخل قفس، دکور کلاسیک. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای به فرم قفس پرندهٔ وینتیج با میله‌های منحنی و پرندهٔ کوچک داخل آن، جزئیات ظریف و متقارن",
  },
  "coffee-story": {
    title: "شمع قصهٔ قهوه",
    description:
      "شمع ست قهوه با فنجان و اکسسوری‌ها؛ برای دکور آشپزخانه و کافه‌نشین‌ها. منبع الهام: Shitty Candles.",
    seedPrompt:
      "ست شمع به فرم فنجان قهوه و اکسسوری‌های کافه با جزئیات ظریف، موم صیقلی و فرم واقع‌گرایانه",
  },
  cheesecake: {
    title: "شمع برش چیزکیک",
    description:
      "شمع به فرم برش چیزکیک با تزئینات؛ واقع‌گرایانه و شیطانی برای دکور کافه‌ای. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع به فرم برش مثلثی چیزکیک با لایه‌های شکلاتی و تزئین روی آن، جزئیات واقع‌گرایانهٔ لایه‌ها",
  },
  "east-of-eden": {
    title: "شمع آتنا",
    description:
      "شمع مجسمه‌ای الهام‌گرفته از مجسمهٔ آتنا؛ فرم کلاسیک و باشکوه. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای به فرم تندیس کلاسیک آتنا با چین‌های لباس و کلاهخود، جزئیات مجسمه‌ای ظریف",
  },
  "dusky-lilac": {
    title: "شمع لیلاک دودی",
    description:
      "شمع مجسمه‌ای با رنگ لیلاک دودی؛ فرم پیچشی مدرن و آرامش‌بخش. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای با فرم پیچشی مدرن در رنگ لیلاک دودی، سطوح منحنی صاف و یکنواخت",
  },
  "calla-lily-sculptural-candle": {
    title: "شمع مجسمه‌ای گل شیپوری",
    description:
      "شمع مجسمه‌ای گل شیپوری (کالالیلی) با خطوط ساده و ظریف؛ مینیمال و شیک. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای به فرم گل شیپوری با گلبرگ پیچیدهٔ ساده و ساقهٔ صاف، موم صیقلی و خطوط مینیمال",
  },
  "white-camellia": {
    title: "شمع گل کاملیا",
    description:
      "شمع مجسمه‌ای گل کاملیا با گلبرگ‌های لایه‌لایه؛ ظریف و کلاسیک. منبع الهام: Shitty Candles.",
    seedPrompt:
      "شمع مجسمه‌ای به فرم گل کاملیا با گلبرگ‌های لایه‌لایهٔ متقارن و مرکز برجسته، موم صیقلی",
  },
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

  const catalog = JSON.parse(readFileSync(path.join(process.cwd(), catalogPath), "utf8"));
  const products = (catalog.products ?? []).filter((p) => !SKIP_HANDLES.has(p.handle));

  const missing = products.filter((p) => !PERSIAN[p.handle]);
  if (missing.length > 0) {
    console.error(`No Persian metadata for handle(s): ${missing.map((p) => p.handle).join(", ")}`);
    process.exit(1);
  }

  console.log(`Importing ${products.length} Shitty Candles product(s) -> ${base}/api/library/import`);
  let ok = 0, skipped = 0, failed = 0;
  for (const [index, product] of products.entries()) {
    const fa = PERSIAN[product.handle];
    const image = (product.images ?? []).find((i) => i.position === 1) ?? (product.images ?? [])[0];
    const tag = `[${index + 1}/${products.length}] ${fa.title}`;
    if (!image?.src) {
      failed += 1;
      console.log(`${tag} — FAIL no image in catalog`);
      continue;
    }
    if (dryRun) {
      console.log(`${tag} — would import ${image.src}`);
      continue;
    }
    process.stdout.write(`${tag} … `);
    try {
      const res = await fetch(`${base}/api/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-seed-key": secret },
        body: JSON.stringify({
          category: CATEGORY,
          title: fa.title,
          description: fa.description,
          seedPrompt: fa.seedPrompt,
          material: MATERIAL,
          imageUrl: image.src,
          source: {
            site: "Shitty Candles",
            url: `https://shittycandlestore.com/products/${product.handle}`,
            handle: product.handle,
            productId: String(product.id),
            price: product.variants?.[0]?.price,
            currency: "USD",
            productType: product.product_type ?? undefined,
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
        console.log(`OK (${data.imageId})`);
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
