/**
 * Persian image prompts for the mold flow (issue 07 — the constraint block is
 * VERBATIM from the grilling answer; issue 13 consumes these builders from the
 * ImageFlow UI). Framework-free: importable from both client and server.
 */

export interface ImagePromptOptions {
  /** Material hint replacing the «متریال» placeholder (e.g. «ظاهر فوندانت صاف»). */
  material?: string;
  /** Optional user feedback for a variation turn — appended after the constraints. */
  feedback?: string;
}

/** قیدهای سخت — عیناً از تیکت ۰۷ (بدون خط متریال و سبک که پایین اضافه می‌شوند). */
const CONSTRAINTS = `تصویر محصول استودیویی، تک‌شیء در مرکز کادر. قیدهای سخت:
- فقط یک شیء؛ پس‌زمینهٔ یکدست روشن (کرم/خاکستری روشن)، بدون props
- نور یکنواخت استودیویی؛ بدون سایهٔ سنگین و بازتاب
- زاویهٔ سه‌ربع (۳/۴) با سایه‌روشن نرم — فرم حجمی خوانا باشد، کاملاً تخت نه
- بدون هیچ متن، عدد، واترمارک یا خط‌کشی روی شیء
- جزئیات حداقل ۲–۳ میلی‌متر در مقیاس؛ بدون قطعات نازکِ جداشده، میلهٔ لاغر یا آویز
- بدون زیربرش عمیق یا حلقهٔ بستهٔ کامل؛ همهٔ بخش‌ها به هم متصل و یک‌تکه
- تناسب کلی مناسب قالب ۵ تا ۲۰ سانتی‌متر`;

/** خط متریال — عیناً از تیکت ۰۷ (جای‌گزین می‌شود اگر material داده شود). */
const MATERIAL_PLACEHOLDER =
  "- متریال: [بر اساس خدمت کاربر — مثلاً «ظاهر فوندانت صاف» یا «شکلات براق»]";

const STYLE_LINE = "سبک: رندر محصول تمیز و مینیمال، فوکوس شارپ.";

/** جملهٔ فنی پایانی گام استانداردسازی — عیناً از تیکت ۰۷. */
const STANDARDIZE_LINE =
  "نسخهٔ نهایی فنی برای مدل‌سازی سه‌بعدی، پس‌زمینهٔ کاملاً سادهٔ سفید-کرم، نمای سه‌ربع استاندارد";

/**
 * Full generation prompt: brief first, constraint block after (ticket 07).
 */
export function buildImagePrompt(
  brief: string,
  opts?: ImagePromptOptions,
): string {
  const material = opts?.material?.trim()
    ? `- متریال: ${opts.material.trim()}`
    : MATERIAL_PLACEHOLDER;
  const lines: string[] = [brief.trim(), "", CONSTRAINTS, material, STYLE_LINE];
  const feedback = opts?.feedback?.trim();
  if (feedback) {
    lines.push("", `بازخورد کاربر برای این واریاسیون: ${feedback}`);
  }
  return lines.join("\n");
}

/**
 * Standardize-step prompt: the same constrained prompt plus the final
 * technical line (ticket 07, step 3).
 */
export function buildStandardizePrompt(brief: string): string {
  return `${buildImagePrompt(brief)}\n\n${STANDARDIZE_LINE}`;
}
