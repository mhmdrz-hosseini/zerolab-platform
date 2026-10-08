/**
 * One-variable-per-slot probe for the shrine→document failure mode
 * (2026-10-08). Diagnostic only — findings fold into image-prompt.ts.
 *   slot 0: brief + MINIMAL constraints (is the long bulleted block the primer?)
 *   slot 1: full block + ENGLISH architecture hint line
 *   slot 2: minimal + English hint
 *   slot 3: production prompt (control)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildImagePrompt, IMAGE_NEGATIVE_PROMPT } from "../src/lib/image-prompt.ts";
import { generateWithQwen } from "../src/server/comfy/qwen.ts";

const BRIEF = "سوژهٔ هندسی: نمای جانبی حرم امام رضا با ایوان‌ها و طاق‌نماهای تزیین‌شده";
const EN_HINT =
  "(a photograph of an architectural miniature maquette: a shrine building model with vaulted ivan porches and geometric ornament, physical object on a studio table)";
const MINIMAL = `عکس فتوگرافی ماکت فیزیکی معمارانه روی میز استودیو، پس‌زمینهٔ سادهٔ روشن. یک شیء واحد و یکپارچه، بدون هیچ نوشته و کتیبه و متن، تزیین فقط نقش هندسی. زاویهٔ سه‌ربع.`;

const VARIANTS = [
  `${BRIEF}\n\n${MINIMAL}`,
  `${buildImagePrompt(BRIEF, { variationIndex: 1 })}\n${EN_HINT}`,
  `${BRIEF}\n${EN_HINT}\n\n${MINIMAL}`,
  buildImagePrompt(BRIEF, { variationIndex: 3 }),
];

const outDir = path.join(process.cwd(), ".scratch", "probe-shrine");
await mkdir(outDir, { recursive: true });
await Promise.all(
  VARIANTS.map(async (prompt, i) => {
    const t0 = Date.now();
    const res = await generateWithQwen({ prompt, negativePrompt: IMAGE_NEGATIVE_PROMPT, aspectRatio: "1:1", timeoutMs: 900_000 });
    const file = path.join(outDir, `slot-${i}.png`);
    await writeFile(file, res.bytes);
    console.log(`slot ${i} (${((Date.now() - t0) / 1000).toFixed(0)}s) -> ${file}`);
  }),
);
console.log("eyeball slots: 0=minimal 1=full+EN 2=min+EN 3=control");
