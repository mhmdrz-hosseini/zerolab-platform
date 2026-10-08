/**
 * Live acceptance loop for the per-slot variation axes (بازنگری 2026-10-08).
 *
 * Fires the same 4-slot turn the UI does — buildImagePrompt(brief,
 * {variationIndex: 0..3}) + IMAGE_NEGATIVE_PROMPT through generateWithQwen —
 * against COMFYUI_URL (default local) and saves the PNGs to
 * .scratch/variance-check/. Then measure with:
 *   python .scratch/image-variance-check.py .scratch/variance-check
 * Red/green contract (calibrated on 2026-10-08 batches): pre-fix mean ahash
 * hamming was ~4.5/64 with all-pairs hist ≥ 0.95 (clones). The gate is:
 * mean hamming ≥ ~7, at least two pairs with hist < 0.9 (tonal spread), and
 * — decisive — eyeballing the PNGs: every slot on-brief (full subject, no
 * invented ornaments) and visibly distinct pose/finish. Do NOT chase higher
 * hamming with cfg or stronger axes: cfg ≥ 3 hallucinates ornaments and
 * sharpened axes break the brief (both tested and reverted same day).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildImagePrompt, IMAGE_NEGATIVE_PROMPT } from "../src/lib/image-prompt.ts";
import { generateWithQwen } from "../src/server/comfy/qwen.ts";

const BRIEF =
  "زرافه آرام | سبک مجلسی با الگوی فیل‌پوش | اندازه ۱۵cm | جزئیات: لکه‌های گرد، چشمان درشت، پنجه‌های گرد";

/** Same transport as production: axis prompts + shared negative, cfg default. */
const outDir = path.join(
  process.cwd(),
  ".scratch",
  process.argv[2] ?? "variance-check",
);
await mkdir(outDir, { recursive: true });

const started = Date.now();
const results = await Promise.all(
  [0, 1, 2, 3].map(async (i) => {
    const t0 = Date.now();
    const res = await generateWithQwen({
      prompt: buildImagePrompt(BRIEF, { variationIndex: i }),
      negativePrompt: IMAGE_NEGATIVE_PROMPT,
      aspectRatio: "1:1",
      timeoutMs: 900_000,
    });
    const file = path.join(outDir, `slot-${i}.png`);
    await writeFile(file, res.bytes);
    console.log(`slot ${i}: seed=${res.seed} ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${file}`);
    return res;
  }),
);
console.log(`total ${((Date.now() - started) / 1000).toFixed(0)}s, ${results.length} frames`);
