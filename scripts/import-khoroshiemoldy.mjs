#!/usr/bin/env node
/**
 * Khoroshie Moldy (хорошиемолды.рф) catalog importer.
 *
 * Reads .scratch/khoroshie-moldy/products.json (Tilda Store API
 * store.tildaapi.com/api/getproductslist/, storepart 275187615012) and POSTs
 * each product to POST /api/library/import as a public library seed. Re-runs
 * are idempotent (dedupe by meta.source.handle = Tilda product uid).
 *
 * Scope decisions:
 * - The shop is "author's silicone molds for plaster and wax"; every design
 *   is a two-part gypsum-casting planter/sculpture mold → ALL map to
 *   "plaster" (گچ، بتن و پودر سنگ), same as the stone-powder line of mrmolds.
 * - Spare lids/roofs for other molds (retro-car roofs ×5, extra thistle lid)
 *   are accessories, not standalone designs → SKIPPED.
 *
 * Usage:
 *   node scripts/import-khoroshiemoldy.mjs --url=http://localhost:3001
 *   node scripts/import-khoroshiemoldy.mjs --dry-run
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/khoroshie-moldy/products.json";
const CATEGORY = "plaster";
const MATERIAL = "پودر سنگ با سطح مات و لبه‌های تمیز";
const SITE = "Khoroshie Moldy";

/** Tilda product uids of spare accessories (retro-car roofs + thistle lid). */
const SKIP_UIDS = new Set([
  556758408692, // Стандартная крыша для ретро-машины
  179164631882, // Крыша с ёлкой для ретро-машины
  791374760492, // Крыша с тыквами для ретро-машины
  228931041572, // Крыша с чемоданами для ретро-машины
  934709574962, // Крыша с арбузами для ретро-машины
  351868277402, // ДОПОЛНИТЕЛЬНАЯ КРЫШКА НА МОЛД "ЧЕРТОПОЛОХ"
]);

/** Hand-written Persian metadata, keyed by Tilda product uid. */
const PERSIAN = {
  125220756852: {
    title: "قالب سیلیکونی هواپیمای خلبان کوچولو",
    description:
      "قالب دوتکه (بدنه + درپوش) برای ساخت گلدان گچی به فرم هواپیمای کوچک؛ ابعاد ۱۳×۱۴×۱۱ سانتی‌متر. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم هواپیمای کوچک با پروپیلر و دم، جزئیات بدنهٔ برجسته و سطوح صاف آماده رنگ‌آمیزی، حفرهٔ گرد بالایی برای گلدان",
  },
  372499988883: {
    title: "قالب سیلیکونی سبد کروسان",
    description:
      "قالب دوتکه سبد کروسان برای گچ؛ ابعاد ۱۱٫۵×۱۰٫۵×۱۰٫۵ سانتی‌متر، گنجایش موم ~۱۲۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم سبد بافتهٔ کروسان‌های لایه‌ای و درپوش تپهٔ کروسان برشته، جزئیات خمیر لایه‌لایه و بافت توری سبد",
  },
  952968067633: {
    title: "قالب سیلیکونی آدم‌برفی کوچولو",
    description:
      "قالب دوتکه آدم‌برفی برای گچ؛ ابعاد ۱۰×۱۰×۹ سانتی‌متر، گلدان با گنجایش ۱۱۷ گرم موم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم آدم‌برفی کوچک با کلاه لبه‌دار و شال بافتنی، سطوح نرم و متقارن، حفرهٔ بالایی برای گلدان",
  },
  805206974073: {
    title: "قالب سیلیکونی کدو حلوایی دست‌ساز",
    description:
      "قالب دوتکه کدو حلوایی برای گچ؛ قطر خارجی ۱۲، ارتفاع ۱۲ سانتی‌متر، گنجایش آب ۴۰۵ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم کدو حلوایی با شیارهای عمودی طبیعی و ساقهٔ پیچ‌خورده، سطح مات آماده رنگ، حفرهٔ بالایی",
  },
  886608727053: {
    title: "قالب سیلیکونی قلعهٔ شنی",
    description:
      "قالب دوتکه قلعهٔ شنی برای گچ؛ ارتفاع ۱۳٫۵ سانتی‌متر، گنجایش آب ۳۹۹ گرم، گلدان مربع ۵٫۲×۵٫۲. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم قلعهٔ شنی با برج‌ها، کنگره‌ها و پله‌های ماسه‌ای، بافت دانه‌ای نرم و جزئیات معماری برجسته",
  },
  929946998823: {
    title: "قالب سیلیکونی جعبهٔ ماندارین",
    description:
      "قالب دوتکه: جعبهٔ چوبی گلدان + درپوش تپهٔ ماندارین؛ گلدان با گنجایش ~۹۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم صندوق چوبی ماندارین با تخته‌های عمودی و درپوش تپهٔ ماندارین‌های برگ‌دار، بافت چوب و پوست نارنج برجسته",
  },
  471544987853: {
    title: "قالب سیلیکونی آبکش گیلاس",
    description:
      "قالب دوتکه: آبکش گلدان + درپوش تپهٔ گیلاس؛ دسته‌ها با سوراخ برای عبور. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم آبکش فلزی با سوراخ‌های ریز و دسته، درپوش تپهٔ گیلاس‌های سرخ ساقه‌دار، جزئیات فلز سوراخ‌دار و میوه‌های برجسته",
  },
  467452807992: {
    title: "قالب سیلیکونی پشتهٔ کتاب",
    description:
      "قالب دوتکه پشتهٔ کتاب + قالب‌بند پایه؛ ارتفاع ۹٫۶ سانتی‌متر، گنجایش آب ۳۷۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم پشتهٔ کتاب‌های چرمی قدیمی با عطف‌های برجسته و لبهٔ صفحات، حفرهٔ بالایی، جزئیات کلاسیک",
  },
  283357138892: {
    title: "قالب سیلیکونی تنهٔ درخت جنگلی",
    description:
      "قالب دوتکه تنهٔ کامل + قالب‌بند؛ ارتفاع ۱۵ سانتی‌متر، گنجایش آب ۴۱۰ گرم، درپوش داخل تنه می‌نشیند. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم تنهٔ درخت جنگلی با بافت پوست و حلقه‌های چوب، شاخهٔ کوچک کناری، حفرهٔ بالایی، جزئیات طبیعی",
  },
  286619259682: {
    title: "قالب سیلیکونی موش‌ها",
    description:
      "قالب دوتکه + دو قالب‌بند؛ گروهی از موش‌ها، گنجایش آب ۳۹۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم گروهی از موش‌های کوچک با دم‌های پیچ‌خورده و گوش‌های گرد، جزئیات مو و فرم‌های واقع‌گرایانه",
  },
  895721343772: {
    title: "قالب سیلیکونی برهٔ خواب‌آلود",
    description:
      "قالب دوتکه بره؛ ارتفاع ۱۳٫۵ سانتی‌متر، گنجایش آب ۴۳۵ گرم، گلدان ۵٫۵×۴٫۷. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم برهٔ خواب‌آلود با پشم پفکی لایه‌لایه و گوش‌های آویزان، سطوح نرم و چهرهٔ بامزه",
  },
  917471379122: {
    title: "قالب سیلیکونی ماشین وینتیج",
    description:
      "قالب دوتکه ماشین قدیمی؛ طول ۱۷، عرض ۸، ارتفاع ۷٫۵ سانتی‌متر، گنجایش آب ۳۵۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم ماشین وینتیج با گلگیرهای برجسته، چراغ‌های گرد و صندوق هیزمی، سطوح صاف و جزئیات کلاسیک، حفرهٔ بالایی",
  },
  970378816502: {
    title: "قالب سیلیکونی ماشین وینتیج با چمدان",
    description:
      "قالب دوتکه ماشین وینتیج با چمدان‌ها روی سقف؛ طول ۱۷، ارتفاع ۱۰٫۱ سانتی‌متر، گنجایش آب ۳۵۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم ماشین وینتیج با چمدان‌های چرمی بسته‌شده با کمربند روی سقف، جزئیات سفر کلاسیک، سطوح صاف",
  },
  718504531182: {
    title: "قالب سیلیکونی ماشین وینتیج با کدو حلوایی",
    description:
      "قالب دوتکه ماشین وینتیج با کدوهای حلوایی روی سقف؛ طول ۱۷، ارتفاع ۱۰٫۱ سانتی‌متر. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم ماشین وینتیج با کدو حلوایی‌های شیاردار روی سقف، حس پاییز و هالووین، جزئیات میوه و بدنهٔ کلاسیک",
  },
  730479352762: {
    title: "قالب سیلیکونی ماشین وینتیج کریسمسی",
    description:
      "قالب دوتکه ماشین وینتیج با درخت کریسمس؛ طول ۱۷ سانتی‌متر، گنجایش آب ۴۸۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم ماشین وینتیج با درخت کاج کریسمس و هدیه‌های کوچک روی سقف، جزئیات شاخه‌های درخت و حس زمستانی",
  },
  872686185542: {
    title: "قالب سیلیکونی ماشین با هندوانه",
    description:
      "قالب دوتکه ماشین وینتیج با هندوانه‌ها روی سقف؛ طول ۱۷، ارتفاع ۱۰٫۱ سانتی‌متر. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم ماشین وینتیج با هندوانه‌های برش‌خوردهٔ دانه‌دار و کامل روی سقف، جزئیات تابستانی و بدنهٔ کلاسیک",
  },
  117327766142: {
    title: "قالب سیلیکونی غاز روستایی",
    description:
      "قالب دوتکه + دو قالب‌بند؛ ارتفاع ۱۵ سانتی‌متر، گنجایش آب ۳۲۰ گرم، گلدان ۹٫۵×۵٫۹. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم غاز روستایی با بال‌های تاخورده، منقار و پاهای کوتاه، بافت پر برجسته و فرم واقع‌گرایانه",
  },
  317423256182: {
    title: "قالب سیلیکونی گلابی بزرگ",
    description:
      "قالب دوتکه + دو قالب‌بند؛ ارتفاع ۱۳ سانتی‌متر، قطر گلدان ۷٫۸، گنجایش آب ۴۵۳ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم گلابی بزرگ با دم‌گل و برگ، سطح صاف مات آماده رنگ، حفرهٔ گرد بالایی",
  },
  778098926962: {
    title: "قالب سیلیکونی سیب بزرگ",
    description:
      "قالب دوتکه + دو قالب‌بند؛ ارتفاع ۱۰ سانتی‌متر، گنجایش آب ۴۲۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم سیب بزرگ با ساقه و برگ، سطح صاف مات آماده رنگ، حفرهٔ گرد بالایی",
  },
  797311804892: {
    title: "قالب سیلیکونی سیب کوچولو",
    description:
      "قالب دوتکه + دو قالب‌بند؛ ارتفاع ۹ سانتی‌متر، گنجایش آب ۲۴۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم سیب کوچک با ساقه و برگ، سطح صاف مات، حفرهٔ گرد بالایی، فرم فشردهٔ مینیمال",
  },
  469787608282: {
    title: "قالب سیلیکونی بلوبری",
    description:
      "قالب دوتکه بدون قالب‌بند؛ ارتفاع ۸٫۷، قطر ۹٫۵ سانتی‌متر، گلدان قطر ۶٫۵ و عمق ۵. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم سبد بلوبری با دانه‌های آبی برجسته و برگ‌های کوچک، حفرهٔ بالایی، جزئیات میوهٔ واقع‌گرایانه",
  },
  360504311442: {
    title: "قالب سیلیکونی بیسکویت",
    description:
      "قالب دوتکه: پایهٔ بیسکویت + درپوش با قالب‌بند حلقه‌ای؛ آماده رنگ با پوشش تزئینی. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی به فرم بیسکویت گرد با لبهٔ دندانه‌دار و ترک‌های شیرینی، درپوش تپهٔ بیسکویت با لکه‌های شکلات، بافت واقع‌گرایانه",
  },
  342687134862: {
    title: "قالب سیلیکونی خار گل‌قرقی با زنبور",
    description:
      "قالب دوتکه + دو قالب‌بند؛ ساقهٔ خار با زنبور درشت، گنجایش آب ۵۸۹ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم ساقهٔ خار گل‌قرقی با گل بنفش تیغ‌دار و زنبور درشت نشسته روی آن، جزئیات تیغ‌ها و بال‌های راه‌راه",
  },
  823445603992: {
    title: "قالب سیلیکونی خار گل‌قرقی با کفشدوزک",
    description:
      "قالب دوتکه + دو قالب‌بند؛ ساقهٔ خار با کفشدوزک، گنجایش آب ۵۸۰ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم ساقهٔ خار گل‌قرقی با کفشدوزک سرخ خال‌دار روی گل، جزئیات تیغ‌ها و پایهٔ برگ‌دار",
  },
  956650726502: {
    title: "قالب سیلیکونی خار گل‌قرقی",
    description:
      "قالب دوتکه + دو قالب‌بند؛ ساقهٔ خار ساده، گنجایش آب ۵۷۵ گرم. منبع الهام: Khoroshie Moldy.",
    seedPrompt:
      "گلدان گچی مجسمه‌ای به فرم ساقهٔ خار گل‌قرقی با گل بنفش تیغ‌دار و برگ‌های نوک‌تیز، فرم عمودی متقارن",
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
  const products = (catalog.products ?? []).filter((p) => !SKIP_UIDS.has(p.uid));

  const missing = products.filter((p) => !PERSIAN[p.uid]);
  if (missing.length > 0) {
    console.error(`No Persian metadata for uid(s): ${missing.map((p) => p.uid).join(", ")}`);
    process.exit(1);
  }

  console.log(`Importing ${products.length} Khoroshie Moldy product(s) -> ${base}/api/library/import`);
  let ok = 0, skipped = 0, failed = 0;
  for (const [index, product] of products.entries()) {
    const fa = PERSIAN[product.uid];
    const gallery = JSON.parse(product.gallery || "[]");
    const image = gallery[0]?.img;
    const tag = `[${index + 1}/${products.length}] ${fa.title}`;
    if (!image) {
      failed += 1;
      console.log(`${tag} — FAIL no image in catalog`);
      continue;
    }
    if (dryRun) {
      console.log(`${tag} — would import ${image}`);
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
          imageUrl: image,
          source: {
            site: SITE,
            url: product.url,
            handle: String(product.uid),
            productId: product.sku ?? String(product.uid),
            price: product.price?.split(".")[0],
            currency: "RUB",
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
