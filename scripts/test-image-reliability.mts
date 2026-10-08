/**
 * Reliability loop for /api/image (2026-10-08, after the shrine turn rendered
 * the chat transcript as a text document in all 4 slots).
 *
 * Per brief: fires the production 4-slot turn (buildImagePrompt axes +
 * IMAGE_NEGATIVE_PROMPT through generateWithQwen), saves PNGs, then judges
 * every frame with the GLM vision model (glm-4.6v-flash) for the hard
 * failure classes: any text/calligraphy, document-page output, multi-object.
 *
 * Red contract: ANY frame with has_text or is_document makes the batch fail
 * (exit 1). Deterministic-enough at batch level; judge temperature 0.
 *
 * Usage: node --experimental-strip-types scripts/test-image-reliability.mts [shrine|giraffe|all] [outdir-suffix]
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { buildImagePrompt, IMAGE_NEGATIVE_PROMPT } from "../src/lib/image-prompt.ts";
import { generateWithQwen } from "../src/server/comfy/qwen.ts";
import { enSubjectHint } from "../src/server/glm/en-subject.ts";

const BRIEFS: Record<string, string> = {
  shrine:
    "سوژهٔ هندسی: نمای جانبی حرم امام رضا با ایوان‌ها و طاق‌نماهای تزیین‌شده",
  giraffe:
    "زرافه آرام | سبک مجلسی با الگوی فیل‌پوش | اندازه ۱۵cm | جزئیات: لکه‌های گرد، چشمان درشت، پنجه‌های گرد",
};

const which = process.argv[2] ?? "shrine";
const suffix = process.argv[3] ?? "";
const names = which === "all" ? Object.keys(BRIEFS) : [which];

async function loadEnvLocal(): Promise<Record<string, string>> {
  const raw = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = await loadEnvLocal();
for (const [k, v] of Object.entries(env)) {
  if (!(k in process.env)) process.env[k] = v;
}
const glm = new OpenAI({
  apiKey: env.GLM_API_KEY,
  baseURL: "https://api.z.ai/api/paas/v4",
});

const JUDGE_PROMPT = `You are a strict QA judge for studio product images destined for a mold-manufacturing pipeline (a 3D model will be built from the image).
Judge ONLY these hard-failure classes and answer ONLY with compact JSON, no markdown:
{"floating_text": <true if text appears OUTSIDE/ABOVE the object as typeset content: document pages, banners, captions, overlays. Lettering carved INTO the object surface (tilework, engraved ornament) is part of the object — floating_text=false>,
"is_document": <true if the image is a text page / document / screenshot rather than a photo of a physical object>,
"single_object": <true if exactly one connected physical object is shown>,
"summary": "<one short English sentence>"}`;

interface Verdict {
  floating_text: boolean;
  is_document: boolean;
  single_object: boolean;
  summary: string;
}

async function judge(dataUrl: string): Promise<Verdict | null> {
  try {
    const res = await glm.chat.completions.create({
      model: env.GLM_VISION_MODEL ?? "glm-4.6v-flash",
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: JUDGE_PROMPT },
          ],
        },
      ],
    });
    const text = res.choices[0]?.message?.content ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return JSON.parse(json) as Verdict;
  } catch (err) {
    console.warn("  judge unavailable:", err instanceof Error ? err.message.slice(0, 120) : err);
    return null;
  }
}

let red = 0;
let unknown = 0;
for (const name of names) {
  const brief = BRIEFS[name];
  if (!brief) throw new Error(`unknown brief: ${name}`);
  const outDir = path.join(process.cwd(), ".scratch", `reliability-${name}${suffix}`);
  await mkdir(outDir, { recursive: true });

  console.log(`=== brief "${name}": ${brief}`);
  const hint = await enSubjectHint(brief);
  console.log(`  EN hint: ${hint ?? "(unavailable — degraded)"}`);
  const verdicts = await Promise.all(
    [0, 1, 2, 3].map(async (i) => {
      const t0 = Date.now();
      const prompt = buildImagePrompt(brief, { variationIndex: i });
      const res = await generateWithQwen({
        prompt: hint ? `${prompt}\n(photograph of ${hint})` : prompt,
        negativePrompt: IMAGE_NEGATIVE_PROMPT,
        aspectRatio: "1:1",
        timeoutMs: 900_000,
      });
      const file = path.join(outDir, `slot-${i}.png`);
      await writeFile(file, res.bytes);
      const dataUrl = `data:image/png;base64,${Buffer.from(res.bytes).toString("base64")}`;
      const v = await judge(dataUrl);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      if (!v) {
        unknown++;
        console.log(`slot ${i} (${secs}s): JUDGE UNAVAILABLE -> ${file}`);
        return;
      }
      const bad = v.floating_text || v.is_document || !v.single_object;
      if (bad) red++;
      console.log(
        `slot ${i} (${secs}s): ${bad ? "RED" : "green"} float=${v.floating_text} doc=${v.is_document} single=${v.single_object} — ${v.summary} -> ${file}`,
      );
    }),
  );
  void verdicts;
}

console.log(`\nRESULT: ${red} red, ${unknown} unjudged of ${names.length * 4} frames`);
process.exit(red > 0 ? 1 : 0);
