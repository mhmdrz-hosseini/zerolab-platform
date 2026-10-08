/**
 * Stage-2 smoke test: submit the platform's 2D→3D multiview graph directly to
 * the local ComfyUI and poll until GLB (mirrors src/server/comfy/threed.ts).
 *
 *   node scripts/test-threed-graph.mjs <front.png> [left.png back.png right.png]
 *
 * Missing views reuse the front image — enough to prove the chain runs.
 * Output: .scratch/threed-test/<prompt_id>.glb
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const BASE = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";
const SAVE_NODE = "save";

function buildThreedGraph(views) {
  const g = {};
  const add = (id, class_type, inputs) => { g[id] = { class_type, inputs }; };
  const ref = (id, slot = 0) => [id, slot];

  add("unet", "UNETLoader", { unet_name: "pixal3d_multiview_int8_convrot.safetensors", weight_dtype: "default" });
  add("vae_shape", "VAELoader", { vae_name: "trellis_2_shape_vae_bf16.safetensors" });
  add("vae_tex", "VAELoader", { vae_name: "trellis_2_texture_vae_bf16.safetensors" });
  add("clipvis", "CLIPVisionLoader", { clip_name: "dino_v3_L_naf_fp32.safetensors" });
  add("bgmodel", "LoadBackgroundRemovalModel", { bg_removal_name: "birefnet.safetensors" });

  for (const v of ["front", "left", "back", "right"]) {
    add(`load_${v}`, "LoadImage", { image: views[v] });
    add(`rb_${v}`, "RemoveBackground", { bg_removal_model: ref("bgmodel"), image: ref(`load_${v}`) });
    add(`crop_${v}`, "ImageCropToMask", {
      images: ref(`load_${v}`), masks: ref(`rb_${v}`),
      width: 1024, height: 1024, pad_factor: 1.1, grow_mask: 0, background: "#000000",
    });
  }

  add("cond", "Pixal3DMultiViewConditioning", {
    clip_vision_model: ref("clipvis"), fov: 20.0,
    front: ref("crop_front"), left: ref("crop_left"), back: ref("crop_back"), right: ref("crop_right"),
  });

  add("cfg_a", "CFGOverride", { model: ref("unet"), cfg: 1.0, start_percent: 0.667, end_percent: 1.0 });
  add("rc_a", "RescaleCFG", { multiplier: 0.7, model: ref("cfg_a") });
  add("ms", "ModelSamplingSD3", { shift: 5.0, model: ref("rc_a") });
  add("latent0", "EmptyTrellis2LatentStructure", { batch_size: 1 });
  add("ks_struct", "KSampler", {
    seed: 56, steps: 12, cfg: 7.5, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
    model: ref("ms"), positive: ref("cond", 0), negative: ref("cond", 1), latent_image: ref("latent0"),
  });
  add("dec_struct", "VaeDecodeStructureTrellis2", { samples: ref("ks_struct"), vae: ref("vae_shape"), resolution: "32" });

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

  add("meshinfo", "GetMeshInfo", { mesh: ref("dec_shape", 0) });
  add("remesh", "RemeshMesh", {
    mesh: ref("meshinfo"), resolution: 768, sign_mode: "udf",
    "sign_mode.qef": false, "sign_mode.drop_inverted_components": false, "sign_mode.drop_enclosed_components": false,
    band: 1.0, project_back: 0.0, fix_poles: false, smooth_iters: 20, drop_small_components: 0.01,
    precluster_max_verts: 20000000,
  });
  add("decimate", "DecimateMesh", { mesh: ref("remesh"), target_face_count: 700000, placement_mode: "midpoint" });
  add("smooth_hi", "MeshSmoothNormals", { mesh: ref("decimate"), crease_angle: 180.0 });

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
  // Solid twin for the mold engine (mirrors src/server/comfy/threed.ts).
  add("tofile_solid", "MeshToFile3D", { mesh: ref("smooth_hi") });
  add(SOLID_SAVE_NODE, "Save3DAdvanced", {
    model_3d: ref("tofile_solid"), filename_prefix: "3d/zerolab-solid", viewport_state: "", width: 1024, height: 1024,
  });
  return g;
}

const SOLID_SAVE_NODE = "save_solid";

const front = process.argv[2];
if (!front) { console.error("usage: node test-threed-graph.mjs <front.png> [left back right]"); process.exit(1); }
const [left, back, right] = [process.argv[3], process.argv[4], process.argv[5]];

const inputDir = "D:/Comfy-Desktop/ComfyUI-Shared/input";
const views = {};
for (const [key, src] of [["front", front], ["left", left ?? front], ["back", back ?? front], ["right", right ?? front]]) {
  const dest = path.join(inputDir, `test-view-${key}.png`);
  await copyFile(src, dest);
  views[key] = path.basename(dest);
  console.log(`[test] staged ${views[key]} <- ${src}`);
}

const res = await fetch(`${BASE}/prompt`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: buildThreedGraph(views), client_id: randomUUID() }),
});
if (!res.ok) {
  console.error(`[test] submit failed HTTP ${res.status}:\n${(await res.text()).slice(0, 3000)}`);
  process.exit(2);
}
const { prompt_id: promptId } = await res.json();
console.log(`[test] submitted ${promptId}`);

const started = Date.now();
const deadline = 45 * 60 * 1000;
for (;;) {
  if (Date.now() - started > deadline) { console.error(`[test] timeout after ${Math.round((Date.now() - started) / 60000)} min`); process.exit(3); }
  await new Promise((r) => setTimeout(r, 10_000));
  let entry;
  try {
    const h = await (await fetch(`${BASE}/history/${promptId}`)).json();
    entry = h[promptId];
  } catch (e) { console.log(`[test] poll blip: ${e.message}`); continue; }
  if (!entry) { console.log(`[test] ${(Math.round((Date.now() - started) / 1000))}s queued/running…`); continue; }
  const status = entry.status?.status_str;
  if (status === "error") {
    const errMsg = (entry.status?.messages ?? []).find((m) => m[0] === "execution_error")?.[1];
    console.error(`[test] FAILED: ${JSON.stringify(errMsg, null, 2)?.slice(0, 2000)}`);
    process.exit(4);
  }
  if (status === "success" || entry.status?.completed) {
    // outputs[nodeId] is a dict of output-name → file-ref arrays (Save3DAdvanced
    // uses "3d", SaveImage uses "images") — unwrap two levels, then find refs.
    const refs = [];
    for (const nodeOut of Object.values(entry.outputs ?? {})) {
      for (const arr of Object.values(nodeOut ?? {})) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          if (item && typeof item === "object" && "filename" in item) refs.push(item);
        }
      }
    }
    const glbRefs = refs.filter((r) => (r.filename ?? "").toLowerCase().endsWith(".glb"));
    const textured = glbRefs.find((r) => (r.filename ?? "").includes("zerolab_")) ?? glbRefs[0];
    const solid = glbRefs.find((r) => (r.filename ?? "").includes("solid"));
    if (!textured) { console.error(`[test] finished without GLB: ${JSON.stringify(refs).slice(0, 1000)}`); process.exit(5); }
    const outDir = ".scratch/threed-test";
    await mkdir(outDir, { recursive: true });
    for (const [label, r] of [["textured", textured], ["solid", solid]]) {
      if (!r) { console.log(`[test] no ${label} GLB ref`); continue; }
      const url = new URL(`${BASE}/view`);
      url.searchParams.set("filename", r.filename);
      url.searchParams.set("subfolder", r.subfolder ?? "");
      url.searchParams.set("type", r.type ?? "output");
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
      const outPath = path.join(outDir, `${promptId}-${label}.glb`);
      await writeFile(outPath, bytes);
      console.log(`[test] ${label}: ${outPath} (${(bytes.length / 1048576).toFixed(1)} MB)`);
    }
    console.log(`[test] SUCCESS in ${Math.round((Date.now() - started) / 60000)} min`);
    process.exit(0);
  }
  console.log(`[test] ${(Math.round((Date.now() - started) / 1000))}s ${status ?? "running"}…`);
}
