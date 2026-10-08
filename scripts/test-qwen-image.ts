/**
 * Simple smoke test for the Qwen/ComfyUI image path (scripts run outside
 * Next, so load .env.local by hand). Exercises BOTH graphs used by
 * /api/image: text-to-image, then an edit turn using the first output as
 * the reference image.
 *
 *   node scripts/test-qwen-image.ts
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateWithQwen } from "../src/server/comfy/qwen.ts";

// Minimal .env.local loader (only what this test needs).
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const outDir = fileURLToPath(new URL("../.scratch/qwen-test/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const T2I_PROMPT =
  "A minimalist hexagonal silicone candle mold photographed straight-on on a light grey seamless studio background, soft diffused softbox lighting, subtle soft shadow under the mold, centered composition, product photography, high detail, no people, no text";

async function main() {
  const base = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";
  console.log(`[test] ComfyUI at ${base} — text-to-image (1:1)…`);
  let t0 = Date.now();
  const t2i = await generateWithQwen({
    prompt: T2I_PROMPT,
    aspectRatio: "1:1",
    timeoutMs: 360_000,
  });
  const t2iPath = `${outDir}/t2i-${randomUUID().slice(0, 8)}.png`;
  writeFileSync(t2iPath, t2i.bytes);
  console.log(
    `[test] t2i OK — ${t2i.bytes.length.toLocaleString()} bytes in ${Math.round((Date.now() - t0) / 1000)}s (seed ${t2i.seed}, job ${t2i.promptId}) → ${t2iPath}`,
  );

  console.log("[test] edit turn (t2i output as reference)…");
  t0 = Date.now();
  const edit = await generateWithQwen({
    prompt:
      "Change the mold's color to deep navy blue. Keep the mold's shape, the background, the lighting and the composition exactly unchanged.",
    refBytes: t2i.bytes,
    refMime: "image/png",
    timeoutMs: 360_000,
  });
  const editPath = `${outDir}/edit-${randomUUID().slice(0, 8)}.png`;
  writeFileSync(editPath, edit.bytes);
  console.log(
    `[test] edit OK — ${edit.bytes.length.toLocaleString()} bytes in ${Math.round((Date.now() - t0) / 1000)}s (seed ${edit.seed}) → ${editPath}`,
  );
  console.log("[test] PASS — both graphs work");
}

main().catch((err) => {
  console.error("[test] FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
