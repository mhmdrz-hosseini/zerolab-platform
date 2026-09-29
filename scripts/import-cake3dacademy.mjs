#!/usr/bin/env node
/**
 * Cake3D Academy (Payhip) catalog importer.
 *
 * Reads the scraped catalog (.scratch/cake3dacademy/products.json — collected
 * via browser from https://payhip.com/Cake3DAcademy, Cloudflare-protected) and
 * POSTs each product to POST /api/library/import, which downloads the product
 * image and stores it as a PUBLIC library seed (is_seed=true, operator
 * x-seed-key auth). Re-runs are idempotent: the API skips Payhip product ids
 * that already exist (meta.source.handle).
 *
 * Usage:
 *   node scripts/import-cake3dacademy.mjs --url=http://localhost:3001
 *   node scripts/import-cake3dacademy.mjs --dry-run
 *
 * Category check: every product in this shop is a 3D-printable STL cake-mold
 * kit (for casting food-grade silicone molds) → all 30 map to "confectionery"
 * (قنادی و خوراکی). The shop's own collection (modern/fruits/monuments/easter)
 * is preserved in meta.source.shopCategory. Persian title/description/
 * seedPrompt are hand-written per product id below.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/cake3dacademy/products.json";
const CATEGORY = "confectionery";
const MATERIAL =
  "سیلیکون غذایی با سطح داخلی صاف؛ ساخت قالب از کیت پرینت سه‌بعدی STL";

const SHOP_CATEGORY_LABELS = {
  modern: "مدرن",
  fruits: "میوه‌ای",
  monuments: "بنای تاریخی",
  easter: "عید پاک",
};

/** Hand-written Persian metadata, keyed by the Payhip product id (/b/<id>). */
const PERSIAN = {
  fYvIN: {
    title: "کیت قالب کیک گل «Flower Cake»",
    description:
      "کیت STL سه‌بعدی برای ساخت قالب سیلیکونی کیک با طرح گل‌های بازشده، همراه دستور کامل تهیه کیک؛ مناسب قنادان حرفه‌ای. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک مدرن با طرح گل‌های بازشده روی بدنه، گلبرگ‌های لایه‌لایهٔ نرم و سطح صاف",
  },
  wj6HJ: {
    title: "کیت قالب کیک لانه «Nest Cake»",
    description:
      "کیت STL سه‌بعدی با طرح لانهٔ حصیری پر از تخم‌مرغ‌های شیرینی؛ حال‌وهوای بهاری، همراه دستور کامل کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با طرح لانهٔ حصیری تودرتو و بافت نخ‌های درهم‌پیچیده، جزئیات برجسته و یکنواخت",
  },
  vKYit: {
    title: "کیت قالب کیک پارچه‌ای «Draped Cake»",
    description:
      "کیت STL سه‌بعدی با چین‌های پارچه‌ای افتاده روی بدنهٔ کیک؛ ظاهری مجلسی و مدرن، همراه دستور کامل کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با چین‌های پارچهٔ ابریشمی افتاده به‌صورت عمودی، تاخوردگی‌های نرم و سطح صاف بین چین‌ها",
  },
  NDW5M: {
    title: "کیت قالب کیک قلب گل‌دار «Flower Heart»",
    description:
      "کیت STL سه‌بعدی قلب تزئین‌شده با گل‌های ریز؛ مناسب ولنتاین و مناسبت‌های عاشقانه، همراه دستور کامل کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم قلب پوشیده از گل‌های کوچک لایه‌لایه، لبه‌های گرد و سطوح نرم",
  },
  "5om4c": {
    title: "کیت قالب کیک جنگل سیاه «Black Forest»",
    description:
      "کیت STL سه‌بعدی الهام‌گرفته از کیک کلاسیک جنگل سیاه؛ مناسب موس شکلاتی و پرکردنی‌های گیلاسی، همراه دستور کامل. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با طرح کلاسیک جنگل سیاه، موج‌های شکلاتی و گیلاس‌های برجسته روی بدنه",
  },
  HIlup: {
    title: "کیت قالب کیک موج‌دار «Wave Cake»",
    description:
      "کیت STL سه‌بعدی با امواج مواج و سیال روی بدنهٔ کیک؛ طراحی مدرن و مجسمه‌وار، همراه دستور کامل کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با امواج سیال متقارن دور بدنه، شیارهای نرم و عمیق با زوایای گرد",
  },
  "6EhC1": {
    title: "کیت قالب بلوبری و سبد «Blueberry + Basket»",
    description:
      "کیت STL سه‌بعدی دوتایی: سبد حصیری پر از بلوبری؛ مجموعه‌ای روایی از سری میوه‌ای فروشگاه، همراه دستور کامل کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم سبد حصیری با بافت تار و پود، پر از بلوبری‌های کروی برجسته",
  },
  ntpZ1: {
    title: "کیت قالب کیک قلب «Heart Cake»",
    description:
      "کیت STL سه‌بعدی قلب ساده و مینیمال؛ اقتصادی‌ترین کیت فروشگاه، همراه دستور کامل تهیه کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم قلب مینیمال با سطوح صاف و لبهٔ گرد تمیز",
  },
  stZYP: {
    title: "کیت قالب کیک بلوبری «Blueberry Cake»",
    description:
      "کیت STL سه‌بعدی با بلوبری‌های ریز و برجسته روی بدنه؛ از سری میوه‌ای فروشگاه، همراه دستور کامل کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با بلوبری‌های کروی برجستهٔ ریز پراکنده روی بدنه، بافت یکنواخت و نرم",
  },
  LKQqb: {
    title: "کیت قالب تخم‌مرغ و لانه «Egg + Nest»",
    description:
      "کیت STL سه‌بعدی تخم‌مرغ داخل لانهٔ حصیری؛ ست عید پاک، همراه دستور کامل تهیه کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس به فرم تخم‌مرغ نشسته در لانهٔ حصیری، بافت نخ‌های ظریف و سطح صاف تخم‌مرغ",
  },
  rqCcQ: {
    title: "کیت قالب تخم‌مرغ طرحدار «Egg Design»",
    description:
      "کیت STL سه‌بعدی تخم‌مرغ با نقش‌های تزئینی برجسته؛ مناسب عید پاک، همراه دستور کامل تهیه کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس به فرم تخم‌مرغ با نقش‌های هندسی برجستهٔ تکرارشونده و سطح صاف بین نقش‌ها",
  },
  xWl9Z: {
    title: "کیت قالب تخم‌مرغ پارچه‌ای «Draped Egg»",
    description:
      "کیت STL سه‌بعدی تخم‌مرغ با چین‌های پارچه‌ای نرم؛ ترکیب کلاسیک عید پاک و ظرافت مجسمه‌ای، همراه دستور کامل کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس به فرم تخم‌مرغ با چین‌های پارچهٔ نرم پیچیده دور بدنه، تاخوردگی‌های طبیعی و یکنواخت",
  },
  Ytcpd: {
    title: "کیت قالب کیک مونا لیزا «Mona Lisa»",
    description:
      "کیت STL سه‌بعدی با نقش برجستهٔ پرترهٔ مونا لیزا؛ اثری هنری از سری بناهای تاریخی فروشگاه. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با نقش برجستهٔ پرترهٔ مونا لیزا، جزئیات ظریف چهره و پرداخت سطح یکنواخت",
  },
  "6ObzV": {
    title: "کیت قالب کیک موزِه «Muse Cake»",
    description:
      "کیت STL سه‌بعدی با طرح پیکرهٔ هنری کلاسیک؛ ظاهری مجسمه‌وار و استودیویی برای ویترین قنادی. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با طرح پیکرهٔ هنری زنانهٔ کلاسیک، خطوط منحنی نرم و جزئیات مجسمه‌ای",
  },
  L5i8v: {
    title: "کیت قالب کیک تاج‌محل «Taj Mahal»",
    description:
      "کیت STL سه‌بعدی الهام‌گرفته از معماری تاج‌محل؛ گنبد و مناره‌های منبت‌کاری‌شده، از سری بناهای تاریخی. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم گنبد و مناره‌های تاج‌محل، جزئیات معماری برجسته و متقارن",
  },
  yFEZN: {
    title: "کیت قالب کیک عدد «−۱۸»",
    description:
      "کیت STL سه‌بعدی با نقش عدد ۱۸؛ مناسب کیک تولد و جشن فارغ‌التحصیلی. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با نقش عدد برجستهٔ بزرگ و سطوح صاف، لبه‌های تمیز و یکنواخت",
  },
  E4w7y: {
    title: "کیت قالب کیک نیلوفر «Lotus Cake»",
    description:
      "کیت STL سه‌بعدی با گل نیلوفر آبی چندلایه؛ طراحی آرام و مدرن برای موس‌کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با گل نیلوفر آبی لایه‌لایه، گلبرگ‌های کشیدهٔ نرم و مرکز برجسته",
  },
  mOgAw: {
    title: "کیت قالب کیک شکوفای یاقوتی «Ruby Bloom»",
    description:
      "کیت STL سه‌بعدی با شکفته‌های گل و جزئیات جواهرنما؛ شکوه و درخشش برای مناسبت‌های خاص. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با گل‌های شکفته و جزئیات برجستهٔ جواهرنما، گلبرگ‌های لایه‌لایه و سطح صاف",
  },
  TtDKc: {
    title: "کیت قالب کیک مدال سزار «Caesar Medallion»",
    description:
      "کیت STL سه‌بعدی با نقش نیم‌تنهٔ کلاسیک به سبک مدال‌های رومی؛ حس آنتیک و باشکوه. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با نقش نیم‌تنهٔ کلاسیک به سبک مدال رومی، قاب برجستهٔ گرد و جزئیات ظریف",
  },
  qr6Zc: {
    title: "کیت قالب کیک خارپوست دریایی «Sea Urchin»",
    description:
      "کیت STL سه‌بعدی با بافت خارهای ریز کروی؛ طراحی آفرند و مجسمه‌وار الهام‌گرفته از دریا. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با بافت خارهای ریز کروی مثل خارپوست دریایی، برجستگی‌های یکنواخت و متراکم",
  },
  va2Ng: {
    title: "کیت قالب کیک مروارید «Perle Passion»",
    description:
      "کیت STL سه‌بعدی با مرواریدها و پوستهٔ صدف؛ لطیف و لوکس برای موس‌کیک‌های خاص. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با مرواریدهای کروی برجسته و پوستهٔ صدف با شیارهای شعاعی، سطوح صاف و براق‌نما",
  },
  "6hGpa": {
    title: "کیت قالب کیک ناتیلوس «Nautilus»",
    description:
      "کیت STL سه‌بعدی با فرم صدف مارپیچ ناتیلوس؛ ریاضیات طبیعت به شکل دسر. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم صدف مارپیچ ناتیلوس، اتاقک‌های مارپیچی با لبه‌های برجسته و سطح صاف",
  },
  I4NCS: {
    title: "کیت قالب کیک خرس کوچولو «Little Bear»",
    description:
      "کیت STL سه‌بعدی با فرم خرس بامزه؛ محبوب کودکان و جشن‌های تولد. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم خرس کوچولوی نشسته با گوش‌های گرد و پوزهٔ برجسته، فرم‌های نرم و یک‌تکه",
  },
  "57zG4": {
    title: "کیت قالب کیک آناناس «Pineapple»",
    description:
      "کیت STL سه‌بعدی با بافت الماسی و تاج برگ آناناس؛ استوایی و پرانرژی، از سری میوه‌ای. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم آناناس با بافت الماسی تکرارشونده و تاج برگ‌های برجسته، جزئیات یکنواخت",
  },
  "0WEhT": {
    title: "کیت قالب کیک تمشک «Raspbearry»",
    description:
      "کیت STL سه‌بعدی با دانه‌های تمشک برجسته؛ از سری میوه‌ای فروشگاه با جزئیات واقع‌گرایانه. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم تمشک با دانه‌های کروی برجستهٔ متراکم، سطوح نرم و یکنواخت",
  },
  JUXTE: {
    title: "کیت قالب بستنی قیفی «Ice Cream Cup»",
    description:
      "کیت STL سه‌بعدی به فرم لیوان بستنی؛ سرو موس و دسر به شکل بستنی، دوست‌داشتنی برای فصل تابستان. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس به فرم لیوان بستنی با چین‌های عمودی و سطح داخلی صاف، فرم گرد و متقارن",
  },
  v3Tjp: {
    title: "کیت قالب کیک یاقوتی «Ruby Cake»",
    description:
      "کیت STL سه‌بعدی با وجوه برش‌خوردهٔ جواهر یاقوت؛ طراحی جواهرنما و مدرن برای ویترین. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با وجوه برش‌خوردهٔ جواهر یاقوت، پره‌های هندسی تیز اما یک‌تکه و سطوح صاف",
  },
  T5HCs: {
    title: "کیت قالب کیک کاکائو «Cacao Cake»",
    description:
      "کیت STL سه‌بعدی با حبوبات و دانه‌های کاکائو؛ ضروری برای قنادان شکلات‌کار. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با دانه‌ها و حبوبات کاکائوی برجسته، بافت واقع‌گرایانه و سطوح یکنواخت",
  },
  mzuv3: {
    title: "کیت قالب کیک استوایی «Tropical»",
    description:
      "کیت STL سه‌بعدی با میوه‌های استوایی؛ حس تعطیلات و تابستان در یک موس‌کیک. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با طرح میوه‌های استوایی مثل انبه و پاپایا، جزئیات واقع‌گرایانه و سطوح نرم",
  },
  sLHjU: {
    title: "کیت قالب کیک شکفته «Bloom Cake»",
    description:
      "کیت STL سه‌بعدی با گل‌های بازشده؛ همراه دستور کامل تهیه کیک، از کیت‌های اقتصادی فروشگاه. منبع الهام: Cake3D Academy.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک با گل‌های بازشدهٔ لایه‌لایه روی بدنه، گلبرگ‌های نرم و سطح صاف",
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

  const missing = products.filter((p) => !PERSIAN[p.id]);
  if (missing.length > 0) {
    console.error(
      `No Persian metadata for product id(s): ${missing.map((p) => p.id).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`Importing ${products.length} Cake3D Academy product(s) -> ${base}/api/library/import`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, product] of products.entries()) {
    const fa = PERSIAN[product.id];
    const tag = `[${index + 1}/${products.length}] ${fa.title}`;
    if (!product.imageS3) {
      failed += 1;
      console.log(`${tag} — FAIL no image in catalog`);
      continue;
    }
    if (dryRun) {
      console.log(`${tag} — would import ${product.imageS3}`);
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
          imageUrl: product.imageS3,
          source: {
            site: "Cake3D Academy (Payhip)",
            url: product.url,
            handle: product.id,
            productId: product.id,
            price: product.price,
            currency: product.currency ?? "EUR",
            ...(product.shopCategory
              ? {
                  shopCategory: product.shopCategory,
                  shopCategoryLabel: SHOP_CATEGORY_LABELS[product.shopCategory] ?? product.shopCategory,
                }
              : {}),
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
