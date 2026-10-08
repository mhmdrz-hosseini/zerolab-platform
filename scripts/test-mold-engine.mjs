/**
 * Mold-engine e2e check: submit a GLB to the local MOLD-FORAGE sidecar and
 * poll to a terminal state.
 *
 *   node scripts/test-mold-engine.mjs <model.glb> [params.json]
 *
 * model_scale is derived from the GLB bbox so the model lands ~100 mm (the
 * engine's convention after scale: 1 unit = 1 mm). Without a params file the
 * platform's effective defaults are used.
 */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const BASE = "http://127.0.0.1:8000";
const glbPath = process.argv[2];
if (!glbPath) { console.error("usage: node test-mold-engine.mjs <model.glb> [params.json]"); process.exit(1); }

function glbExtentMm(bytes) {
  const chunkLen = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + chunkLen).toString("utf8"));
  const prim = gltf.meshes[0].primitives[0];
  const acc = gltf.accessors[prim.attributes.POSITION];
  const d = [0, 1, 2].map((k) => acc.max[k] - acc.min[k]);
  return Math.max(...d);
}

const bytes = await readFile(glbPath);
const extent = glbExtentMm(bytes);
const modelScale = 100 / extent;
console.log(`[mold-test] model extent ${extent.toFixed(3)} units -> model_scale ${modelScale.toFixed(2)}`);

const paramsPath = process.argv[3];
const params = paramsPath
  ? JSON.parse(await readFile(paramsPath, "utf8"))
  : {
      box_style: "POUR_BOX", cast_preset: "WAX", parts_count: 2, wall_thickness: 3,
      solid_shape: "HUG", skin_keys: false, shell_wall: 2, base_style: "FLAT",
      base_flange: true, base_plate: false, fit_clearance: 0.3, flange_width: 6,
      tray_mode: "EMBED", tray_up: "AUTO", tray_outline: "RECT", tray_wall: 2.5,
      tray_floor: 3, tray_margin: 6, tray_depth: 5, wings: true, wing_width: 8,
      bolt_diameter: 3, bolt_auto: true, bolt_count: 0, split_axis: "AUTO",
      split_offset: 0, split_horizontal: false, split_z_offset: 0, contoured: true,
      key_count: 2, registration: "KEYS", sprue: true, sprue_radius: 4,
      big_throat: false, funnel_height: 12, sprue_flare: 2.4, big_mouth: false,
      sprue_count: 1, sprue_place: "TOP", sprue_x: 0, sprue_y: 0,
      vent_count: 0, vent_radius: 1, heal: true, decimate: false,
      decimate_ratio: 0.5, voxel_safe: false, voxel_size: 1,
      silicone_preset: "CUSTOM", silicone_density: 1.15, cast_density: 1.1,
      plastic_density: 1.24,
    };
params.model_scale = modelScale;

const form = new FormData();
form.append("file", new Blob([bytes], { type: "model/gltf-binary" }), "model.glb");
form.append("params", JSON.stringify(params));

const res = await fetch(`${BASE}/api/generate`, { method: "POST", body: form });
if (!res.ok) {
  console.error(`[mold-test] submit failed HTTP ${res.status}: ${(await res.text()).slice(0, 1000)}`);
  process.exit(2);
}
const { job_id: jobId } = await res.json();
console.log(`[mold-test] submitted ${jobId}`);

const started = Date.now();
for (;;) {
  if (Date.now() - started > 45 * 60 * 1000) { console.error("[mold-test] timeout"); process.exit(3); }
  await new Promise((r) => setTimeout(r, 5000));
  let job;
  try {
    job = await (await fetch(`${BASE}/api/job/${jobId}`)).json();
  } catch (e) { console.log(`[mold-test] poll blip: ${e.message}`); continue; }
  const pct = Math.round((job.progress ?? 0) * 100);
  console.log(`[mold-test] ${Math.round((Date.now() - started) / 1000)}s ${pct}% ${job.phase ?? job.status}`);
  if (job.status === "error") {
    console.error(`[mold-test] FAILED (${job.error_code}): ${job.error}`);
    process.exit(4);
  }
  if (job.status === "done") {
    const r = job.result ?? {};
    console.log(`[mold-test] SUCCESS in ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(`  parts: ${(r.parts ?? []).map((p) => `${p.name}(${p.role}, ${(p.bytes / 1048576).toFixed(1)}MB)`).join(", ")}`);
    console.log(`  volumes: ${JSON.stringify(r.volumes)}`);
    process.exit(0);
  }
}
