import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import * as THREE from "three";

/**
 * Sample `count` surface points from every mesh under `root`, weighted by
 * each mesh's total triangle area, returned in root-local coordinates
 * (call with the normalized model root at identity — see useGLBModel).
 */

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();

function triangleArea(mesh: THREE.Mesh): number {
  const geom = mesh.geometry;
  const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return 0;
  const index = geom.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let area = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    area += _tmp.subVectors(b, a).cross(_tmp2.subVectors(c, a)).length() / 2;
  }
  return area;
}

interface MeshEntry {
  mesh: THREE.Mesh;
  sampler: MeshSurfaceSampler;
  area: number;
}

export function sampleSurfacePoints(
  root: THREE.Object3D,
  count: number,
): Float32Array {
  root.updateMatrixWorld(true);

  const entries: MeshEntry[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry;
    // MeshSurfaceSampler needs a position attribute; skip anything exotic.
    if (!geom.getAttribute("position")) return;
    try {
      entries.push({
        mesh,
        sampler: new MeshSurfaceSampler(mesh).build(),
        area: Math.max(triangleArea(mesh), 1e-9),
      });
    } catch {
      // Degenerate geometry — skip.
    }
  });

  const out = new Float32Array(count * 3);
  if (entries.length === 0) {
    // Fallback: spread points on a small dome so the morph still plays.
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.5 * Math.cbrt(Math.random());
      out[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      out[i * 3 + 1] = 0.5 + r * Math.cos(phi) * 0.5;
      out[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    return out;
  }

  const totalArea = entries.reduce((sum, e) => sum + e.area, 0);
  const v = new THREE.Vector3();
  let written = 0;
  for (let e = 0; e < entries.length; e++) {
    const entry = entries[e];
    const isLast = e === entries.length - 1;
    const n = isLast
      ? count - written
      : Math.max(1, Math.floor((entry.area / totalArea) * count));
    for (let i = 0; i < n && written < count; i++, written++) {
      entry.sampler.sample(v);
      // Sampler positions are in the mesh's local space — lift to root-local
      // (root sits at identity inside the stage, so this is also stage space).
      v.applyMatrix4(entry.mesh.matrixWorld);
      out[written * 3] = v.x;
      out[written * 3 + 1] = v.y;
      out[written * 3 + 2] = v.z;
    }
  }
  return out;
}
