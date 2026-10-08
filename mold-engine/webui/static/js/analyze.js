// MoldForge WebUI — client-side shape analysis for the Smart Adviser.
//
// analyzeModel(root) runs a few O(n) passes over the already-parsed preview
// object, in world space — the same frame viewer.modelBBox() reports, so
// glTF's -90° X correction is included. Zero imports, duck-typed against
// THREE.Object3D, so the module also runs under plain Node for unit tests.
//
// Units: 1 scene unit = 1 mm. Deterministic — this feeds a rules engine,
// not a model call.
//
// The undercut proxy mirrors the add-on's own draft check (core/util.py
// undercut_fraction): a ray along the pull axis that crosses the surface
// more than twice sits over a trapped pocket. A grid column with more than
// one disjoint depth interval is exactly that. We sample 32×32 cell centres
// (finer than upstream's 16×16 rays).

const N = 32; // grid resolution per projection

// ---------------------------------------------------------------------------
// triangle iteration — handles indexed + non-indexed geometry, applies
// matrixWorld (THREE column-major element order)

function forEachTriangle(root, cb) {
  if (root.updateWorldMatrix) root.updateWorldMatrix(true, true);
  const p = [0, 0, 0];
  root.traverse(o => {
    if (!o || !o.isMesh || !o.geometry) return;
    const pos = o.geometry.attributes && o.geometry.attributes.position;
    if (!pos || !pos.array) return;
    const m = o.matrixWorld.elements;
    const idx = o.geometry.index ? o.geometry.index.array : null;
    const count = idx ? idx.length : pos.count;
    const a = pos.array;
    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = idx ? idx[t] : t, i1 = idx ? idx[t + 1] : t + 1,
            i2 = idx ? idx[t + 2] : t + 2;
      for (let v = 0; v < 3; v++) {
        const j = (v === 0 ? i0 : v === 1 ? i1 : i2) * 3;
        const x = a[j], y = a[j + 1], z = a[j + 2];
        p[v * 3]     = m[0] * x + m[4] * y + m[8]  * z + m[12];
        p[v * 3 + 1] = m[1] * x + m[5] * y + m[9]  * z + m[13];
        p[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      cb(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]);
    }
  });
}

// ---------------------------------------------------------------------------
// per-axis depth grids: projection onto the two non-depth axes, each covered
// cell collects depth intervals [lo, hi] which are merged into disjoint
// segments afterwards (segments > 1 ⇔ trapped pocket, i.e. > 2 crossings)

function makeGrid() {
  return { intervals: new Array(N * N), occupied: new Uint8Array(N * N) };
}

// grid axes: u, v = projection-plane indices; d = depth (pull-axis) index
function stamp(grid, u, v, d, bbox, tri) {
  const u0 = bbox.min[u], v0 = bbox.min[v];
  const du = (bbox.max[u] - u0) / N || 1;
  const dv = (bbox.max[v] - v0) / N || 1;
  const i0 = Math.max(0, Math.floor((Math.min(tri[u], tri[3 + u], tri[6 + u]) - u0) / du));
  const i1 = Math.min(N - 1, Math.floor((Math.max(tri[u], tri[3 + u], tri[6 + u]) - u0) / du));
  const j0 = Math.max(0, Math.floor((Math.min(tri[v], tri[3 + v], tri[6 + v]) - v0) / dv));
  const j1 = Math.min(N - 1, Math.floor((Math.max(tri[v], tri[3 + v], tri[6 + v]) - v0) / dv));
  if (i1 < i0 || j1 < j0) return;

  const dmin = Math.min(tri[d], tri[3 + d], tri[6 + d]);
  const dmax = Math.max(tri[d], tri[3 + d], tri[6 + d]);
  // projected 2D triangle (counter-clockwise or clockwise — sign-agnostic)
  const ax = tri[u], ay = tri[v], bx = tri[3 + u], by = tri[3 + v],
        cx = tri[6 + u], cy = tri[6 + v];
  const area2 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area2) < 1e-12) return;   // edge-on in this projection
  const s = area2 > 0 ? 1 : -1;

  for (let j = j0; j <= j1; j++) {
    const py = v0 + (j + 0.5) * dv;
    for (let i = i0; i <= i1; i++) {
      const px = u0 + (i + 0.5) * du;
      // point-in-triangle via edge signs (cell-centre sampling, like the
      // upstream ray grid)
      const w1 = s * ((bx - ax) * (py - ay) - (px - ax) * (by - ay));
      if (w1 < 0) continue;
      const w2 = s * ((cx - bx) * (py - by) - (px - bx) * (cy - by));
      if (w2 < 0) continue;
      const w3 = s * ((ax - cx) * (py - cy) - (px - cx) * (ay - cy));
      if (w3 < 0) continue;
      const cell = j * N + i;
      (grid.intervals[cell] || (grid.intervals[cell] = [])).push(dmin, dmax);
      grid.occupied[cell] = 1;
    }
  }
}

function undercutFraction(grid) {
  let occupied = 0, trapped = 0;
  for (let c = 0; c < N * N; c++) {
    if (!grid.occupied[c]) continue;
    occupied++;
    const iv = grid.intervals[c];
    const order = [];
    for (let k = 0; k < iv.length; k += 2) order.push(iv[k], iv[k + 1]);
    // insertion sort of [lo,hi] pairs (lists are tiny)
    for (let k = 2; k < order.length; k += 2) {
      const lo = order[k], hi = order[k + 1];
      let t = k - 2;
      while (t >= 0 && order[t] > lo) {
        order[t + 2] = order[t]; order[t + 3] = order[t + 1];
        t -= 2;
      }
      order[t + 2] = lo; order[t + 3] = hi;
    }
    let segs = 0, hi = -Infinity;
    for (let k = 0; k < order.length; k += 2) {
      if (order[k] > hi + 1e-9) segs++;
      if (order[k + 1] > hi) hi = order[k + 1];
    }
    // a clean shape is crossed exactly twice (enter + exit); more disjoint
    // surface segments than that = a trapped pocket, as upstream counts it
    if (segs > 2) trapped++;
  }
  return occupied ? trapped / occupied : 0;
}

// ---------------------------------------------------------------------------
// vertex welding + union-find: connected components and edge-manifold counts

function makeTopology(bbox) {
  const span = Math.max(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1],
                        bbox.max[2] - bbox.min[2]);
  // weld epsilon, mm — comfortably above the engine's heal
  // (bmesh remove_doubles dist=1e-5) so components match what Blender sees
  const eps = Math.max(1e-4, span * 1e-6);
  const inv = 1 / eps;
  const cells = new Map();   // "i,j,k" -> [{x,y,z,id}, …]
  const parent = [];
  const edges = new Map();
  const bmin = [], bmax = [];  // per-welded-vertex position bounds → per-component bbox

  const find = a => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  return {
    vertex(x, y, z) {
      // spatial hash with 27-neighbour lookup: catches near-coincident
      // vertices even when quantisation would place them in different cells
      const gi = Math.round(x * inv), gj = Math.round(y * inv), gk = Math.round(z * inv);
      const e2 = eps * eps;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        const list = cells.get((gi + di) + ',' + (gj + dj) + ',' + (gk + dk));
        if (!list) continue;
        for (const c of list) {
          const dx = c.x - x, dy = c.y - y, dz = c.z - z;
          if (dx * dx + dy * dy + dz * dz <= e2) {
            for (let a = 0; a < 3; a++) {
              const t = a === 0 ? x : a === 1 ? y : z;
              if (t < bmin[c.id][a]) bmin[c.id][a] = t;
              if (t > bmax[c.id][a]) bmax[c.id][a] = t;
            }
            return c.id;
          }
        }
      }
      const id = parent.length;
      parent.push(id);
      bmin.push([x, y, z]);
      bmax.push([x, y, z]);
      const key = gi + ',' + gj + ',' + gk;
      let list = cells.get(key);
      if (!list) { list = []; cells.set(key, list); }
      list.push({ x, y, z, id });
      return id;
    },
    triangle(a, b, c) {
      union(a, b); union(b, c);
      for (const [p, r] of [[a, b], [b, c], [c, a]]) {
        const k = p < r ? p + '_' + r : r + '_' + p;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    },
    stats() {
      const roots = new Set();
      for (let i = 0; i < parent.length; i++) roots.add(find(i));
      let open = 0, nonManifold = 0;
      for (const n of edges.values()) {
        if (n === 1) open++;
        else if (n > 2) nonManifold++;
      }
      // per-component bounding boxes — the adviser clusters them with the
      // engine's own fuse distance (the recovery remesh's voxel size)
      let componentBoxes = null;
      if (roots.size > 1 && roots.size <= 64) {
        const rootList = [...roots];
        const idx = new Map(rootList.map((r, i) => [r, i]));
        componentBoxes = rootList.map(() =>
          [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
        for (let i = 0; i < parent.length; i++) {
          const b = componentBoxes[idx.get(find(i))];
          for (let a = 0; a < 3; a++) {
            if (bmin[i][a] < b[a]) b[a] = bmin[i][a];
            if (bmax[i][a] > b[a + 3]) b[a + 3] = bmax[i][a];
          }
        }
      }
      return { components: roots.size, componentBoxes, openEdges: open, nonManifoldEdges: nonManifold };
    },
  };
}

// ---------------------------------------------------------------------------

export function analyzeModel(root) {
  // pass 1 — bounding box
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  forEachTriangle(root, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    tris++;
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
    }
  });
  if (!tris || !isFinite(min[0])) return null;
  const bbox = { min, max };

  // pass 2 — volume, area, topology, depth grids
  const topo = makeTopology(bbox);
  const gx = makeGrid();   // pull axis X → projection (Y, Z)
  const gy = makeGrid();   // pull axis Y → projection (X, Z)
  const gf = makeGrid();   // footprint: projection (X, Y)
  let vol6 = 0, area2 = 0, degenerate = 0;
  const tri = new Array(9);

  forEachTriangle(root, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz <= 1e-20) { degenerate++; return; }
    area2 += Math.sqrt(nx * nx + ny * ny + nz * nz);
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);

    topo.triangle(topo.vertex(ax, ay, az), topo.vertex(bx, by, bz), topo.vertex(cx, cy, cz));

    tri[0] = ax; tri[1] = ay; tri[2] = az;
    tri[3] = bx; tri[4] = by; tri[5] = bz;
    tri[6] = cx; tri[7] = cy; tri[8] = cz;
    stamp(gx, 1, 2, 0, bbox, tri);
    stamp(gy, 0, 2, 1, bbox, tri);
    stamp(gf, 0, 1, 2, bbox, tri);
  });

  const t = topo.stats();
  const dims = { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
  const sorted = [dims.x, dims.y, dims.z].sort((a, b) => a - b);
  let footprintFill = 0;
  {
    let occ = 0;
    for (let c = 0; c < N * N; c++) occ += gf.occupied[c];
    footprintFill = occ / (N * N);
  }
  return {
    tris, degenerateTris: degenerate,
    dims,
    // relief measure: thin relative to BOTH other extents (min/mid, not
    // min/max — min/max would call a tall figurine or long bar "flat")
    flatness: sorted[0] / (sorted[1] || 1),
    volume: Math.abs(vol6) / 6,
    area: area2 / 2,
    volumeReliable: t.openEdges === 0 && t.nonManifoldEdges === 0 && t.components === 1,
    ...t,
    watertight: t.openEdges === 0 && t.nonManifoldEdges === 0 && t.components === 1,
    footprintFill,
    undercutX: undercutFraction(gx),
    undercutY: undercutFraction(gy),
    bbox: { sizeX: dims.x, sizeY: dims.y, sizeZ: dims.z },  // moldCaps() parity
  };
}

// Count clusters of component bounding boxes that come within `touch` mm of
// each other — the adviser passes the engine's recovery-remesh voxel size as
// `touch`, since pieces that close get fused by auto-recovery.
export function clusterBoxes(boxes, touch) {
  const parent = boxes.map((_, i) => i);
  const find = a => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const A = boxes[a], B = boxes[b];
    if (A[0] - touch <= B[3] && B[0] - touch <= A[3] &&
        A[1] - touch <= B[4] && B[1] - touch <= A[4] &&
        A[2] - touch <= B[5] && B[2] - touch <= A[5]) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
  }
  return new Set(parent.map(find)).size;
}
