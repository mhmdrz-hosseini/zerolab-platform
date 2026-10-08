// Unit tests for analyze.js — synthetic duck-typed meshes, plain Node.
// Run:  node webui/static/js/analyze.test.mjs
import { analyzeModel, clusterBoxes } from './analyze.js';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name} ${extra}`); }
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- mesh builders -----------------------------------------------------------

function boxTris(x0, y0, z0, x1, y1, z1, skipFace) {
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = {
    bottom: [0, 3, 2, 1], top: [4, 5, 6, 7],
    y0: [0, 1, 5, 4], y1: [2, 3, 7, 6],
    x0: [0, 4, 7, 3], x1: [1, 2, 6, 5],
  };
  const out = [];
  for (const [name, q] of Object.entries(quads)) {
    if (name === skipFace) continue;
    const [a, b, cc, d] = q;
    out.push(...c[a], ...c[b], ...c[cc]);
    out.push(...c[a], ...c[cc], ...c[d]);
  }
  return out;
}

function mesh(flat, elements) {
  return {
    isMesh: true,
    geometry: {
      attributes: { position: { array: new Float32Array(flat), count: flat.length / 3 } },
      index: null,
    },
    matrixWorld: { elements: elements || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  };
}
const rootOf = (...meshes) => ({
  updateWorldMatrix() {},
  traverse(cb) { meshes.forEach(cb); },
});

// --- tests --------------------------------------------------------------------

console.log('cube 50 mm');
{
  const m = analyzeModel(rootOf(mesh(boxTris(-25, -25, -25, 25, 25, 25))));
  check('tris', m.tris === 12);
  check('dims', close(m.dims.x, 50) && close(m.dims.y, 50) && close(m.dims.z, 50));
  check('volume 125000', close(m.volume, 125000, 1e-3), m.volume);
  check('area 15000', close(m.area, 15000, 1e-3), m.area);
  check('watertight', m.watertight && m.components === 1 && m.openEdges === 0 && m.nonManifoldEdges === 0);
  check('volumeReliable', m.volumeReliable);
  check('flatness 1', close(m.flatness, 1));
  check('footprint fill 1', close(m.footprintFill, 1, 0.02));
  check('no undercuts', m.undercutX === 0 && m.undercutY === 0, `${m.undercutX}/${m.undercutY}`);
}

console.log('plate 80x80x4');
{
  const m = analyzeModel(rootOf(mesh(boxTris(-40, -40, -2, 40, 40, 2))));
  check('flatness 0.05', close(m.flatness, 0.05));
  check('dims', close(m.dims.z, 4) && close(m.dims.x, 80));
}

console.log('two separated cubes -> 2 components');
{
  const m = analyzeModel(rootOf(mesh([
    ...boxTris(0, 0, 0, 20, 20, 20),
    ...boxTris(50, 0, 0, 70, 20, 20),
  ])));
  check('components 2', m.components === 2, m.components);
  check('componentBoxes present', Array.isArray(m.componentBoxes) && m.componentBoxes.length === 2);
  check('far apart at any fuse distance', clusterBoxes(m.componentBoxes, 3.5) === 2);
  check('not watertight', !m.watertight);
  check('no open edges per se', m.openEdges === 0);
}

console.log('two cubes 0.5mm apart -> fusable at the engine voxel size');
{
  const m = analyzeModel(rootOf(mesh([
    ...boxTris(0, 0, 0, 20, 20, 20),
    ...boxTris(20.5, 0, 0, 40, 20, 20),
  ])));
  check('components 2', m.components === 2, m.components);
  check('one cluster at 1mm fuse distance', clusterBoxes(m.componentBoxes, 1.0) === 1);
  check('two clusters below the gap (0.2mm)', clusterBoxes(m.componentBoxes, 0.2) === 2);
}

console.log('cube missing top face -> open edges');
{
  const m = analyzeModel(rootOf(mesh(boxTris(0, 0, 0, 20, 20, 20, 'top'))));
  check('openEdges 4', m.openEdges === 4, m.openEdges);
  check('nonManifold 0', m.nonManifoldEdges === 0);
  check('not watertight', !m.watertight && !m.volumeReliable);
}

console.log('bridge (two walls + floor) -> X undercut only');
{
  const m = analyzeModel(rootOf(mesh([
    ...boxTris(-30, -5, 0, -20, 5, 20),   // wall A
    ...boxTris(20, -5, 0, 30, 5, 20),     // wall B
    ...boxTris(-20, -5, 0, 20, 5, 4),     // floor joining them
  ])));
  check('single component', m.components === 1, m.components);
  check('volume 5600', close(m.volume, 5600, 1e-3), m.volume);
  check('undercutX high', m.undercutX > 0.3, m.undercutX);
  check('undercutY zero', m.undercutY === 0, m.undercutY);
}

console.log('rod 30x30x170 and bar 100x10x8 are 3D, not reliefs');
{
  const rod = analyzeModel(rootOf(mesh(boxTris(-15, -15, -85, 15, 15, 85))));
  check('rod flatness 1', close(rod.flatness, 1), rod.flatness);
  const bar = analyzeModel(rootOf(mesh(boxTris(0, -5, -4, 100, 5, 4))));
  check('bar flatness 0.8 (thin vs mid, not vs max)', close(bar.flatness, 0.8), bar.flatness);
}

console.log('rotated 90deg about Z -> dims swap');
{
  // THREE Matrix4 column-major for rotZ(90): x->y, y->-x
  const rot = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const m = analyzeModel(rootOf(mesh(boxTris(0, 0, 0, 50, 20, 10), rot)));
  check('dims swapped', close(m.dims.x, 20) && close(m.dims.y, 50) && close(m.dims.z, 10),
    JSON.stringify(m.dims));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall analyze tests passed');
process.exitCode = failures ? 1 : 0;
