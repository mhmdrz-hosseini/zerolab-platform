import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { images, threedTasks } from "@/db/schema";
import { getStorage } from "@/server/storage";
import {
  downloadComfyFile,
  generateWithQwen,
  runComfyGraph,
  uploadImageBytes,
  type ComfyImageRef,
} from "./qwen";

/**
 * Local 2D→3D engine (2026-10-05) — Pixal3D multiview + TRELLIS 2 stages on
 * the same ComfyUI server that renders images. Replaces Tripo as the primary
 * provider; Tripo stays available via THREED_PROVIDER=tripo.
 *
 * Pipeline per task (fire-and-forget poller, mirrors the Tripo poller):
 *   1. 3 parallel Qwen edit turns rotate the input image into left/back/right
 *      views (identity chain: each references the front master only).
 *   2. Upload all 4 views → hand-built API graph (no gallery-template cropping
 *      — the converter serializes crop rects wrong): BiRefNet background
 *      removal ×4 → crop-to-mask 1024² → Pixal3DMultiViewConditioning →
 *      structure sample → TRELLIS2 shape stage → upsample → texture stage →
 *      remesh/decimate/unwrap → bake albedo/normal/AO → textured GLB.
 * Proven end-to-end on the RTX 3090 box in ~7 min (model load dominates).
 */

const SAVE_NODE = "save";
const SOLID_SAVE_NODE = "save_solid";
const VIEW_PROMPTS = {
  left: "Rotate the viewpoint to show the exact same object from its left side (90 degree turn). Keep the object's design, colors, proportions and surface details exactly unchanged. Keep the plain studio background and the soft lighting exactly unchanged.",
  back: "Rotate the viewpoint to show the exact same object from behind (its back side). Keep the object's design, colors, proportions and surface details exactly unchanged. Keep the plain studio background and the soft lighting exactly unchanged.",
  right: "Rotate the viewpoint to show the exact same object from its right side (90 degree turn). Keep the object's design, colors, proportions and surface details exactly unchanged. Keep the plain studio background and the soft lighting exactly unchanged.",
} as const;

type ViewKey = "front" | "left" | "back" | "right";

/** The proven chain, hand-transcribed from the executed gallery-template run
 * (prompt_id cdd12194…). Node ids kept for traceability. */
function buildThreedGraph(views: Record<ViewKey, string>): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const g: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>) => {
    g[id] = { class_type, inputs };
  };
  const ref = (id: string, slot = 0) => [id, slot];

  // Loaders
  add("unet", "UNETLoader", { unet_name: "pixal3d_multiview_int8_convrot.safetensors", weight_dtype: "default" });
  add("vae_shape", "VAELoader", { vae_name: "trellis_2_shape_vae_bf16.safetensors" });
  add("vae_tex", "VAELoader", { vae_name: "trellis_2_texture_vae_bf16.safetensors" });
  add("clipvis", "CLIPVisionLoader", { clip_name: "dino_v3_L_naf_fp32.safetensors" });
  add("bgmodel", "LoadBackgroundRemovalModel", { bg_removal_name: "birefnet.safetensors" });

  // Views: upload → background removal → crop-to-mask 1024² on black
  for (const v of ["front", "left", "back", "right"] as const) {
    add(`load_${v}`, "LoadImage", { image: views[v] });
    add(`rb_${v}`, "RemoveBackground", { bg_removal_model: ref("bgmodel"), image: ref(`load_${v}`) });
    add(`crop_${v}`, "ImageCropToMask", {
      images: ref(`load_${v}`),
      masks: ref(`rb_${v}`),
      width: 1024,
      height: 1024,
      pad_factor: 1.1,
      grow_mask: 0,
      background: "#000000",
    });
  }

  add("cond", "Pixal3DMultiViewConditioning", {
    clip_vision_model: ref("clipvis"),
    fov: 20.0,
    front: ref("crop_front"),
    left: ref("crop_left"),
    back: ref("crop_back"),
    right: ref("crop_right"),
  });

  // Structure stage model chain: CFGOverride → RescaleCFG(0.7) → SD3 sampling
  add("cfg_a", "CFGOverride", { model: ref("unet"), cfg: 1.0, start_percent: 0.667, end_percent: 1.0 });
  add("rc_a", "RescaleCFG", { multiplier: 0.7, model: ref("cfg_a") });
  add("ms", "ModelSamplingSD3", { shift: 5.0, model: ref("rc_a") });
  add("latent0", "EmptyTrellis2LatentStructure", { batch_size: 1 });
  add("ks_struct", "KSampler", {
    seed: 56, steps: 12, cfg: 7.5, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
    model: ref("ms"), positive: ref("cond", 0), negative: ref("cond", 1), latent_image: ref("latent0"),
  });
  add("dec_struct", "VaeDecodeStructureTrellis2", { samples: ref("ks_struct"), vae: ref("vae_shape"), resolution: "32" });

  // Shape stage + upsample chain (second CFG override branch)
  add("shape_stage", "Trellis2ShapeStage", {
    positive: ref("cond", 0), negative: ref("cond", 1), voxel: ref("dec_struct"),
  });
  add("cfg_b", "CFGOverride", { model: ref("unet"), cfg: 1.0, start_percent: 0.769, end_percent: 1.0 });
  add("rc_b", "RescaleCFG", { multiplier: 0.5, model: ref("cfg_b") });
  add("ks_shape", "KSampler", {
    seed: 42, steps: 20, cfg: 7.5, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
    model: ref("rc_b"), positive: ref("shape_stage", 0), negative: ref("shape_stage", 1), latent_image: ref("shape_stage", 2),
  });
  add("up_stage", "Trellis2UpsampleStage", {
    target_resolution: 1536,
    positive: ref("shape_stage", 0), negative: ref("shape_stage", 1),
    shape_latent: ref("ks_shape"), vae: ref("vae_shape"),
  });
  add("ks_up", "KSampler", {
    seed: 42, steps: 12, cfg: 7.5, sampler_name: "euler", scheduler: "simple", denoise: 1.0,
    model: ref("rc_b"), positive: ref("up_stage", 0), negative: ref("up_stage", 1), latent_image: ref("up_stage", 2),
  });
  add("dec_shape", "VaeDecodeShapeTrellis", { samples: ref("ks_up"), vae: ref("vae_shape") });

  // Mesh ops
  add("meshinfo", "GetMeshInfo", { mesh: ref("dec_shape", 0) });
  add("remesh", "RemeshMesh", {
    mesh: ref("meshinfo"), resolution: 768, sign_mode: "udf",
    "sign_mode.qef": false, "sign_mode.drop_inverted_components": false, "sign_mode.drop_enclosed_components": false,
    band: 1.0, project_back: 0.0, fix_poles: false, smooth_iters: 20, drop_small_components: 0.01,
    precluster_max_verts: 20000000,
  });
  add("decimate", "DecimateMesh", { mesh: ref("remesh"), target_face_count: 700000, placement_mode: "midpoint" });
  add("smooth_hi", "MeshSmoothNormals", { mesh: ref("decimate"), crease_angle: 180.0 });

  // Texture stage (plain model, no CFG override)
  add("tex_stage", "Trellis2TextureStage", {
    positive: ref("up_stage", 0), negative: ref("up_stage", 1), shape_latent: ref("ks_up"),
  });
  add("ks_tex", "KSampler", {
    seed: 43, steps: 12, cfg: 1.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
    model: ref("unet"), positive: ref("tex_stage", 0), negative: ref("tex_stage", 1), latent_image: ref("tex_stage", 2),
  });
  add("dec_tex", "VaeDecodeTextureTrellis", {
    samples: ref("ks_tex"), vae: ref("vae_tex"), shape_subdivides: ref("dec_shape", 1),
  });

  // UV unwrap + bakes + textured output
  add("unwrap", "UnwrapMesh", {
    mesh: ref("smooth_hi"), segmenter: "pec", resolution: 4096, padding: 1, weld_distance: 0.0002,
  });
  add("bake_tex", "BakeTextureFromVoxel", {
    mesh: ref("unwrap"), voxel_colors: ref("dec_tex"), texture_size: 4096, reference_mesh: ref("dec_shape", 0),
  });
  add("bake_normal", "BakeNormalMapFromMesh", {
    low_poly: ref("unwrap"), high_poly: ref("remesh"), resolution: 2048, cage_distance: 0.05, ignore_backfaces: true,
  });
  add("bake_ao", "BakeAmbientOcclusion", {
    low_poly: ref("unwrap"), high_poly: ref("remesh"),
    resolution: 1024, samples: 64, max_distance: 0.71, strength: 1.0, bias: 0.01,
  });
  add("apply_tex", "ApplyTextureToMesh", {
    mesh: ref("unwrap"),
    base_color: ref("bake_tex", 0), metallic: ref("bake_tex", 1), roughness: ref("bake_tex", 2),
    occlusion: ref("bake_ao"), normal_map: ref("bake_normal"),
  });
  add("smooth_out", "MeshSmoothNormals", { mesh: ref("apply_tex"), crease_angle: 180.0 });
  add("tofile", "MeshToFile3D", { mesh: ref("smooth_out") });
  add(SAVE_NODE, "Save3DAdvanced", {
    model_3d: ref("tofile"), filename_prefix: "3d/zerolab", viewport_state: "", width: 1024, height: 1024,
  });
  // Solid twin for the mold engine: the textured GLB above is the UV-unwrapped
  // mesh — ~780 index-disconnected charts with cracks between them — which the
  // mold engine rejects ("separate pieces"). smooth_hi is the same surface
  // before UV unwrap: one welded marching-cubes solid, exactly what molding needs.
  add("tofile_solid", "MeshToFile3D", { mesh: ref("smooth_hi") });
  add(SOLID_SAVE_NODE, "Save3DAdvanced", {
    model_3d: ref("tofile_solid"), filename_prefix: "3d/zerolab-solid", viewport_state: "", width: 1024, height: 1024,
  });
  return g;
}

function glbRefFromOutputs(
  outputs: Record<string, ComfyImageRef[]>,
  node: string = SAVE_NODE,
): ComfyImageRef {
  const refs = outputs[node];
  const glb = refs?.find((r) => (r.filename ?? "").toLowerCase().endsWith(".glb"));
  if (!glb) throw new Error(`ComfyUI 3D job finished without a GLB output on ${node}`);
  return glb;
}

/** Fire-and-forget task runner — mirrors the Tripo poller's contract. */
export function startComfyThreedTask(taskRowId: string): void {
  void run(taskRowId).catch(async (err) => {
    console.error("[comfy/threed] task failed", err);
    await getDb()
      .update(threedTasks)
      .set({ status: "failed" })
      .where(eq(threedTasks.id, taskRowId))
      .catch(() => {});
  });
}

async function run(taskRowId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(threedTasks).where(eq(threedTasks.id, taskRowId)).limit(1);
  if (!row) return;

  const [img] = await db
    .select({ storageKey: images.storageKey, mime: images.mime })
    .from(images)
    .where(eq(images.id, row.inputImageId))
    .limit(1);
  const storage = getStorage();
  const master = img ? await storage.get(img.storageKey) : null;
  if (!master) throw new Error("input image bytes not found in storage");
  await db.update(threedTasks).set({ status: "running" }).where(eq(threedTasks.id, taskRowId));

  // Stage 1 — rotate the master into left/back/right views (Qwen edit chain).
  const [left, back, right] = await Promise.all([
    generateWithQwen({ prompt: VIEW_PROMPTS.left, refBytes: master.bytes, refMime: master.mime, timeoutMs: 900_000 }),
    generateWithQwen({ prompt: VIEW_PROMPTS.back, refBytes: master.bytes, refMime: master.mime, timeoutMs: 900_000 }),
    generateWithQwen({ prompt: VIEW_PROMPTS.right, refBytes: master.bytes, refMime: master.mime, timeoutMs: 900_000 }),
  ]);

  // Stage 2 — upload views and run the 3D graph.
  const views: Record<ViewKey, string> = {
    front: await uploadImageBytes(master.bytes, master.mime),
    left: await uploadImageBytes(left.bytes, left.mime),
    back: await uploadImageBytes(back.bytes, back.mime),
    right: await uploadImageBytes(right.bytes, right.mime),
  };
  // 40 min: the local desktop GPU (12GB, slower than the 3090 the graph was
  // tuned on) can need most of this on a cold run — model loads page in and
  // the four samplers queue behind the view-generation stage.
  const job = await runComfyGraph(buildThreedGraph(views), { timeoutMs: 2_400_000, pollMs: 5_000 });
  const glb = await downloadComfyFile(glbRefFromOutputs(job.outputs));

  const key = `threed/${row.sessionId}/${taskRowId}.glb`;
  await storage.put(key, glb, "model/gltf-binary");

  // Solid twin (mold-grade, pre-UV-unwrap). Best effort: if the solid save
  // produced nothing the 3D task still succeeds; molding it will fall back to
  // the explicit model_too_old path instead of a mysterious engine dead-end.
  let solidKey: string | null = null;
  try {
    const solidRef = glbRefFromOutputs(job.outputs, SOLID_SAVE_NODE);
    const solid = await downloadComfyFile(solidRef);
    solidKey = `threed/${row.sessionId}/${taskRowId}-solid.glb`;
    await storage.put(solidKey, solid, "model/gltf-binary");
  } catch (err) {
    console.error("[comfy/threed] solid GLB missing — molds will be unavailable for this task", err);
  }

  await db
    .update(threedTasks)
    .set({ status: "success", glbKey: key, solidGlbKey: solidKey })
    .where(eq(threedTasks.id, taskRowId));
}
