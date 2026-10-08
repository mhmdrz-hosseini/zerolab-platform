// Smart-adviser smoke test on real STL files — same chain the browser runs
// (analyze → advise over factory defaults), minus Three.js: STL is parsed
// here directly. Usage:  node webui/smoke_advisor.mjs model1.stl [model2.stl …]
import { readFileSync } from 'node:fs';
import { analyzeModel } from './static/js/analyze.js';
import { advise } from './static/js/adviser.js';
import { defaults } from './static/js/schema.js';

function stlPositions(path) {
  const buf = readFileSync(path);
  const triCount = buf.readUInt32LE(80);
  const positions = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    const off = 84 + t * 50 + 12;   // skip 80-byte header, count, normal
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = buf.readFloatLE(off + k * 4);
  }
  return { isMesh: true,
    geometry: { attributes: { position: { array: positions, count: triCount * 3 } }, index: null },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
}

for (const path of process.argv.slice(2)) {
  const m = analyzeModel({
    updateWorldMatrix() {},
    traverse(cb) { cb(stlPositions(path)); },
  });
  if (!m) { console.log(`${path}: NO MESH`); continue; }
  const { patch, reasons, warnings } = advise(m, defaults());
  console.log(`\n=== ${path}`);
  console.log(`  tris=${m.tris.toLocaleString()}  dims=${m.dims.x.toFixed(1)}x${m.dims.y.toFixed(1)}x${m.dims.z.toFixed(1)}` +
    `  flat=${m.flatness.toFixed(2)}  vol=${Math.round(m.volume).toLocaleString()}mm³` +
    `  comps=${m.components}  open=${m.openEdges}  nonman=${m.nonManifoldEdges}` +
    `  fill=${m.footprintFill.toFixed(2)}  undercut=${m.undercutX.toFixed(2)}/${m.undercutY.toFixed(2)}`);
  for (const r of reasons) console.log(`  · ${r.key} = ${patch[r.key]}  (${r.text})`);
  for (const w of warnings) console.log(`  ${w.level.toUpperCase()}: ${w.text}`);
}
