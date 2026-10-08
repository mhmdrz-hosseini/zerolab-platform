// Unit tests for adviser.js — rules are pure functions of a metrics object,
// so no geometry or DOM needed. Run:  node webui/static/js/adviser.test.mjs
import { advise } from './adviser.js';
import { defaults } from './schema.js';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

function mk({ x = 50, y = 50, z = 50, tris = 1000, components = 1, separated,
              openEdges = 0, nonManifoldEdges = 0, footprintFill = 1,
              undercutX = 0, undercutY = 0 }) {
  const dims = { x, y, z };
  const s = [x, y, z].sort((a, b) => a - b);
  const flatness = s[0] / s[1];   // min/mid, same as analyze.js
  return {
    tris, degenerateTris: 0, dims, flatness,
    volume: x * y * z * 0.4, area: 2 * (x * y + y * z + x * z), volumeReliable: true,
    components, separated, openEdges, nonManifoldEdges,
    watertight: components === 1 && openEdges === 0,
    footprintFill, undercutX, undercutY,
    bbox: { sizeX: x, sizeY: y, sizeZ: z },
  };
}
const cur = () => defaults();
const run = (m, current = cur(), opts) => advise(m, current, opts);

console.log('flat plate 80x80x4 -> TRAY');
{
  const { patch, reasons } = run(mk({ x: 80, y: 80, z: 4, footprintFill: 0.45 }));
  check('box_style TRAY', patch.box_style === 'TRAY');
  check('tray_mode default EMBED (absent)', !('tray_mode' in patch));
  check('tray_up default AUTO (absent)', !('tray_up' in patch));
  check('outline HUG (45% fill)', patch.tray_outline === 'HUG');
  check('wall default 2.5 at 80mm (absent)', !('tray_wall' in patch));
  check('floor default 3.0 (absent)', !('tray_floor' in patch));
  check('margin 6.5', patch.tray_margin === 6.5, patch.tray_margin);
  check('depth clamped to 4', patch.tray_depth === 4, patch.tray_depth);
  check('every patch entry has a reason',
    Object.keys(patch).length === reasons.length &&
    reasons.every(r => r.text && patch[r.key] !== undefined));
  check('no pour-box keys leaked', !('wall_thickness' in patch) && !('sprue_radius' in patch));
}

console.log('tray re-fit: FRAME mode and big pan get corrected');
{
  const current = { ...cur(), box_style: 'TRAY', tray_mode: 'FRAME', tray_up: 'Y' };
  const { patch } = run(mk({ x: 150, y: 100, z: 4, footprintFill: 1 }), current, { keepType: true });
  check('tray_mode back to EMBED', patch.tray_mode === 'EMBED');
  check('tray_up back to AUTO', patch.tray_up === 'AUTO');
  check('wall 3.5 for 150mm pan', patch.tray_wall === 3.5, patch.tray_wall);
  check('floor 4.0', patch.tray_floor === 4.0);
  check('outline default RECT (absent)', !('tray_outline' in patch));
}

console.log('square plate, full footprint -> RECT default');
{
  const { patch } = run(mk({ x: 80, y: 80, z: 4, footprintFill: 1 }));
  check('outline default RECT (absent)', !('tray_outline' in patch));
}

console.log('figurine 60x60x90 -> POUR_BOX, scaled funnel/vents');
{
  const { patch, warnings } = run(mk({ x: 60, y: 60, z: 90 }));
  check('box_style default POUR_BOX (absent)', !('box_style' in patch));
  check('switches off a stale TRAY', run(mk({ x: 60, y: 60, z: 90 }),
    { ...cur(), box_style: 'TRAY' }).patch.box_style === 'POUR_BOX');
  check('wall 3.0 == default (absent)', !('wall_thickness' in patch));
  check('shell 2.5 for char-70 model', patch.shell_wall === 2.5, patch.shell_wall);
  check('funnel 13', patch.funnel_height === 13, patch.funnel_height);
  check('flange 5', patch.flange_width === 5);
  check('wing 6', patch.wing_width === 6);
  check('2 pour points (90 > 1.4x60)', patch.sprue_count === 2);
  check('2 vents (90 > 1.2x60)', patch.vent_count === 2);
  check('vent radius 1.1', patch.vent_radius === 1.1, patch.vent_radius);
  check('bolt default (absent)', !('bolt_diameter' in patch));
  check('no warnings on a clean model', warnings.length === 0, JSON.stringify(warnings));
}

console.log('tall thin 30x30x170 rod is 3D, not a tray');
{
  const { patch } = run(mk({ x: 30, y: 30, z: 170 }));
  check('stays POUR_BOX', !('box_style' in patch) || patch.box_style === 'POUR_BOX');
  check('split_horizontal', patch.split_horizontal === true);
  check('2 pour points', patch.sprue_count === 2);
  check('2 vents', patch.vent_count === 2);
  check('sprue_flare untouched (fpMin not < 30)', !('sprue_flare' in patch));
}

console.log('undercuts on both axes -> 3 radial pieces');
{
  const { patch } = run(mk({ x: 100, y: 100, z: 100, undercutX: 0.2, undercutY: 0.2 }));
  check('parts_count 3', patch.parts_count === 3);
  const again = run(mk({ x: 100, y: 100, z: 100, undercutX: 0.02, undercutY: 0.2 }));
  check('one clean axis -> default 2 (absent)', !('parts_count' in again.patch));
}

console.log('long bar 400x30x30 -> throat capped by mold caps');
{
  const { patch } = run(mk({ x: 400, y: 30, z: 30 }));
  // char=153.3 -> base 10; half_min = 15 + 5(wall) + 3(shell) = 23 -> cap 6.9
  check('sprue_radius capped 6.9', patch.sprue_radius === 6.9, patch.sprue_radius);
  check('wall 5 for XL class', patch.wall_thickness === 5);
  check('large-mold info', patch.reasonsUnused === undefined);
}

console.log('heavy mesh -> decimate');
{
  const { patch } = run(mk({ x: 60, y: 60, z: 90, tris: 600000 }));
  check('decimate on', patch.decimate === true);
  check('ratio 0.4', patch.decimate_ratio === 0.4);
  const light = run(mk({ x: 60, y: 60, z: 90, tris: 100000 }));
  check('light mesh untouched', !('decimate' in light.patch));
  const heavy = run(mk({ x: 60, y: 60, z: 90, tris: 300000 }));
  check('300k -> info warning only', !('decimate' in heavy.patch) &&
    heavy.warnings.some(w => w.level === 'info' && w.text.includes('heavy-mesh')));
}

console.log('broken mesh -> safe remesh + warnings');
{
  const { patch, warnings } = run(mk({ x: 100, y: 100, z: 100, components: 3, separated: 3 }));
  check('voxel_safe on', patch.voxel_safe === true);
  check('voxel_size capped 1.5', patch.voxel_size === 1.5, patch.voxel_size);
  check('separated-clusters error', warnings.some(w => w.level === 'error' && w.text.includes('3 separate clusters')));
  const touching = run(mk({ x: 100, y: 100, z: 100, components: 3, separated: 1 }));
  check('touching pieces -> warn, not error', touching.warnings.some(w =>
    w.level === 'warn' && w.text.includes('touch')) &&
    !touching.warnings.some(w => w.level === 'error'));
  const open = run(mk({ x: 100, y: 100, z: 100, openEdges: 4 }));
  check('open-edges warn', open.warnings.some(w => w.level === 'warn' && w.text.includes('watertight')));
  check('open mesh -> safe remesh', open.patch.voxel_safe === true);
}

console.log('keepType: user-chosen SOLID is respected');
{
  const current = { ...cur(), box_style: 'SOLID' };
  const { patch } = run(mk({ x: 120, y: 120, z: 120 }), current, { keepType: true });
  check('no box_style override', !('box_style' in patch));
  check('wall sized (4)', patch.wall_thickness === 4);
  check('no shell_wall (SOLID)', !('shell_wall' in patch));
  check('no tray keys', !('tray_wall' in patch));
}

console.log('keepType: user-chosen TRAY on a chunky model warns but advises tray params');
{
  const current = { ...cur(), box_style: 'TRAY' };
  const { patch, warnings } = run(mk({ x: 150, y: 100, z: 100 }), current, { keepType: true });
  check('tray params advised', patch.tray_wall === 3.5, patch.tray_wall);
  check('not-flat warning (100 > 0.6x150)', warnings.some(w => w.text.includes('not flat')));
}

console.log('materials never touched');
{
  const { patch } = run(mk({ x: 60, y: 60, z: 90, tris: 900000, components: 4 }));
  for (const k of ['silicone_density', 'cast_density', 'plastic_density', 'silicone_preset', 'cast_preset'])
    check(`${k} untouched`, !(k in patch));
}

console.log('re-fit with everything already applied: empty patch, reasons persist');
{
  const m = mk({ x: 60, y: 60, z: 90 });
  const first = run(m);
  const applied = { ...cur(), ...first.patch };
  const second = advise(m, applied, { keepType: true });
  const advisedKeys = new Set(second.reasons.map(r => r.key));
  for (const k of Object.keys(first.patch))
    check(`reason kept for ${k}`, advisedKeys.has(k) && !(k in second.patch));
}

console.log('extreme sizes warn');
{
  const small = run(mk({ x: 30, y: 1.5, z: 30 }));
  check('tiny-extent info', small.warnings.some(w => w.text.includes('Thinnest extent')));
  const big = run(mk({ x: 320, y: 100, z: 100 }));
  check('large-extent info', big.warnings.some(w => w.text.includes('Largest extent')));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall adviser tests passed');
process.exitCode = failures ? 1 : 0;
