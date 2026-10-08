import "server-only";

/**
 * Minimal GLB reader for the mold scale mapping (mold-studio ticket 11).
 *
 * The engine bakes `model_scale` before its pipeline and expects
 * `model_scale = (sizeCm × 10) / L` where L is the longest side of the RAW
 * mesh's bounding box in the file's own units (Blender imports glTF 1:1 —
 * ticket 07 §2). Tripo/sample GLBs always carry accessor min/max, so we read
 * those instead of pulling a gltf parser dependency.
 */

export interface GlbBbox {
  min: [number, number, number];
  max: [number, number, number];
  /** Longest bbox side in file units. */
  longest: number;
}

export function glbBbox(bytes: Uint8Array): GlbBbox | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20) return null;
  if (view.getUint32(0, true) !== 0x46546c67) return null; // 'glTF'
  // Chunk 0 must be the JSON chunk.
  const jsonLen = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4e4f534a) return null; // 'JSON'
  const jsonBytes = bytes.subarray(20, 20 + jsonLen);
  let gltf: {
    meshes?: Array<{
      primitives?: Array<{ attributes?: { POSITION?: number } }>;
    }>;
    accessors?: Array<{
      type?: string;
      min?: number[];
      max?: number[];
    }>;
  };
  try {
    gltf = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return null;
  }
  const accessors = gltf.accessors ?? [];
  let min: [number, number, number] | null = null;
  let max: [number, number, number] | null = null;

  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const idx = prim.attributes?.POSITION;
      if (idx === undefined) continue;
      const acc = accessors[idx];
      if (!acc || !acc.min || !acc.max || acc.min.length < 3) continue;
      if (!min) min = [acc.min[0], acc.min[1], acc.min[2]];
      else
        for (let i = 0; i < 3; i++) min[i] = Math.min(min[i], acc.min[i]);
      if (!max) max = [acc.max[0], acc.max[1], acc.max[2]];
      else
        for (let i = 0; i < 3; i++) max[i] = Math.max(max[i], acc.max[i]);
    }
  }
  if (!min || !max) return null;

  const size: [number, number, number] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];
  const longest = Math.max(size[0], size[1], size[2]);
  if (!Number.isFinite(longest) || longest <= 0) return null;
  return { min, max, longest };
}

/**
 * The uniform scale making the mesh's longest side equal `sizeCm` cm, in the
 * engine's mm scene units — clamped to the driver's own [0.001, 1000] range.
 */
export function modelScaleFor(sizeCm: number, bbox: GlbBbox): number {
  const raw = (sizeCm * 10) / bbox.longest;
  return Math.min(1000, Math.max(0.001, raw));
}
