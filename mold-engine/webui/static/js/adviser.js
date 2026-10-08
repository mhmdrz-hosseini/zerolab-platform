// MoldForge WebUI — Smart Adviser: deterministic shape → parameter rules.
//
// advise(metrics, currentValues, opts) → { patch, reasons, warnings }.
// `patch` holds only the parameters that should change; `reasons` carries one
// plain-language line per change; `warnings` are model health notes shown
// regardless. All thresholds are named constants anchored to the unmodified
// add-on's own semantics (cited per constant) — no AI, no network.
//
// Safety rails by design:
//   • SOLID (Direct Printed Mold) is never auto-picked — a rigid mold can't
//     forgive an undercut our proxy might miss; silicone always can.
//   • big_throat / big_mouth are never auto-enabled (overhang / thin-shell
//     risk).
//   • split_axis stays AUTO — the engine resolves it with real ray casts.
//   • sprue/vent suggestions are capped by moldCaps() so the form never
//     shows a value the engine would silently snap down.

import { moldCaps, defaults as factoryDefaults } from './schema.js';
import { clusterBoxes } from './analyze.js';

// --- thresholds (upstream anchors) -----------------------------------------
const TRAY_FLAT_RATIO = 0.55; // relief = tray: thin vs BOTH other extents; safety margin under upstream 0.6 (core/constants.py TRAY_FLAT_RATIO)
const HUG_FILL_MAX = 0.55;    // footprint fills less of its box → Hug outline (README: ~20–25% silicone saved on round shapes)
const RADIAL_UNDERCUT = 0.08; // trapped pockets on BOTH axes → radial wedges (README: "undercuts on every side")
const HEAVY_FACES = 250000;   // upstream HEAVY_FACES — the engine auto voxel-remeshes above this
const DECIMATE_TRIS = 500000; // deep in auto-remesh territory → pre-decimate to keep detail and speed the build
const XL_HEIGHT = 160;        // mm; Horizontal Split is "for XL molds" (properties.py)
const TALL_POUR = 1.4;        // height > 1.4 × footprint → second pour point (README: "more helps fill tall figures")
const TALL_VENT = 1.2;        // height > 1.2 × min footprint → air traps high → vents

// --- small helpers ----------------------------------------------------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r05 = v => Math.round(v * 2) / 2;
const r1 = v => Math.round(v * 10) / 10;
const f1 = v => (Math.round(v * 10) / 10).toString();
const pct = v => Math.round(v * 100);

export function advise(m, current, opts = {}) {
  const patch = {};
  const reasons = [];
  const warnings = [];
  if (!m) {
    return { patch, reasons, warnings: [
      { level: 'warn', text: 'Shape analysis unavailable — factory defaults kept.' },
    ]};
  }

  // `patch` = what must change in the current values; `reasons` = every
  // recommendation that differs from the FACTORY defaults, so a re-fit that
  // changes nothing still lists the advice this shape is carrying.
  const factory = factoryDefaults();
  const put = (key, val, why) => {
    if (current[key] !== val) patch[key] = val;
    if (factory[key] !== val) reasons.push({ key, text: why });
  };

  const { x, y, z } = m.dims;
  const extents = [x, y, z].sort((a, b) => a - b);
  const minE = extents[0], maxE = extents[2];
  const char = (x + y + z) / 3;               // "character size", same as pipeline._derive_sizes
  const fpMin = Math.min(x, y), fpMax = Math.max(x, y);
  const flat = m.flatness <= TRAY_FLAT_RATIO;

  // --- mold type ------------------------------------------------------------
  // A tray re-lays the model on its flattest side, so the pan span is the
  // largest extent and the relief height the smallest.
  const type = opts.keepType ? current.box_style : (flat ? 'TRAY' : 'POUR_BOX');
  if (!opts.keepType) {
    put('box_style', type, flat
      ? `Flat relief — ${f1(minE)} mm thin vs ${f1(maxE)} mm wide → open-pour tray`
      : `Chunky 3D shape (${f1(minE)}–${f1(maxE)} mm throughout) → silicone pour box, flexible release`);
  }
  // mirrors upstream prebuild_warnings: tray on a chunky model (thinnest
  // extent > 0.6 × largest, core/constants.py TRAY_FLAT_RATIO)
  if (type === 'TRAY' && minE > 0.6 * maxE) {
    warnings.push({ level: 'warn',
      text: 'This model is not flat — a tray captures one face only; a Pour Box suits a chunky 3D object better (the engine will warn too).' });
  }

  // --- dimensional parameters -------------------------------------------------
  if (type === 'TRAY') {
    put('tray_mode', 'EMBED', 'Standard path — pour silicone over the embedded master');
    put('tray_up', 'AUTO', 'Engine lays the model on its flattest side automatically');
    put('tray_outline', m.footprintFill < HUG_FILL_MAX ? 'HUG' : 'RECT',
      `Footprint fills ${pct(m.footprintFill)}% of its bounding box → ` +
      (m.footprintFill < HUG_FILL_MAX ? 'Hug outline, saves ~20–25% silicone' : 'rectangular pan, simplest and strongest'));
    const wall = maxE <= 80 ? 2.5 : maxE <= 140 ? 3.0 : 3.5;
    put('tray_wall', wall, `Pan span ${f1(maxE)} mm → ${f1(wall)} mm walls for rigidity`);
    const floor = maxE <= 80 ? 3.0 : maxE <= 160 ? 4.0 : 5.0;
    put('tray_floor', floor, `Pan span ${f1(maxE)} mm → ${f1(floor)} mm floor`);
    put('tray_margin', clamp(r05(maxE * 0.08), 5, 12), 'Silicone border scaled to the pan span');
    put('tray_depth', clamp(r05(minE * 0.75), 4, 10), `Slab over the ${f1(minE)} mm relief, proportional to its height`);
  } else {
    const wall = char < 45 ? 2.5 : char < 90 ? 3.0 : char < 150 ? 4.0 : 5.0;
    put('wall_thickness', wall, `Model class ${f1(char)} mm (mean of X/Y/Z) → ${f1(wall)} mm silicone wall`);
    if (type === 'POUR_BOX') {
      const shell = char < 60 ? 2.0 : char < 120 ? 2.5 : 3.0;
      put('shell_wall', shell, `Printed jacket for a ${f1(char)} mm class model → ${f1(shell)} mm`);
    }

    // caps computed with the advised walls so suggestions never exceed what
    // the engine would auto-fit (schema.moldCaps = properties.mold_caps)
    const caps = moldCaps(m.bbox, {
      wall_thickness: patch.wall_thickness ?? current.wall_thickness,
      shell_wall: patch.shell_wall ?? current.shell_wall,
      box_style: type,
    });
    const throatBase = clamp(r05(char * 0.06), 3, 10);
    const throat = caps ? clamp(Math.min(throatBase, caps.sprue_r), 0.3, Infinity) : throatBase;
    put('sprue_radius', r1(throat),
      `Pour throat for a ${f1(char)} mm class mold` +
      (caps && throatBase > caps.sprue_r + 1e-9 ? ' (capped to the auto-fit limit)' : ''));
    put('funnel_height', clamp(Math.round(char * 0.18), 8, 30), 'Funnel height scaled to model size');

    put('flange_width', clamp(Math.round(char * 0.07), 5, 12), 'Mounting flange scaled to mold size');
    if (char < 35) {
      put('wings', false, 'Tiny mold — contoured parting self-registers, clamp wings unnecessary');
    } else {
      put('wing_width', clamp(Math.round(char * 0.09), 6, 14), 'Clamp flange spread scaled to mold size');
    }
    put('bolt_diameter', char >= 120 ? 4.0 : 3.0, 'Bolt holes sized for the mold');

    const radial = m.undercutX > RADIAL_UNDERCUT && m.undercutY > RADIAL_UNDERCUT;
    put('parts_count', radial ? 3 : 2, radial
      ? `Trapped pockets on both axes (~${pct(m.undercutX)}% / ~${pct(m.undercutY)}% of the silhouette) → 3 radial wedges, each pulls straight out`
      : 'No deep pockets on a shared axis → standard two-part split');

    if (z > XL_HEIGHT) {
      put('split_horizontal', true, `Mold is ${f1(z)} mm tall → horizontal split keeps each piece printable`);
    }

    if (z > TALL_POUR * fpMax) {
      put('sprue_count', 2, `Tall figure (${f1(z)} mm vs ${f1(fpMax)} mm footprint) → second pour point`);
    }
    if (z > TALL_VENT * fpMin) {
      put('vent_count', 2, `Tall and narrow (${f1(z)} mm vs ${f1(fpMin)} mm) → 2 air vents from the high points`);
      let vr = clamp(r1(char * 0.015), 0.8, 2.0);
      if (caps) vr = clamp(Math.min(vr, caps.vent_r), 0.2, Infinity);
      put('vent_radius', r1(vr), 'Vent channels scaled to the mold, within the auto-fit cap');
    }
    if (fpMin < 30) {
      put('sprue_flare', 2.0, `Narrow mold (${f1(fpMin)} mm) — a wide catch cone would not fit`);
    }
  }

  // --- mesh prep (independent of mold type) -----------------------------------
  const broken = m.components > 1 || m.openEdges > 0 || m.nonManifoldEdges > 0;
  if (m.tris > DECIMATE_TRIS) {
    put('decimate', true, `${m.tris.toLocaleString()} triangles — decimate keeps detail in and build times down`);
    put('decimate_ratio', 0.4, 'Keep 40% of the triangles');
  }
  if (broken) {
    put('voxel_safe', true, 'Mesh is not clean — Safe Remesh gives the boolean tools a closed, manifold surface');
    put('voxel_size', clamp(r05(minE / 50), 0.1, 1.5), 'Remesh voxel scaled to the smallest extent');
  }

  // --- model health warnings ---------------------------------------------------
  if (m.components > 1) {
    // Pieces closer together than the engine's recovery-remesh voxel get
    // fused automatically (pipeline.py: max(0.7 × offset, 0.3), capped at
    // a quarter of the thinnest extent) — only clusters wider apart fail.
    const wall = patch.wall_thickness ?? current.wall_thickness ?? 3.0;
    const shell = type === 'POUR_BOX' ? (patch.shell_wall ?? current.shell_wall ?? 2.0) : 0.0;
    const fuse = Math.min(Math.max(0.7 * (wall + shell), 0.3),
                          Math.max(0.25 * minE, 0.05));
    const sep = m.separated !== undefined ? m.separated
              : m.componentBoxes ? clusterBoxes(m.componentBoxes, fuse)
              : m.components;
    if (type === 'TRAY') {
      warnings.push({ level: 'warn',
        text: `Model is ${m.components} pieces — they will be embedded into the pan floor wherever they sit; widely floating pieces can still come out disconnected.` });
    } else if (sep > 1) {
      warnings.push({ level: 'error',
        text: `Model is in ${sep} separate clusters (${m.components} pieces) — mold generation will fail. Join the pieces in a 3D editor so they overlap, or mold them separately.` });
    } else {
      warnings.push({ level: 'warn',
        text: `Model is ${m.components} pieces that touch or overlap — the engine will try to fuse them by auto-remesh (smooths some detail, and fails if there are real gaps). If generation fails, join the pieces in a 3D editor.` });
    }
  }
  if (m.openEdges > 0 || m.nonManifoldEdges > 0) {
    warnings.push({ level: 'warn',
      text: `Mesh is not watertight (${m.openEdges} open, ${m.nonManifoldEdges} non-manifold edges) — Safe Remesh suggested.` });
  }
  if (m.tris > HEAVY_FACES) {
    warnings.push({ level: 'info',
      text: `${m.tris.toLocaleString()} triangles — above the ${HEAVY_FACES.toLocaleString()} heavy-mesh line, the engine will auto-remesh (slower build, smoothed detail).` });
  }
  if (minE < 2) {
    warnings.push({ level: 'info',
      text: `Thinnest extent is ${f1(minE)} mm — very small features may not survive molding or printing.` });
  }
  if (maxE > 300) {
    warnings.push({ level: 'info',
      text: `Largest extent is ${f1(maxE)} mm — a large mold; expect long generation, print and pour times.` });
  }

  return { patch, reasons, warnings };
}
