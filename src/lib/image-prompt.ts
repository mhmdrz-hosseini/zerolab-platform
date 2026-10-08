/**
 * Persian image prompts for the mold flow — two lanes with different prompt
 * budgets (lessons of 2026-10-08, probe scripts/probe-shrine-text-mode.mts):
 *
 *  - Gallery (t2i) = SHORT prompt: MEDIUM_ANCHOR + brief + COMPACT constraint
 *    line + variation axis, plus an English subject hint appended by the
 *    route. Qwen Image typesets long Persian instruction blocks into the
 *    image as "infographic" text — the shrine turn rendered the whole prompt
 *    (and even the appended hint) as document pages in all 4 slots. Long
 *    prompts are only safe on the edit path.
 *  - Technical/standardize (edit) = the full SHARED constraint block — the
 *    edit path follows instructions instead of typesetting them (validated).
 *
 * The English subject hint (src/server/glm/en-subject.ts) is the decisive
 * lever for the subject mode: Persian religious/architectural wording maps
 * to documents, the same concept in English maps to building imagery.
 * Framework-free: client+server importable.
 */

export interface ImagePromptOptions {
  /** Material hint replacing the «متریال» placeholder (e.g. «ظاهر فوندانت صاف»). */
  material?: string;
  /** 0–3 — gallery slot index; adds that slot's variation axis line. */
  variationIndex?: number;
  /** Optional user feedback for a variation turn — appended after the axes. */
  feedback?: string;
}

/**
 * انکر مود — خط اول t2i. کوتاه بماند؛ هر واژه‌ای اینجا ریسک حروف‌چینی دارد.
 */
const MEDIUM_ANCHOR = "عکس فتوگرافی محصول: یک جسم فیزیکی ملموس روی میز استودیو با نور نرم.";

/**
 * قید فشردهٔ لاین گالری (t2i) — همان مفاهیم قالب‌پذیری، در یک سطر.
 */
const COMPACT_CONSTRAINTS =
  "تک‌شیء یکپارچه و توپُر در مرکز کادر، پس‌زمینهٔ سادهٔ روشن، زاویهٔ سه‌ربع. بدون هیچ نوشته و متن و کتیبه (تزیین فقط نقش هندسی)، بدون props و پایه؛ جزئیات درشت و لبه‌های گرد، همهٔ اجزا چسبیده به بدنه.";

/** خط متریال/سبک فشردهٔ گالری — جای‌گزین می‌شود اگر material داده شود. */
const MATERIAL_PLACEHOLDER = "متریال: [بر اساس خدمت کاربر]";

/**
 * محورهای واریانس — تنها بخشی که بین ۴ اسلات فرق می‌کند؛ کوتاه، چون هر سطر
 * اضافه موادِ حروف‌چینی است. روی نوبت واریاسیونِ edit هم دستورِ تغییر می‌خواند.
 */
const VARIATION_AXES = [
  "واریاسیون ۱: زاویه کمی بالاتر، چرخش بیشتر به چپ، فرم گردتر و جمع‌وجورتر.",
  "واریاسیون ۲: سطوح مات و مینیمال، بدون تزئین اضافه.",
  "واریاسیون ۳: تزئین پرجزئیات‌تر چسبیده به بدنه، نور گرم‌تر.",
  "واریاسیون ۴: سیلوئت کشیده‌تر با ژست پویاتر.",
] as const;

/**
 * قیدهای کامل — فقط لاین فنی (استانداردسازی، مسیر edit). تیکت ۰۷ + قالب‌پذیری
 * تیکت ۱۷ + بندهای چاپ‌پذیری. ⚠️ هرگز در t2i گالری: حروف‌چینی می‌شود.
 */
const SHARED_CONSTRAINTS = `قیدهای سخت:
- فقط یک شیء واحد؛ هیچ شیء دوم یا ترکیب چند شیء جدا در کادر؛ پس‌زمینهٔ یکدست روشن، بدون props
- شیء کاملاً یکپارچه و پیوسته: هر جزء (دست و پا، بال، گل، تزئین) به بدنهٔ اصلی چسبیده است؛ هیچ عنصر شناور یا جداشدهٔ معلق در فضا
- فرم توپُر و فشرده با سیلوئت پر و بسته؛ فرم توخالی، تور یا قاب بازِ ظریف نه
- نور یکنواخت استودیویی؛ بدون سایهٔ سنگین و بازتاب
- زاویهٔ سه‌ربع (۳/۴) با سایه‌روشن نرم — فرم حجمی خوانا باشد، کاملاً تخت نه
- بدون هیچ نوشته‌ای به هر شکل: متن، عدد، واترمارک، کتیبه، لوح‌نوشته، بنر یا طومار — نه روی شیء، نه در پس‌زمینه؛ تزیینات فقط نقش هندسی و اسلیمیِ بدون حروف
- جزئیات حداقل ۲–۳ میلی‌متر در مقیاس؛ بدون قطعات نازکِ جداشده، میلهٔ لاغر یا آویز
- بدون زیربرش عمیق یا حلقهٔ بستهٔ کامل؛ همهٔ بخش‌ها به هم متصل و یک‌تکه
- لبه‌ها و گوشه‌ها گرد و نرم؛ لبهٔ تیز و برنده نه
- تناسب کلی متعادل؛ هیچ بُعدی بیش از حدود دوونیم برابر بُعد دیگر؛ گردن یا اتصال باریکِ شکننده نه
- تناسب کلی مناسب قالب ۵ تا ۲۰ سانتی‌متر`;

/**
 * لاین فنی — نسخهٔ ورودی 2D→3D: ماکت تک‌رنگ مات با ژست ایستادهٔ متقارن و معلق،
 * بدون زمین/بک‌پلیت تا BiRefNet و کاندیشنینگ مولتی‌ویو هندسهٔ خالص بخوانند.
 */
const NEUTRAL_TECH_LINE = `نسخهٔ فنی برای مدل‌سازی سه‌بعدی:
- همان سوژه به‌صورت ماکتِ تک‌رنگ مات و یکدست به رنگ گچ روشن؛ هیچ نقش و رنگ طبیعی، بافت خوراکی یا جلوهٔ متریال — فقط فرم و برجستگی
- ژست ایستادهٔ آرام و متقارن و رو به جلو؛ بدون خم‌شدن، بدون ژست پویا یا اغراق‌شده؛ اندام‌ها در وضعیت طبیعی آرام
- شیء معلق در فضا: بدون سطح زمین، بدون سایه، بدون پایه و بک‌پلیت و میز؛ پس‌زمینهٔ کاملاً سادهٔ سفید
- نمای سه‌ربع استاندارد، کل شیء کامل در کادر
- هر ذره، نشانه یا جزء ریزِ جدا از شیء اصلی حذف شود؛ خروجی فقط یک تکهٔ واحد و پیوسته باشد`;

/** Negative مشترک — فقط شکل و کیفیت؛ واژه‌های سند/کتاب حذف شدند چون در cfg ۲٫۵
 * به‌جای حذف، به رندر متن/سند نشت می‌کنند (شکست زرافهٔ fixC، 2026-10-08). */
export const IMAGE_NEGATIVE_PROMPT =
  "چند شیء جدا، قطعات معلق و جدا از بدنه، تور و قاب باز، میلهٔ لاغر و آویز، پایه و استند و سکوی نمایش، بک‌گراند شلوغ، props، متن، حروف، عدد، واترمارک، قاب کادر، سایهٔ سنگین، بازتاب شدید، تار، کیفیت پایین، دفرمه، بریده‌شده";

/**
 * Full gallery prompt (t2i — کوتاه): anchor، بریف، قید فشرده، متریال/سبک،
 * محور واریانس این اسلات، بازخورد کاربر.
 */
export function buildImagePrompt(
  brief: string,
  opts?: ImagePromptOptions,
): string {
  const material = opts?.material?.trim()
    ? `متریال: ${opts.material.trim()}.`
    : "";
  const lines: string[] = [
    MEDIUM_ANCHOR,
    brief.trim(),
    COMPACT_CONSTRAINTS,
  ];
  if (material) lines.push(material);
  lines.push("سبک: رندر تمیز و مینیمال با فوکوس شارپ.");
  const idx = opts?.variationIndex;
  if (idx !== undefined) {
    lines.push(VARIATION_AXES[idx % VARIATION_AXES.length]);
  }
  const feedback = opts?.feedback?.trim();
  if (feedback) {
    lines.push(`بازخورد کاربر برای این واریاسیون: ${feedback}`);
  }
  return lines.join("\n");
}

/**
 * Technical-lane standardize prompt (edit مسیر): بریف، دستور رندر خنثی،
 * بلوک کامل قیدها — امن، چون مسیر edit دستورات را اجرا می‌کند نه حروف‌چینی.
 */
export function buildStandardizePrompt(brief: string): string {
  return [
    "ماکت مهندسی تک‌رنگ مات به رنگ گچ روشن، بدون هیچ نقش و رنگ طبیعی — فقط فرم:",
    brief.trim(),
    "",
    NEUTRAL_TECH_LINE,
    "",
    SHARED_CONSTRAINTS,
  ].join("\n");
}
