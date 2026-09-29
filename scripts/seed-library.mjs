#!/usr/bin/env node
/**
 * Library seed script (ticket 15).
 *
 * Reads SEED_SECRET from .env.local and POSTs one job per image to
 * POST /api/library/seed, which calls the Aval image API server-side and
 * stores the row with is_seed=true (NO image credits consumed).
 *
 * Usage:
 *   node scripts/seed-library.mjs --category=all --count=1   # 7 images (smoke test)
 *   node scripts/seed-library.mjs --category=candle --count=6
 *
 * Data: ~6 motifs per category, from issue 03 («ایده‌های محبوب هر دسته»).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3000";

/** 7 categories (issues 03 + 08) — slugs must match the API routes. */
const DATA = {
  confectionery: {
    label: "قنادی و خوراکی",
    material: "ظاهر فوندانت صاف و مات با برجستگی‌های نرم",
    items: [
      {
        title: "مولد اسلیمی و ترنج",
        description:
          "قالب فوندانت گرد با نقش اسلیمی و ترنج ایرانی برای تزئین سطح کیک.",
        seedPrompt:
          "قالب فوندانت گرد با نقش اسلیمی و ترنج ایرانی در مرکز، گلبرگ‌های پیچشی نرم، برجستگی ملایم و یکنواخت، سبک تذهیب ایرانی",
      },
      {
        title: "مولد گیپور و لیس",
        description:
          "نوار و گوشه‌های گیپوری برای قاب دور کیک؛ الگوی تکرارشوندهٔ ظریف.",
        seedPrompt:
          "قالب فوندانت نوار گیپور با الگوی لیس تکرارشونده، گل‌های ریزی که با نخ‌های ظریف به هم وصل شده‌اند، عمق کم و لبه‌های تمیز",
      },
      {
        title: "مولد گل رز",
        description: "گل رز لایه‌لایه با گلبرگ‌های باز برای تزئین کیک و شکلات.",
        seedPrompt:
          "قالب فوندانت گل رز با گلبرگ‌های لایه‌لایهٔ بازشده، مرکز پیچیده، برجستگی نرم گلبرگ‌ها، فرم گرد و متقارن",
      },
      {
        title: "مولد داوودی",
        description: "داوودی چندپر با مرکز برجسته؛ کلاسیک قنادی‌ها.",
        seedPrompt:
          "قالب فوندانت گل داوودی با گلبرگ‌های باریک و متقارن دور مرکز برجستهٔ گرد، عمق یکنواخت گلبرگ‌ها",
      },
      {
        title: "مولد آلاله",
        description: "آلاله با گلبرگ‌های چین‌دار برای تزئین مینیمال کیک.",
        seedPrompt:
          "قالب فوندانت گل آلاله با گلبرگ‌های چین‌دار ظریف و مرکز جمع‌شده، فرم نیم‌باز طبیعی",
      },
      {
        title: "مولد یلدا",
        description: "انار و هندوانه با نقش یلدایی؛ شب‌یلدا و مهمانی‌ها.",
        seedPrompt:
          "قالب فوندانت طرح یلدا با انار بازشده و برش هندوانه کنار هم، دانه‌های برجستهٔ گرد، حال‌وهوای سنتی شب یلدا",
      },
    ],
  },
  resin: {
    label: "رزین و زیورآلات",
    material: "رزین شفاف و براق، بدون حباب",
    items: [
      {
        title: "آویز آسمان شب",
        description: "ماه و ستاره در آسمان شب؛ پرطرفدارترین طرح رزین.",
        seedPrompt:
          "قالب سیلیکونی آویز گرد با طرح آسمان شب، هلال ماه و ستاره‌های کوچک با برجستگی کم، سطح صاف و لبه‌های گرد",
      },
      {
        title: "گوشواره گل خشک",
        description: "قاب گوشواره برای گل خشک و مینا؛ فرم هندسی ساده.",
        seedPrompt:
          "قالب سیلیکونی گوشوارهٔ هندسی کوچک با قاب ساده و کف صاف برای چیدن گل خشک، بدون undercut، لبه‌های تمیز",
      },
      {
        title: "آویز گل مینا",
        description: "گل مینای پنج‌پر با قاب قلبی؛ ظریف و دوست‌داشتنی.",
        seedPrompt:
          "قالب سیلیکونی آویز قلبی با نقش گل مینای پنج‌پر برجسته در مرکز، جزئیات ملایم و سطح داخلی صاف",
      },
      {
        title: "زیرلیوانی موج اقیانوس",
        description: "موج و کف دریا با رزین آبی؛ زیرلیوانی دایره‌ای.",
        seedPrompt:
          "قالب سیلیکونی زیرلیوانی دایره‌ای با نقش موج اقیانوس و کف دریا، برجستگی ملایم موج‌ها و لبهٔ گرد صاف",
      },
      {
        title: "دروزی هندسی",
        description: "دروزی کریستالی داخل قاب هندسی؛ مدرن و مینیمال.",
        seedPrompt:
          "قالب سیلیکونی قاب شش‌ضلعی با نقش دروزی کریستالی برجسته در مرکز، خطوط هندسی تیز اما یک‌تکه، بدون قطعهٔ نازک جداشده",
      },
      {
        title: "قلب زنجیرکلید",
        description: "قلب ساده با جای اسم؛ برای هدیه و زنجیر کلید.",
        seedPrompt:
          "قالب سیلیکونی قلب کوچک با سطح داخلی صاف و برجستگی کم برای نوشتن اسم، حلقهٔ اتصال ضخیم یک‌تکه در بالا",
      },
    ],
  },
  candle: {
    label: "شمع",
    material: "موم صیقلی با جزئیات واضح",
    items: [
      {
        title: "شمع کاکتوس",
        description: "کاکتوس سه‌بعدی بامزه؛ پرفروش شمع‌سازها.",
        seedPrompt:
          "قالب سیلیکونی شمع سه‌بعدی کاکتوس استوانه‌ای با خارهای برجستهٔ نرم و گل کوچک روی سر، فرم یک‌تکه با کف صاف",
      },
      {
        title: "شمع کدو پاییزی",
        description: "کدو پاییزی با شیارهای نرم؛ حس پاییز و هالووین.",
        seedPrompt:
          "قالب سیلیکونی شمع کدو پاییزی گرد با شیارهای عمودی نرم و ساقهٔ کوتاه، سطح صیقلی و فرم متقارن",
      },
      {
        title: "شمع گل رز",
        description: "غنچهٔ رز مچ‌سایز برای شمع و واکس ملت.",
        seedPrompt:
          "قالب سیلیکونی شمع غنچهٔ رز با گلبرگ‌های چرخیدهٔ نرم، عمق متوسط گلبرگ و فرم گرد متقارن",
      },
      {
        title: "زوج مجسمه‌ای",
        description: "دو فیگور انسانی مینیمال روبه‌روی هم؛ دکور استودیویی.",
        seedPrompt:
          "قالب سیلیکونی شمع دوتایی، دو فیگور انسانی انتزاعی مینیمال که روبه‌روی هم ایستاده‌اند، فرم‌های صاف و منحنی با پایهٔ مشترک",
      },
      {
        title: "پیلار بافت‌دار",
        description: "پیلار ساده با بافت بافندگی؛ کلاسیک دکور.",
        seedPrompt:
          "قالب سیلیکونی شمع پیلار استوانه‌ای با بافت بافندگی تکرارشونده و لبه‌های نرم، کف صاف با سوراخ فتیله",
      },
      {
        title: "وتیو گل‌دار",
        description: "وتیو کلاسیک با تاج گل برجسته.",
        seedPrompt:
          "قالب سیلیکونی شمع وتیو با تاج گل و برگ برجسته روی بدنهٔ منحنی، دیوارهٔ یکنواخت و کف صاف",
      },
    ],
  },
  soap: {
    label: "صابون و بهداشتی",
    material: "صابون مات با جزئیات شفاف",
    items: [
      {
        title: "صابون لانه‌زنبوری",
        description: "الگوی لانه‌زنبور؛ محبوب صابون‌سازهای دست‌ساز.",
        seedPrompt:
          "قالب سیلیکونی صابون بار با الگوی لانه‌زنبور شش‌ضلعی تکرارشونده، برجستگی کم و یکنواخت، لبه‌های گرد تمیز",
      },
      {
        title: "صابون گل و برگ",
        description: "تاج گل و برگ با برجستگی ملایم؛ حس طبیعی.",
        seedPrompt:
          "قالب سیلیکونی صابون مربع با تاج گل و برگ برجسته در مرکز، عمق متوسط و لبه‌های نرم",
      },
      {
        title: "صابون سنگ قیمتی",
        description: "فرم کریستال و سنگ قیمتی؛ برش‌های هندسی.",
        seedPrompt:
          "قالب سیلیکونی صابون به فرم کریستال سنگ قیمتی با وجوه هندسی براق و خطوط برش تیز اما یک‌تکه",
      },
      {
        title: "مُهر دایرهٔ سنتی",
        description: "دایرهٔ سنتی با نقش اسلیمی کم‌عمق؛ مناسب مُهر کوکی هم.",
        seedPrompt:
          "قالب سیلیکونی صابون دایره‌ای با نقش اسلیمی کم‌عمق در قاب دندانه‌دار، برجستگی یکنواخت و لبهٔ تمیز",
      },
      {
        title: "بمب حمام دوتکه",
        description: "دو نیمهٔ کره با لبهٔ هم‌پوشان؛ برای بمب حمام.",
        seedPrompt:
          "قالب سیلیکونی بمب حمام دو نیمهٔ کروی با لبهٔ هم‌پوشان و سطح کاملاً صیقلی، بدون undercut",
      },
      {
        title: "صابون صدف و موج",
        description: "صدف داخل موج؛ حس ساحل و تابستان.",
        seedPrompt:
          "قالب سیلیکونی صابون بیضی با نقش صدف و موج دریا، برجستگی ملایم موج‌ها و لبهٔ گرد",
      },
    ],
  },
  plaster: {
    label: "گچ، بتن و پودر سنگ",
    material: "گچ مات سفید با لبه‌های تیز و تمیز",
    items: [
      {
        title: "جاشمعی قوسی",
        description: "جاشمعی با طاق‌های قوسی؛ دکور مینیمال مدرن.",
        seedPrompt:
          "قالب سیلیکونی جاشمعی با طاق‌های قوسی هندسی و بدنهٔ مینیمال، خطوط تیز و کف صاف، دیوارهٔ ضخیم",
      },
      {
        title: "گلدان مینیمال",
        description: "گلدان مینیمال گرد با گردن باریک؛ پرتکرار گچ و بتن.",
        seedPrompt:
          "قالب سیلیکونی گلدان مینیمال با بدنهٔ گرد و گردن باریک، سطح صاف و فرم متقارن، دیوارهٔ یکنواخت",
      },
      {
        title: "پنل اسلیمی",
        description: "پنل دیواری با نقش اسلیمی برجسته؛ بزرگ و شیک.",
        seedPrompt:
          "قالب سیلیکونی پنل دیواری مستطیل با نقش اسلیمی برجستهٔ متقارن، خطوط عمیق و تمیز، گوشه‌های گرد",
      },
      {
        title: "ست یلدایی",
        description: "تری و شمع‌خوری با نقش انار؛ ست یلدا.",
        seedPrompt:
          "قالب سیلیکونی ست یلدایی شامل تری و شمع‌خوری با نقش انار و برگ برجسته، فرم دایره‌ای و لبه‌های تمیز",
      },
      {
        title: "نیم‌تنه باستان‌گرا",
        description: "نیم‌تنهٔ مجسمهٔ کلاسیک؛ دکور استودیویی هنری.",
        seedPrompt:
          "قالب سیلیکونی نیم‌تنهٔ مجسمهٔ کلاسیک یونانی با جزئیات ملایم چهره و مو، پایهٔ صاف و فرم یک‌تکه",
      },
      {
        title: "قندان هندسی",
        description: "ظرف چندخانهٔ هندسی؛ برای گچ و پودر سنگ.",
        seedPrompt:
          "قالب سیلیکونی ظرف هندسی چندخانه با وجوه تیز و دیوارهٔ ضخیم، کف صاف و فرم متقارن",
      },
    ],
  },
  figures: {
    label: "فیگور و مینیاتور",
    material: "فیگور با جزئیات تمیز و برجستگی ملایم",
    items: [
      {
        title: "فیگور خرس",
        description: "خرس بامزهٔ نشسته؛ محبوب بچه‌ها و دکور.",
        seedPrompt:
          "قالب سیلیکونی فیگور خرس بامزهٔ نشسته با گوش‌های گرد و پوزهٔ برجسته، خطوط نرم و فرم یک‌تکه",
      },
      {
        title: "فیگور خرگوش",
        description: "خرگوش نشسته با گوش‌های بلند؛ حس بهاری.",
        seedPrompt:
          "قالب سیلیکونی فیگور خرگوش نشسته با گوش‌های بلند گرد و دم کوچک، جزئیات ملایم و پایهٔ صاف",
      },
      {
        title: "فیگور پرنده",
        description: "پرندهٔ کوچک نشسته روی شاخه؛ ظریف و ساده.",
        seedPrompt:
          "قالب سیلیکونی فیگور پرندهٔ کوچک نشسته روی شاخهٔ برجسته، پرهای نرم و فرم گرد یک‌تکه",
      },
      {
        title: "عروسک بافت‌نما",
        description: "عروسک سادهٔ بافت‌نما؛ بدون کپی از کاراکترها.",
        seedPrompt:
          "قالب سیلیکونی عروسک سادهٔ انسانی با بدن بافت‌نما و سر گرد، جزئیات چهرهٔ حداقلی و فرم یک‌تکه",
      },
      {
        title: "فیگور دایناسور",
        description: "دایناسور بامزهٔ گرد و کوچک؛ محبوب بچه‌ها.",
        seedPrompt:
          "قالب سیلیکونی فیگور دایناسور بامزه با فرم گرد و پوزهٔ کوتاه، خارهای پشتی برجستهٔ نرم و پایهٔ صاف",
      },
      {
        title: "فیگور گربه",
        description: "گربهٔ نشسته با دم پیچیده؛ مینیمال و دوست‌داشتنی.",
        seedPrompt:
          "قالب سیلیکونی فیگور گربهٔ نشسته با دم پیچیده دور بدن و گوش‌های مثلثی نرم، فرم مینیمال یک‌تکه",
      },
    ],
  },
  keepsake: {
    label: "یادگاری و سفارشی",
    material: "پودر سنگ نرم با جزئیات واضح",
    items: [
      {
        title: "تندیس دست نوزاد",
        description: "تندیس دست نوزاد؛ یادگاری ماندگار خانواده.",
        seedPrompt:
          "قالب سیلیکونی تندیس دست نوزاد مشت‌شده با انگشتان نرم و جزئیات دقیق، پایهٔ گرد صاف",
      },
      {
        title: "تندیس پای نوزاد",
        description: "تندیس پای نوزاد؛ جفتِ تندیس دست.",
        seedPrompt:
          "قالب سیلیکونی تندیس پای نوزاد با انگشتان کوچک و پاشنهٔ گرد، جزئیات دقیق و پایهٔ صاف",
      },
      {
        title: "تندیس پنجه",
        description: "پنجهٔ حیوانات خانگی؛ یادبود دوست چهارپا.",
        seedPrompt:
          "قالب سیلیکونی تندیس پنجهٔ حیوانات با بالشتک‌های برجستهٔ گرد و جزئیات ناخن ملایم، قاب دایره‌ای صاف",
      },
      {
        title: "قلب با اسم و تاریخ",
        description: "قلب برجسته با جای نوشتن اسم و تاریخ؛ هدیهٔ شخصی.",
        seedPrompt:
          "قالب سیلیکونی قلب برجسته با نوار صاف دور بدنه برای نوشتن اسم و تاریخ، سطح صیقلی و فرم متقارن",
      },
      {
        title: "حروف فارسی سه‌بعدی",
        description: "حروف فارسی برجسته برای اسم‌ها؛ یادگاری و دکور.",
        seedPrompt:
          "قالب سیلیکونی حروف فارسی سه‌بعدی برجسته با ضخامت یکنواخت و لبه‌های نرم، چیده‌شده در یک ردیف روی پایهٔ صاف",
      },
      {
        title: "ست قلب و ستاره",
        description: "جفت قلب و ستارهٔ کوچک؛ ست هدیهٔ تولد.",
        seedPrompt:
          "قالب سیلیکونی ست چندحفرهٔ قلب و ستارهٔ کوچک با برجستگی کم و لبه‌های گرد، حفره‌های جدا با کف صاف",
      },
    ],
  },
};

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(raw);
    if (match) args[match[1]] = match[2];
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
  const secret = loadSeedSecret();
  if (!secret) {
    console.error("SEED_SECRET not found — set it in .env.local first.");
    process.exit(1);
  }

  const categoryArg = args.category ?? "all";
  const slugs =
    categoryArg === "all"
      ? Object.keys(DATA)
      : categoryArg
          .split(",")
          .map((slug) => slug.trim())
          .filter(Boolean);
  for (const slug of slugs) {
    if (!DATA[slug]) {
      console.error(
        `Unknown category "${slug}". Valid: all, ${Object.keys(DATA).join(", ")}`,
      );
      process.exit(1);
    }
  }
  const count = Math.max(1, Number.parseInt(args.count ?? "1", 10) || 1);

  const jobs = [];
  for (const slug of slugs) {
    const cat = DATA[slug];
    for (const item of cat.items.slice(0, count)) {
      jobs.push({ slug, cat, item });
    }
  }

  console.log(`Seeding ${jobs.length} image(s) -> ${base}/api/library/seed`);
  let ok = 0;
  let failed = 0;
  for (const [index, job] of jobs.entries()) {
    const tag = `[${index + 1}/${jobs.length}] ${job.cat.label} — ${job.item.title}`;
    process.stdout.write(`${tag} … `);
    try {
      const res = await fetch(`${base}/api/library/seed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-seed-key": secret,
        },
        body: JSON.stringify({
          category: job.slug,
          title: job.item.title,
          description: job.item.description,
          seedPrompt: job.item.seedPrompt,
          material: job.cat.material,
          aspectRatio: job.item.aspectRatio ?? "1:1",
        }),
        signal: AbortSignal.timeout(240000),
      });
      const data = (await res.json().catch(() => ({}))) ?? {};
      if (res.ok && data.imageId) {
        ok += 1;
        console.log(`OK (${data.imageId})`);
      } else {
        failed += 1;
        console.log(`FAIL ${res.status} ${data.error ?? ""}`.trim());
      }
    } catch (err) {
      failed += 1;
      console.log(`FAIL ${err?.message ?? err}`);
    }
  }

  console.log(`Done: ${ok} ok, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
