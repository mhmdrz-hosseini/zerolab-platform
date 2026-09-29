#!/usr/bin/env node
/**
 * FormFlavor catalog importer.
 *
 * Reads the scraped Shopify catalog (.scratch/formflavor/products.json —
 * fetched from https://formflavor.com/products.json) and POSTs each product
 * to POST /api/library/import, which downloads the featured image and stores
 * it as a PUBLIC library seed (is_seed=true, operator x-seed-key auth).
 * Re-runs are idempotent: the API skips handles that already exist.
 *
 * Usage:
 *   node scripts/import-formflavor.mjs --url=http://localhost:3001
 *   node scripts/import-formflavor.mjs --dry-run
 *
 * All 14 products are professional 3D silicone mousse-cake molds →
 * category "confectionery". Persian title/description/seedPrompt are
 * hand-written per handle below; the English original + price + source URL
 * are kept in the row's meta.source for attribution.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/formflavor/products.json";
const CATEGORY = "confectionery";
const MATERIAL = "سیلیکون غذایی انعطاف‌پذیر با سطح داخلی صیقلی";

/** Hand-written Persian metadata, keyed by Shopify handle. */
const PERSIAN = {
  "halloween-3d-silicone-mousse-cake-mold-set": {
    title: "ست قالب موس هالووین «شگفتی‌های نیمه‌شب»",
    description:
      "ست قالب سیلیکونی سه‌بعدی با طرح‌های متن هالووین برای موس‌کیک‌های خاص مهمانی‌های پاییزی. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک با طرح‌های هالووین شامل جمجمه و کدو تنبل، جزئیات برجستهٔ نرم و سطح صاف",
  },
  "rose-skull-silicone-mousse-cake-mold": {
    title: "قالب موس جمجمه و رز «شکوفایی جاودانه»",
    description:
      "قالب سیلیکونی سه‌بعدی با ترکیب جمجمه و گل‌های رز؛ طراحی دراماتیک و هنری برای موس‌کیک‌های متفاوت. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم جمجمهٔ تزئین‌شده با گل‌های رز لایه‌لایه، جزئیات دقیق گلبرگ‌ها و سطح صاف",
  },
  "products-pure-pistachio-3d-silicone-mousse-cake-mold": {
    title: "ست قالب موس پسته «پستهٔ خالص»",
    description:
      "ست قالب سیلیکونی سه‌بعدی با فرم واقع‌گرایانهٔ پسته و پوستهٔ بازشده؛ برای موس و دسرهای پسته‌ای. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم پسته با پوستهٔ نیم‌باز و مغز برجسته، بافت طبیعی و جزئیات نرم",
  },
  "sunny-banana-3d-silicone-mousse-cake-mold": {
    title: "ست قالب موس موز «موز آفتابی»",
    description:
      "ست قالب سیلیکونی سه‌بعدی با فرم موز؛ مناسب موس‌کیک و دسرهای میزه‌ای بامزه. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم موز با پوستهٔ نیم‌گرفته و بافت طبیعی، فرم گرد و نرم",
  },
  "golden-mango-3d-silicone-mousse-cake-mold-set": {
    title: "ست قالب موس انبه «انبهٔ طلایی»",
    description:
      "ست قالب سیلیکونی سه‌بعدی با فرم انبه؛ جزئیات دقیق بافت و هسته برای دسرهای میوه‌ای لوکس. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم انبهٔ برش‌خورده با هستهٔ برجسته و بافت طبیعی گوشت میوه",
  },
  "sweet-lychee-mousse-cake-mold": {
    title: "ست قالب موس لیتچی «لیتچی شیرین»",
    description:
      "ست قالب سیلیکونی سه‌بعدی با فرم لیتچی و پوستهٔ نمداری؛ برای دسرهای میوه‌ای خاص و متفاوت. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم لیتچی با پوستهٔ نمدار و مغز برجسته، جزئیات طبیعی و سطح صاف",
  },
  "romantic-rose-box-floral-bouquet-3d-silicone-mousse-cake-mold": {
    title: "قالب موس جعبه‌گل رز «رمانتیک»",
    description:
      "قالب سیلیکونی سه‌بعدی دسته‌گل رز در جعبه؛ برای ولنتاین و مناسبت‌های عاشقانه. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم جعبهٔ گل با دسته‌گل رز لایه‌لایه و برگ‌های نرم، جزئیات دقیق گلبرگ‌ها",
  },
  "cozy-companions-furniture-pet-silicone-mousse-cake-mold-set": {
    title: "ست قالب موس مبلمان و حیوانات «همراه‌های دنج»",
    description:
      "ست قالب سیلیکونی سه‌بعدی با فرم مینیاتوری مبلمان و حیوانات خانگی؛ برای موس‌کیک‌های داستانی. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی مینی‌موس‌کیک با فرم مبلمان کوچک و حیوانات خانگی بامزه، جزئیات نرم و فرم‌های گرد",
  },
  "joyful-snackland-mini-dessert-mold-set": {
    title: "ست قالب مینی‌دسر «سرزمین خوشمزه‌ها»",
    description:
      "ست قالب سیلیکونی سه‌بعدی با طرح دسرها و اسنک‌های کوچک؛ برای سفرهٔ شیرینی‌های مینیاتوری. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی مینی‌موس‌کیک با طرح دسرها و تنقلات کوچک، جزئیات بامزه و سطوح صاف",
  },
  "love-letter-floral-bouquet-silicone-mousse-cake-mold": {
    title: "قالب موس دسته‌گل «نامهٔ عاشقانه»",
    description:
      "قالب سیلیکونی سه‌بعدی دسته‌گل همراه با پاکت نامه؛ حال‌وهوای ولنتاین و دلت‌نگری. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم دسته‌گل با پاکت نامهٔ کوچک، گلبرگ‌های لایه‌لایه و روبان نرم",
  },
  "sunflower-bloom-3d-silicone-mousse-cake-mold": {
    title: "قالب موس آفتابگردان «تو آفتاب منی»",
    description:
      "قالب سیلیکونی سه‌بعدی گل آفتابگردان بازشده؛ تابستانی و شاد برای مهمانی‌ها. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم گل آفتابگردان با گلبرگ‌های متقارن و مرکز دانه‌دار برجسته",
  },
  "formflavor-oriental-peony-bloom-3d-silicone-mousse-mold": {
    title: "قالب موس پیونی شرقی",
    description:
      "قالب سیلیکونی سه‌بعدی گل پیونی با گلبرگ‌های چین‌دار و پرحجم؛ ظرامت و شکوه شرقی. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم گل پیونی با گلبرگ‌های چین‌دار لایه‌لایه و مرکز گرد، جزئیات نرم و متقارن",
  },
  "i-love-you-rose-heartfelt-3d-silicone-mold-romantic-mousse-cake-designer-mold": {
    title: "قالب موس قلب رز «دوستت دارم»",
    description:
      "قالب سیلیکونی سه‌بعدی قلبی با گلبرگ‌های رز؛ هدیه‌ای رمانتیک برای تولد و سالگرد. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم قلب پوشیده از گلبرگ‌های رز لایه‌لایه، سطوح منحنی نرم و متقارن",
  },
  "formflavor-best-wishes-tulip-bouquet-3d-mousse-cake-mold": {
    title: "قالب موس دسته‌گل لاله «بهترین آرزوها»",
    description:
      "قالب سیلیکونی سه‌بعدی دسته‌گل لاله؛ بهاری و شیک برای مناسبت‌های خاص. منبع الهام: FormFlavor.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی موس‌کیک به فرم دسته‌گل لاله با گلبرگ‌های صاف و ساقه‌های نرم، چیدمان متقارن",
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

/** Read SEED_SECRET from .env.local (never printed). */
function loadSeedSecret() {
  try {
    const lines = readFileSync(
      path.join(process.cwd(), ".env.local"),
      "utf8",
    ).split(/\r?\n/);
    for (const line of lines) {
      const match = /^SEED_SECRET=(.*)$/.exec(line.trim());
      if (match && match[1]) {
        return match[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // fall through to process env
  }
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

  let catalog;
  try {
    catalog = JSON.parse(readFileSync(path.join(process.cwd(), catalogPath), "utf8"));
  } catch (err) {
    console.error(`Cannot read catalog ${catalogPath}: ${err.message}`);
    process.exit(1);
  }
  const products = catalog.products ?? [];

  const missing = products.filter((p) => !PERSIAN[p.handle]);
  if (missing.length > 0) {
    console.error(
      `No Persian metadata for handle(s): ${missing.map((p) => p.handle).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`Importing ${products.length} FormFlavor product(s) -> ${base}/api/library/import`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
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
        headers: {
          "Content-Type": "application/json",
          "x-seed-key": secret,
        },
        body: JSON.stringify({
          category: CATEGORY,
          title: fa.title,
          description: fa.description,
          seedPrompt: fa.seedPrompt,
          material: MATERIAL,
          imageUrl: image.src,
          source: {
            site: "FormFlavor",
            url: `https://formflavor.com/products/${product.handle}`,
            handle: product.handle,
            productId: String(product.id),
            price: product.variants?.[0]?.price,
            currency: "USD",
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = (await res.json().catch(() => ({}))) ?? {};
      if (res.ok && data.imageId && data.skipped) {
        skipped += 1;
        console.log(`SKIPPED (already imported, ${data.imageId})`);
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
