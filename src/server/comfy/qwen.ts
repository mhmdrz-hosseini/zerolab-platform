import { randomInt, randomUUID } from "node:crypto";

/**
 * Qwen Image 2.1 generation via a ComfyUI server's HTTP API.
 *
 * Replaces the Aval Gemini-image transport for /api/image (chat stays on
 * Aval). Graphs are hand-built in API format — the proven path from the
 * hero-video pipeline guide: gallery Qwen templates fail local check, but a
 * 9-node t2i graph and a ~12-node edit graph against these exact models work:
 *
 *   UNET      qwen_image_2.1_int8_convrot
 *   CLIP      qwen3vl_8b_int8_convrot      (CLIPLoader type "qwen_image")
 *   VAE       qwen_image_2.1_vae_bf16
 *   sampler   euler / simple, 20 steps, cfg 2.5, denoise 1.0
 *
 * Ref-only edits (variation/standardize turns): the reference is BOTH the
 * edit encoder's image1 AND the latent source — passing no image to edit
 * around 400s in LoadImage.
 */

const MODELS = {
  unet: "qwen_image_2.1_int8_convrot.safetensors",
  clip: "qwen3vl_8b_int8_convrot.safetensors",
  vae: "qwen_image_2.1_vae_bf16.safetensors",
} as const;

export const QWEN_IMAGE_MODEL = "qwen-image-2.1";

/** Latent-safe (multiples of 16) ~1.2MP dimensions per platform aspect ratio. */
const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1088, height: 1088 },
  "3:4": { width: 960, height: 1280 },
  "4:3": { width: 1280, height: 960 },
  "9:16": { width: 832, height: 1472 },
  "16:9": { width: 1472, height: 832 },
  "2:3": { width: 896, height: 1344 },
  "3:2": { width: 1344, height: 896 },
  "5:4": { width: 1120, height: 896 },
  "4:5": { width: 896, height: 1120 },
  "21:9": { width: 1568, height: 672 },
};

const SAVE_NODE = "9";

interface ComfyGraph {
  [nodeId: string]: { class_type: string; inputs: Record<string, unknown> };
}

function textToImageGraph(
  prompt: string,
  negativePrompt: string,
  seed: number,
  width: number,
  height: number,
  cfg: number,
): ComfyGraph {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: MODELS.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "qwen_image" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: MODELS.vae } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: negativePrompt } },
    "6": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    "7": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 20,
        cfg,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "zerolab" } },
  };
}

/**
 * Edit-around-reference graph: the uploaded ref is scaled to 1MP (lanczos,
 * 8-step resolution) and feeds both the edit conditioning (image1) and the
 * initial latent (VAEEncode). Output keeps the ref's aspect ratio.
 */
function refEditGraph(
  prompt: string,
  negativePrompt: string,
  seed: number,
  uploadedName: string,
  cfg: number,
): ComfyGraph {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: MODELS.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "qwen_image" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: MODELS.vae } },
    "10": { class_type: "LoadImage", inputs: { image: uploadedName } },
    "11": {
      class_type: "ImageScaleToTotalPixels",
      inputs: { image: ["10", 0], upscale_method: "lanczos", megapixels: 1.0, resolution_steps: 8 },
    },
    "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["3", 0] } },
    "13": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: { clip: ["2", 0], prompt, vae: ["3", 0], image1: ["11", 0] },
    },
    "14": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: { clip: ["2", 0], prompt: negativePrompt, vae: ["3", 0], image1: ["11", 0] },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 20,
        cfg,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model: ["1", 0],
        positive: ["13", 0],
        negative: ["14", 0],
        latent_image: ["12", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "zerolab" } },
  };
}

export interface QwenGenerateOptions {
  prompt: string;
  negativePrompt?: string;
  /** Used for t2i only — ref edits follow the reference image's aspect. */
  aspectRatio?: string;
  /** Reference image for edit turns (variation/standardize); PNG/JPEG/WebP. */
  refBytes?: Uint8Array | null;
  refMime?: string;
  seed?: number;
  /** CFG guidance; default 2.5. Qwen degrades visibly above ~3 — do not raise
   * it for variance (tested 2026-10-08: cfg 3.0+ hallucinates ornaments). */
  cfg?: number;
  /**
   * Default 15 min — one UI turn fires 4 parallel jobs that queue on the GPU;
   * on a cold server the first job also loads the 20B model (~200s), so the
   * last job can legitimately need ~10 min (200s load + 3×90s queue + 90s).
   */
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface QwenGenerateResult {
  bytes: Uint8Array;
  mime: "image/png";
  seed: number;
  promptId: string;
}

export interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface ComfyHistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: unknown[][] };
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
}

function baseUrl(): string {
  return (process.env.COMFYUI_URL ?? "http://127.0.0.1:8188").replace(/\/+$/, "");
}

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".png";
}

/** Shared ComfyUI HTTP plumbing — also used by the 3D engine (threed.ts). */
export function comfyBaseUrl(): string {
  return baseUrl();
}

export async function uploadImageBytes(
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  return uploadRef(baseUrl(), bytes, mime);
}

export async function downloadComfyFile(ref: ComfyImageRef): Promise<Uint8Array> {
  return downloadImage(baseUrl(), ref);
}

export interface ComfyJobResult {
  promptId: string;
  /** Output node id → its "images"-style output array. */
  outputs: Record<string, ComfyImageRef[]>;
}

/** Submit a graph and block until it finishes; errors surface with node info. */
export async function runComfyGraph(
  graph: ComfyGraph,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<ComfyJobResult> {
  const base = baseUrl();
  const promptId = await submitGraph(base, graph);
  const timeoutMs = opts.timeoutMs ?? 900_000;
  const pollMs = opts.pollMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`ComfyUI job ${promptId} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    try {
      const res = await fetch(`${base}/history/${promptId}`);
      if (res.ok) {
        const hist = (await res.json()) as Record<string, ComfyHistoryEntry>;
        const entry = hist[promptId];
        if (entry) {
          const status = entry.status?.status_str;
          if (status === "error") {
            throw new Error(`ComfyUI job failed: ${summarizeExecutionError(entry)}`);
          }
          if (status === "success" || entry.status?.completed) {
            const outputs: Record<string, ComfyImageRef[]> = {};
            for (const [nodeId, out] of Object.entries(entry.outputs ?? {})) {
              // Output key varies by node type — SaveImage uses "images",
              // Save3DAdvanced uses "3d"/"result". Collect any file-ref array.
              const refs: ComfyImageRef[] = [];
              for (const value of Object.values(out)) {
                if (!Array.isArray(value)) continue;
                for (const item of value) {
                  if (item && typeof item === "object" && "filename" in (item as object)) {
                    refs.push(item as ComfyImageRef);
                  }
                }
              }
              if (refs.length > 0) outputs[nodeId] = refs;
            }
            return { promptId, outputs };
          }
        }
      }
    } catch (err) {
      // Transient network blips (the render box can drop off Wi-Fi for a few
      // seconds) must not kill a 10-minute job — keep polling to the deadline.
      if (err instanceof Error && err.message.startsWith("ComfyUI job failed:")) throw err;
      console.warn("[comfy] transient poll error, retrying:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function uploadRef(base: string, bytes: Uint8Array, mime: string): Promise<string> {
  const form = new FormData();
  // slice() both copies and narrows the buffer type to ArrayBuffer (BlobPart).
  form.append(
    "image",
    new Blob([bytes.slice().buffer], { type: mime }),
    `zerolab-ref-${randomUUID()}${extForMime(mime)}`,
  );
  form.append("overwrite", "true");
  const res = await fetch(`${base}/upload/image`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`ComfyUI image upload failed (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as { name?: string; subfolder?: string };
  if (!data.name) throw new Error("ComfyUI upload returned no file name");
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

async function submitGraph(base: string, graph: ComfyGraph): Promise<string> {
  const res = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
  });
  if (!res.ok) {
    // POST /prompt returns node-level validation JSON — surface it (guide, stage 4).
    const body = (await res.text()).slice(0, 2000);
    throw new Error(`ComfyUI rejected the workflow (HTTP ${res.status}): ${body}`);
  }
  const data = (await res.json()) as { prompt_id?: string };
  if (!data.prompt_id) throw new Error("ComfyUI returned no prompt_id");
  return data.prompt_id;
}

function summarizeExecutionError(entry: ComfyHistoryEntry): string {
  const err = (entry.status?.messages ?? []).find(
    (m) => Array.isArray(m) && m[0] === "execution_error",
  )?.[1] as Record<string, unknown> | undefined;
  if (!err) return "unknown error";
  const node = `${err.node_type ?? "?"}@${err.node_id ?? "?"}`;
  return `${node}: ${String(err.exception_message ?? "no message")}`;
}

async function waitForImage(
  base: string,
  promptId: string,
  timeoutMs: number,
  pollMs: number,
): Promise<ComfyImageRef> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`ComfyUI job ${promptId} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    const res = await fetch(`${base}/history/${promptId}`);
    if (res.ok) {
      const hist = (await res.json()) as Record<string, ComfyHistoryEntry>;
      const entry = hist[promptId];
      if (entry) {
        // Appearing in history is NOT success — errored jobs land there too;
        // status_str must be checked (guide, stage 4 error discipline).
        const status = entry.status?.status_str;
        if (status === "error") {
          throw new Error(`ComfyUI job failed: ${summarizeExecutionError(entry)}`);
        }
        if (status === "success" || entry.status?.completed) {
          const img = entry.outputs?.[SAVE_NODE]?.images?.[0];
          if (!img) throw new Error("ComfyUI job finished but produced no image");
          return img;
        }
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function downloadImage(base: string, ref: ComfyImageRef): Promise<Uint8Array> {
  const url = new URL(`${base}/view`);
  url.searchParams.set("filename", ref.filename);
  url.searchParams.set("subfolder", ref.subfolder ?? "");
  url.searchParams.set("type", ref.type ?? "output");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ComfyUI /view download failed (HTTP ${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function generateWithQwen(opts: QwenGenerateOptions): Promise<QwenGenerateResult> {
  const base = baseUrl();
  const seed = opts.seed ?? randomInt(0, 2 ** 31);
  const negative = opts.negativePrompt ?? "";
  const cfg = opts.cfg ?? 2.5;
  const timeoutMs = opts.timeoutMs ?? 900_000;
  const pollMs = opts.pollIntervalMs ?? 2_000;

  let graph: ComfyGraph;
  if (opts.refBytes && opts.refBytes.length > 0) {
    const uploaded = await uploadRef(base, opts.refBytes, opts.refMime ?? "image/png");
    graph = refEditGraph(opts.prompt, negative, seed, uploaded, cfg);
  } else {
    const dims = ASPECT_DIMENSIONS[opts.aspectRatio ?? "1:1"] ?? ASPECT_DIMENSIONS["1:1"];
    graph = textToImageGraph(opts.prompt, negative, seed, dims.width, dims.height, cfg);
  }

  const promptId = await submitGraph(base, graph);
  const imageRef = await waitForImage(base, promptId, timeoutMs, pollMs);
  const bytes = await downloadImage(base, imageRef);
  if (bytes.length === 0) throw new Error("ComfyUI returned an empty image payload");
  return { bytes, mime: "image/png", seed, promptId };
}
