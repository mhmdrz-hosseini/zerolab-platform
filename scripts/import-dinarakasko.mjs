#!/usr/bin/env node
/**
 * Dinara Kasko shop importer.
 *
 * Reads .scratch/dinarakasko/products.json (produced by
 * scripts/crawl-dinarakasko.mjs) and POSTs each MOULD product to
 * POST /api/library/import as a public library seed. Re-runs are idempotent
 * (dedupe by meta.source.handle = URL slug).
 *
 * Scope decisions:
 * - Category: every Dinara Kasko mould is a pastry mould (mousse cakes, bento,
 *   tarts, cookies, chocolate) → ALL map to "confectionery" (قنادی و خوراکی).
 * - The 13 "Baking tools" items (spatulas, frames, mats, pastry bag, rings)
 *   are physical utensils, not mould designs → SKIPPED. The two Truffle
 *   silicone moulds that sit in that category ARE moulds → imported.
 *
 * Usage:
 *   node scripts/import-dinarakasko.mjs --sample=12        # print samples only
 *   node scripts/import-dinarakasko.mjs --url=http://localhost:3001 --limit=5
 *   node scripts/import-dinarakasko.mjs --url=http://localhost:3001
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/dinarakasko/products.json";
const CATEGORY = "confectionery";
const MATERIAL = "سیلیکون غذایی با جزئیات دقیق و سطح داخلی صاف";

/** EN motif (canonical Title Case) → Persian. */
const MOTIF_FA = {
  Almond: "بادام",
  Amore: "آموره",
  Antique: "آنتیک",
  Apple: "سیب",
  Apples: "سیب",
  Arabesque: "آرابسک",
  Ariadne: "آریادنه",
  Artichoke: "کنگر فرنگی",
  "Balloon Heart": "قلب بادکنکی",
  Banana: "موز",
  "Banana Classic": "موز کلاسیک",
  Basket: "سبد",
  "Baubles Ball": "گوی تزئینی",
  "Bear Hug Family": "خانوادهٔ آغوش خرس",
  Birds: "پرنده‌ها",
  "Biscuit Base": "پایهٔ بیسکویتی",
  Bloom: "شکوفا",
  "Bloom Base": "پایهٔ شکوفا",
  "Bloom Wave": "موج شکوفا",
  "Blooming Egg": "تخم‌مرغ شکوفا",
  "Blooming Eggs": "ست تخم‌مرغ شکوفا",
  "Blossom Top": "تاج شکوفه",
  Blueberry: "بلوبری",
  "Boo Ghost": "روحِ بو",
  Bow: "پاپیون",
  "Bubble Bliss": "شادی حباب",
  "Bubble Tree": "درخت حباب",
  Bunny: "خرگوش",
  Cacao: "کاکائو",
  "Cacao Bean": "دانهٔ کاکائو",
  Carousel: "چرخ‌وفلک",
  Cat: "گربه",
  Cherry: "گیلاس",
  Chicko: "جوجه",
  "Chocolate Block": "قطعهٔ شکلات",
  "Christmas Street": "کوچهٔ کریسمس",
  "Christmas Toys": "اسباب‌بازی کریسمس",
  "Christmas Tree": "درخت کریسمس",
  Christmasland: "سرزمین کریسمس",
  Circles: "دایره‌ها",
  Circle: "دایره",
  "Cirсle": "دایره", // Cyrillic с variant present in source titles
  "Classic Circle Cookie": "کوکی دایرهٔ کلاسیک",
  "Classic Heart Cookie": "کوکی قلب کلاسیک",
  "Classic Smile Cookie": "کوکی لبخند کلاسیک",
  "Classic Star Cookie": "کوکی ستارهٔ کلاسیک",
  Cluster: "خوشه",
  Coco: "نارگیل",
  Coffee: "قهوه",
  Cones: "مخروط‌ها",
  Cookie: "کوکی",
  "Creepy Jack": "جکِ ترسناک",
  Croissant: "کروسان",
  Crumbs: "خرده‌نان",
  "Crunch Base": "پایهٔ ترد",
  "Crystal Cap": "کلاهک کریستالی",
  "Crystal Eggs": "ست تخم‌مرغ کریستالی",
  Cubik: "کوبیک",
  "Cup Cover": "درپوش فنجان",
  Dahlia: "داوودی",
  "Daisy Touch Top": "تاج مینا",
  "Deadly Sweet": "شیرینیِ کشنده",
  Diamond: "الماس",
  Dino: "دایناسور",
  "Dragon Egg": "تخم اژدها",
  "Dream Deer": "گوزن رویایی",
  Dreams: "رؤیاها",
  Duck: "اردک",
  Dunes: "تپه‌های شنی",
  Easter: "عید پاک",
  "Easter Eggs Box": "جعبهٔ تخم‌مرغ عید پاک",
  "Echo Ball": "گوی اکو",
  Eclairs: "اکلر",
  Egg: "تخم‌مرغ",
  Eggs: "ست تخم‌مرغ",
  Elegance: "الگانس",
  Ferro: "فِرو",
  Fig: "انجیر",
  "Flat Peach": "شلیل",
  "Flora Ball": "گوی فلورا",
  "Flow Ball": "گوی جریان",
  Flower: "گل",
  "Flower Cookie": "کوکی گل",
  Flowers: "گل‌ها",
  Folding: "تاخوردگی",
  Fox: "روباه",
  Freedom: "آزادی",
  "Frost Ball": "گوی یخ",
  "Frostbite Ball": "گوی سرما",
  "Gem Ball": "گوی جواهر",
  "Giant Cupcake": "کاپ‌کیک غول‌پیکر",
  "Glitter Ball": "گوی براق",
  "Glitz Ball": "گوی درخشان",
  "Glossy Paws": "پنجهٔ براق",
  "Gold Bar": "شمش طلا",
  "Haunted Stump": "کندهٔ تسخیرشده",
  "Haunted Tower": "برج تسخیرشده",
  Hazelnut: "فندق",
  "Hazelnut Classic": "فندق کلاسیک",
  Heart: "قلب",
  Hedgehog: "جوجه‌تیغی",
  House: "خانه",
  "House Charm": "خانهٔ چارم",
  "House Joy": "خانهٔ شادی",
  "House Tale": "خانهٔ قصه",
  "Icicles Ball": "گوی قندیل",
  "Insert Torus": "درج چنبره",
  "Jasmine Top": "تاج یاس",
  "Kintsugi Heart": "قلب کینتسوگی",
  Kitten: "بچه‌گربه",
  "Labyrinth Ball": "گوی هزارتو",
  Lake: "دریاچه",
  "Lake Round": "دریاچهٔ گرد",
  "Lake Square": "دریاچهٔ مربع",
  Lambeth: "لمبث",
  "Lambeth Heart": "قلب لمبث",
  "Lambeth Slice": "برش لمبث",
  Lemon: "لیمو",
  Line: "خط",
  Lion: "شیر",
  "Little Bear": "خرس کوچولو",
  Lotus: "نیلوفر",
  Love: "عشق",
  LOVE: "لاو (عشق)",
  Lychee: "لیتچی",
  "Lychee Classic": "لیتچی کلاسیک",
  "Lychee Fruit": "لیتچی میوه‌ای",
  "Magic Cauldron": "دیگ جادویی",
  Mango: "انبه",
  Marigold: "همیشه‌بهار",
  Marshmallow: "مارشمالو",
  "Mini Cherry": "مینی گیلاس",
  "Mini Cubik": "مینی کوبیک",
  "Mini Dunes": "مینی تپه شنی",
  "Mini Heart Balloon": "مینی قلب بادکنکی",
  "Mini Hearts": "مینی قلب‌ها",
  "Mini NEW": "مینی جدید",
  "Mini Origami": "مینی اوریگامی",
  "Mini Pearls": "مینی مرواریدها",
  "Mini Shapka": "مینی شاپکا",
  Mittens: "دستکش بافتنی",
  "Moody Ghost": "روح غمگین",
  "Moon Wave": "موج ماه",
  NEW: "جدید",
  "Nova Ball": "گوی نوا",
  Orange: "پرتقال",
  Orbit: "مدار",
  Oriental: "شرقی",
  Origami: "اوریگامی",
  Peach: "هلو",
  Peanut: "بادام‌زمینی",
  Pear: "گلابی",
  "Pear Classic": "گلابی کلاسیک",
  Pearls: "مرواریدها",
  Pecan: "پکان",
  Penguin: "پنگوئن",
  Pentagon: "پنج‌ضلعی",
  "Perfect Cup Set": "ست فنجان",
  Pillow: "بالش",
  "Pillow Round": "بالش گرد",
  "Pillow Round Mini": "بالش گرد مینی",
  "Pillow Square": "بالش مربع",
  "Pillow Square Mini": "بالش مربع مینی",
  Pineapples: "آناناس",
  Pistachio: "پسته",
  "Play Heart Cookie": "کوکی قلبِ بازی",
  Pomegranate: "انار",
  "Pop It": "پاپ‌یت",
  "Pop It Big": "پاپ‌یت (جزئیات بزرگ)",
  "Pop It Small": "پاپ‌یت (جزئیات کوچک)",
  Prism: "منشور",
  "Prism Mini": "منشور مینی",
  "Puffy Paws": "پنجهٔ پفکی",
  Pumpkin: "کدو حلوایی",
  Puppy: "توله‌سگ",
  "Pure Heart Cookie": "کوکی قلب خالص",
  Puzzle: "پازل",
  Quince: "به",
  Raspberry: "تمشک",
  Rose: "رز",
  Rosie: "رُزی",
  Teddy: "تدی",
  "Teddy Bear": "تدی‌بیر",
  "Teddy Heart": "قلب تدی",
  Teapot: "قوری چای",
  "Tender Petals Top": "تاج گلبرگ‌های لطیف",
  "Classic Circle": "دایرهٔ کلاسیک",
  "Classic Heart": "قلب کلاسیک",
  "Classic Smile": "لبخند کلاسیک",
  "Classic Star": "ستارهٔ کلاسیک",
  "Play Heart": "قلبِ بازی",
  "Pure Heart": "قلب خالص",
  "Square Dots": "خال‌دار مربع",
  "Square Heart": "قلب مربع",
  "Saint Honore": "سنت‌اونوره",
  Savoiardi: "ساوایاردی",
  "Secret Love": "عشق پنهان",
  Shapka: "شاپکا",
  Sheep: "گوسفند",
  Shell: "صدف",
  Simple: "ساده",
  "Small Spiral": "مارپیچ کوچک",
  Snail: "حلزون",
  "Snowfall Ball": "گوی بارش برف",
  Snowflake: "دانهٔ برف",
  Snowstar: "ستارهٔ برفی",
  "Soccer Ball": "توپ فوتبال",
  Solia: "سولیا",
  Spheres: "کره‌ها",
  "Spheres Circle": "کره‌های دایره‌ای",
  "Spheres Cube": "کره‌های مکعبی",
  "Spheres Heart": "کره‌های قلبی",
  Spiral: "مارپیچ",
  "Spooky Pumpkin": "کدوی هالووینی",
  "Spooky Skull": "جمجمهٔ هالووینی",
  "Spring Egg": "تخم‌مرغ بهاری",
  "Spring Eggs": "ست تخم‌مرغ بهاری",
  Square: "مربع",
  "Square Dots Cookie": "کوکی خال‌دار مربع",
  "Square Heart Cookie": "کوکی قلب مربع",
  Star: "ستاره",
  "Star Anise Top": "تاج بادیان رومی",
  Strawberry: "توت‌فرنگی",
  Stripes: "راه‌راه",
  Succulent: "گیاه گوشتی",
  "Summer Flavor": "طعم تابستان",
  "Sweet City": "شهر شیرین",
  Sweetrose: "رز شیرین",
  Symmetry: "تقارن",
  Tesselation: "تسلاسیون",
  Tesseletion: "تسلاسیون",
  "The Cells": "سلول‌ها",
  Tomato: "گوجه",
  Torus: "چنبره",
  Triangulation: "مثلث‌بندی",
  Truffles: "ترافل",
  "Twinkle Ball": "گوی درخشش",
  Twister: "پیچان",
  Unicorn: "تک‌شاخ",
  "Vine Ball": "گوی تاک",
  Vortex: "گرداب",
  Waffle: "ویفر",
  "Waffle Double": "ویفر دوبل",
  Wagashi: "واگاشی",
  Walnut: "گردو",
  "Walnut Shell": "پوستهٔ گردو",
  "Walnut Shell Classic": "پوستهٔ گردو کلاسیک",
};

const FORMAT_FA = {
  cake: { word: "کیک", prompt: "موس‌کیک" },
  mini: { word: "مینی‌کیک", prompt: "مینی موس‌کیک" },
  micro: { word: "میکروکیک", prompt: "میکرو موس‌کیک" },
  bento: { word: "کیک بنتو", prompt: "کیک بنتو" },
  lollipop: { word: "کیک آب‌نباتی", prompt: "کیک آب‌نباتی چوب‌دار" },
  cookie: { word: "کوکی", prompt: "کوکی نقش‌دار" },
  tart: { word: "تارت", prompt: "تارت" },
};

const FORMAT_WORDS = ["mini", "micro", "bento", "lollipop", "cookie", "tart"];

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
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const faDigits = (s) => String(s).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

/**
 * Parse a Dinara Kasko product title into
 * { motifKey, format, sizeMl, pieces, sizeLetter, isPair, xxl }.
 * Returns null for non-mould titles (tools).
 */
function parseTitle(rawTitle) {
  let t = decode(rawTitle);
  if (!/\bmoulds?\b/i.test(t)) return null; // tools without "mould" are skipped
  const sizeMl = t.match(/(\d+(?:[.,]\d+)?)\s*ml/i);
  const pieces = t.match(/(\d+)\s*pcs/i);
  t = t.replace(/\b\d+(?:[.,]\d+)?\s*ml\b/gi, "");
  t = t.replace(/\s*\d+\s*pcs\b/gi, "");
  t = t.replace(/\s+by\s+[^,]+$/i, "");
  t = t.replace(/\bKIT\b/gi, "");
  t = t.replace(/\bsilicone moulds?\b/gi, "");
  t = t.replace(/\bhandmade\b/gi, "");
  t = t.replace(/-/g, " "); // hyphenated merges ("mini-сake")
  t = t.replace(/\b([Bb]ento|[Mm]ini|[Mm]icro)([CcСс]ake)\b/g, "$1 $2"); // "Bentocake"

  const xxl = /\bXXL\b/.test(t);
  t = t.replace(/\bXXL\b/g, "");

  // cake word (Latin or Cyrillic initial) — position anchors format parsing.
  // Use the LAST match so "Tart Cake Mini NEW" anchors on "Cake" and the
  // leading "Tart" is consumed as a format word.
  const cakeRe = /\b(?:small\s+)?(?:[CcСс]akes?|tarts?)\b/g;
  let format = "cake";
  let cakeMatch = null;
  for (const m of t.matchAll(cakeRe)) cakeMatch = m;
  if (cakeMatch) {
    if (/tarts?/i.test(cakeMatch[0])) format = "tart";
    // consume format words immediately before the cake word
    let end = cakeMatch.index;
    for (;;) {
      const before = t.slice(0, end).trimEnd();
      const wm = new RegExp(`(?:^|\\s)(${FORMAT_WORDS.join("|")})$`, "i").exec(before);
      if (!wm) break;
      format = wm[1].toLowerCase();
      end = before.length - wm[1].length;
    }
    t = t.slice(0, end) + "\u0001" + t.slice(cakeMatch.index + cakeMatch[0].length);
  } else {
    const fm = new RegExp(`\\b(${FORMAT_WORDS.join("|")})\\b`, "i").exec(t);
    if (fm) {
      format = fm[1].toLowerCase();
      t = t.replace(fm[0], "\u0001");
    }
  }

  const isPair = /\(\s*(?:one\s+)?pair\s*\)/i.test(t);

  let motif = t
    .split("\u0001")
    .map((s) => s.trim().replace(/^[\s,+]+|[\s,+]+$/g, ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s*\(\s*(?:one\s+)?pair\s*\)\s*$/i, "")
    .replace(/\s*[*()]+\s*$/g, "")
    .replace(/\s*\+\s*$/g, "")
    .replace(/\s*\d\s*\**\s*$/g, "")
    .replace(/\s+\bfor\b/ig, "")
    .replace(/\s\s+/g, " ")
    .trim();

  // trailing size letters (Christmas toys M)
  let sizeLetter = null;
  const lm = /\s(XXS|XS|S|M|L|XL)$/i.exec(motif);
  if (lm) {
    sizeLetter = lm[1].toUpperCase();
    motif = motif.slice(0, lm.index).trim();
  }

  // canonical Title Case (ALLCAPS tokens kept)
  motif = motif
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

  return { motifKey: motif, format, sizeMl: sizeMl?.[1], pieces: pieces?.[1], sizeLetter, isPair, xxl };
}

function persianMeta(product) {
  const parsed = parseTitle(product.title);
  if (!parsed) return null;
  const fmt = FORMAT_FA[parsed.format] ?? FORMAT_FA.cake;
  const motifFa = MOTIF_FA[parsed.motifKey];

  const isKit = product.categories.includes("kits");
  const isFactory = product.categories.includes("factory") && !product.categories.includes("handmade");

  const sizeBits = [];
  if (parsed.sizeMl) sizeBits.push(`حجم ${faDigits(parsed.sizeMl.replace(".", "٫"))} میلی‌لیتر`);
  if (parsed.pieces) sizeBits.push(`${faDigits(parsed.pieces)} خانه`);
  if (parsed.sizeLetter) sizeBits.push(`سایز ${parsed.sizeLetter}`);
  if (parsed.xxl) sizeBits.push("نسخهٔ بزرگ XXL");
  if (parsed.isPair) sizeBits.push("جفت");
  const sizeNote = sizeBits.length ? `؛ ${sizeBits.join("، ")}` : "";

  const motifTitle = motifFa ?? (parsed.motifKey ? "طرح استاندارد" : "");
  const title = `قالب ${fmt.word}${motifTitle ? " " + motifTitle : ""}${parsed.xxl ? " XXL" : ""} — دینارا کاسکو`;
  const producer = isKit
    ? "ست چندقالبی"
    : isFactory
      ? "تولید کارخانه‌ای"
      : "ساخت دستی با جزئیات سه‌بعدی دقیق";
  const description =
    `قالب سیلیکونی ${fmt.word}${motifTitle ? " " + motifTitle : ""} از مجموعهٔ دینارا کاسکو${sizeNote}؛ ${producer}. منبع الهام: Dinara Kasko.`;
  const seedPrompt =
    `قالب سیلیکونی ${fmt.prompt}${motifTitle ? " به فرم " + motifTitle : ""} با جزئیات برجستهٔ نرم و سطح داخلی صاف، طراحی امضادار دینارا کاسکو`;

  return {
    title: title.slice(0, 120),
    description: description.slice(0, 400),
    seedPrompt: seedPrompt.slice(0, 800),
    motifKnown: Boolean(motifFa),
    motifKey: parsed.motifKey,
  };
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
  const unknownMotifs = new Map();
  let skippedTools = 0;
  for (const p of products) {
    const meta = persianMeta(p);
    if (meta === null) {
      skippedTools += 1;
      continue;
    }
    if (!meta.motifKnown) {
      unknownMotifs.set(meta.motifKey, (unknownMotifs.get(meta.motifKey) ?? 0) + 1);
    }
    jobs.push({ product: p, meta });
  }

  if (unknownMotifs.size > 0) {
    console.error(`Unknown motifs (falling back to generic title):`);
    for (const [k, count] of [...unknownMotifs.entries()].sort((a, b) => b[1] - a[1])) {
      console.error(`  - "${k}" ×${count}`);
    }
  }

  if (sample) {
    for (const j of jobs.slice(0, sample)) {
      console.log("—", j.meta.title);
      console.log("  ", j.meta.description);
      console.log("  ", j.meta.seedPrompt);
      console.log("   img:", j.product.image);
    }
    console.log(`\n(prepared ${jobs.length} mold jobs; ${skippedTools} non-mold tools skipped; ${unknownMotifs.size} unknown motifs)`);
    return;
  }

  const runJobs = limit ? jobs.slice(0, limit) : jobs;
  console.log(`Importing ${runJobs.length}/${jobs.length} Dinara Kasko mould(s) -> ${base}/api/library/import (${skippedTools} non-mold tools skipped; ${unknownMotifs.size} unknown motifs use generic title)`);
  let ok = 0, skipped = 0, failed = 0;
  for (const [index, j] of runJobs.entries()) {
    const tag = `[${index + 1}/${runJobs.length}] ${j.meta.title}`;
    if (dryRun) {
      console.log(`${tag} — would import ${j.product.image}`);
      continue;
    }
    process.stdout.write(`${tag} … `);
    try {
      const slug = j.product.url.split("/").filter(Boolean).pop();
      const res = await fetch(`${base}/api/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-seed-key": secret },
        body: JSON.stringify({
          category: CATEGORY,
          title: j.meta.title,
          description: j.meta.description,
          seedPrompt: j.meta.seedPrompt,
          material: MATERIAL,
          imageUrl: j.product.image,
          source: {
            site: "Dinara Kasko",
            url: j.product.url,
            handle: slug,
            productId: j.product.id,
            price: j.product.price ? j.product.price.replace(/[^0-9.,]/g, "") : undefined,
            currency: "USD",
            shopCategory: j.product.categories.join(","),
            oldPrice: j.product.oldPrice ? j.product.oldPrice.replace(/[^0-9.,]/g, "") : undefined,
            ...(j.meta.motifKey ? { motifKey: j.meta.motifKey } : {}),
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
