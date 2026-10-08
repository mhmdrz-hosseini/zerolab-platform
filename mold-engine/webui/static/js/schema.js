// MoldForge WebUI parameter schema — an exact mirror of the Blender add-on's
// properties.py (defaults/limits/options) and panel.py (layout + conditional
// visibility). The generic form renderer in app.js builds the UI from this, so
// every Blender parameter is present here.
//
// Units: 1 scene unit = 1 mm (the add-on's convention) — values pass through raw.
// Geometry cap fractions duplicated from moldforge/core/constants.py:
export const CAPS = {
  THROAT_CAP: 0.30, THROAT_CAP_BIG: 0.45,
  MOUTH_CAP: 0.45, MOUTH_CAP_BIG: 1.5, VENT_CAP: 0.16,
};

// Density presets (g/ml) duplicated from moldforge/properties.py
export const SILICONE_PRESETS = {
  DRAGONSKIN: 1.07, MOLDSTAR: 1.18, OOMOO: 1.42,
  ECOFLEX: 1.07, MOLDMAX: 1.42, PLATSIL: 1.12,
};
export const CAST_PRESETS = {
  URETHANE: 1.05, EPOXY: 1.15, POLYESTER: 1.10,
  PLASTER: 1.80, WAX: 0.90, CONCRETE: 2.40,
};

// field(type, def, opts) shorthand keeps the definitions readable
const f = (type, def, o = {}) => ({ type, def, ...o });

export const FIELDS = {
  // --- Mold type ---------------------------------------------------------
  box_style: f('enum', 'POUR_BOX', { label: 'Mold Type', options: [
    ['POUR_BOX', 'Silicone Pour Box'],
    ['SOLID', 'Direct Printed Mold'],
    ['TRAY', 'Tray / Open Pour'],
  ], help: 'What MoldForge outputs — the two genuinely different functions' }),
  solid_shape: f('enum', 'HUG', { label: 'Shape', segmented: true, options: [
    ['HUG', 'Hugging'], ['BLOCK', 'Block'],
  ], help: "Outer shape of a direct printed mold (hugging = least material, block = easiest to clamp)" }),
  skin_keys: f('bool', false, { label: 'Glove Skin Keys', help: 'Glove / mother-mold workflow: registration bumps on the silicone skin seat into pockets in the rigid shell (set the silicone gap to the skin thickness, e.g. 3 mm)' }),

  // --- Tray / open pour --------------------------------------------------
  tray_mode: f('enum', 'EMBED', { label: 'Tray Mode', options: [
    ['EMBED', 'Embed → silicone stamp'],
    ['FRAME', 'Frame only (real object)'],
  ], help: 'What the printed tray does with your object' }),
  tray_up: f('enum', 'AUTO', { label: 'Capture Face', options: [
    ['AUTO', 'Auto'], ['Z', '+Z up'], ['X', '+X up'], ['Y', '+Y up'],
  ], help: "Which way the object's detailed face points — the open pour side" }),
  tray_outline: f('enum', 'RECT', { label: 'Outline', options: [
    ['RECT', 'Rectangular'], ['HUG', 'Hug (rounded)'],
  ], help: "Shape of the tray around the object's footprint" }),
  tray_wall: f('float', 2.5, { label: 'Pan Wall', min: 0.4, soft: 8, mm: 1, help: 'Thickness of the printed tray walls' }),
  tray_floor: f('float', 3.0, { label: 'Pan Floor', min: 0.4, soft: 15, mm: 1, help: 'Thickness of the printed tray floor' }),
  tray_margin: f('float', 6.0, { label: 'Border', min: 0, soft: 30, mm: 1, help: 'Gap between the object and the tray wall — the silicone border around your object' }),
  tray_depth: f('float', 5.0, { label: 'Pour Depth', min: 0, soft: 40, mm: 1, help: "How much silicone stands above the object's high point (the slab thickness)" }),

  // --- Sizes -------------------------------------------------------------
  wall_thickness: f('float', 3.0, { label: 'Silicone / Wall Thickness', min: 0.1, mm: 1, help: 'Silicone thickness (pour gap / glove skin, or the direct mold wall)' }),
  shell_wall: f('float', 2.0, { label: 'Printed Shell Wall', min: 0.4, mm: 1, help: 'Thickness of the printed pour-jacket wall' }),
  sprue_radius: f('float', 4.0, { label: 'Throat Radius', min: 0.3, soft: 15, mm: 1, help: "Radius of the funnel's narrow bottom — the hole where it enters the mold. Typing more than the mold can take snaps to the maximum that fits" }),
  big_throat: f('bool', false, { label: 'Oversized Throat', help: 'Let the throat grow past the auto-fit cap (≈30% → ≈45% of the mold half-width). Leaves less shell around the hole' }),
  funnel_height: f('float', 12.0, { label: 'Funnel Height', min: 1, soft: 60, mm: 1, help: 'How far the pour funnel stands proud of the mold top' }),

  // --- Base --------------------------------------------------------------
  base_style: f('enum', 'FLAT', { label: 'Bottom', options: [
    ['FLAT', 'Flat (closed)'],
    ['OPEN', 'Open Bottom'],
    ['FOLLOW', 'Follow Model'],
  ], help: 'How the bottom of the mold is finished' }),
  base_flange: f('bool', true, { label: 'Mounting Flange', help: 'Add an outward bolted skirt around the flat base — clamps the mold down to a board' }),
  base_plate: f('bool', false, { label: 'Detachable Key Plate', help: "Close the open bottom with a separate printed plate: the model registers into a pocket, and a ring tongue on the shell's rim drops into a groove around the plate's chin collar" }),
  fit_clearance: f('float', 0.3, { label: 'Fit Clearance', min: 0, soft: 1, mm: 1, step: 0.05, help: 'Gap PER FACE between mating printed parts. Increase if your prints come out too tight to assemble' }),
  flange_width: f('float', 6.0, { label: 'Flange Width', mm: 1, soft: 30, help: 'How far the base flange extends past the mold' }),

  // --- Clamp wings ---------------------------------------------------------
  wings: f('bool', true, { label: 'Clamp Wings', help: 'Add full-height clamp flanges along the parting seam(s), with bolt holes, to clamp the pieces together' }),
  wing_width: f('float', 8.0, { label: 'Wing Width', mm: 1, soft: 40, help: 'How far the clamp flanges spread out past the sides' }),
  bolt_diameter: f('float', 3.0, { label: 'Bolt Diameter', min: 0.5, mm: 1, soft: 12, help: 'Diameter of the clamp/flange bolt holes' }),
  bolt_auto: f('bool', true, { label: 'Auto Bolts', help: 'Place the clamp bolt holes automatically by flange height; untick to set an exact count per side/seam instead' }),
  bolt_count: f('int', 0, { label: 'Bolts / Side', min: 0, max: 10, help: 'Exact bolt holes per clamp wing / seam when Auto Bolts is off — 0 means no bolt holes at all' }),

  // --- Split / keys --------------------------------------------------------
  split_axis: f('enum', 'AUTO', { label: 'Split Axis', segmented: true, options: [
    ['AUTO', 'Auto'], ['X', 'X'], ['Y', 'Y'],
  ], help: 'Direction the two halves separate (Auto picks the axis the model releases best along)' }),
  split_offset: f('float', 0.0, { label: 'Parting Offset', mm: 1, step: 0.1, help: 'Slide the parting plane off-centre along the split axis (auto-clamped so neither half vanishes)' }),
  split_horizontal: f('bool', false, { label: 'Horizontal Split', help: 'Also split the shell horizontally — for XL molds: each piece prints shorter, and the horizontal seam gets a bolted flange ring' }),
  split_z_offset: f('float', 0.0, { label: 'Seam Height', mm: 1, step: 0.1, help: 'Slide the horizontal seam up/down from mid-height (auto-clamped so neither stack vanishes)' }),
  contoured: f('bool', true, { label: 'Contoured Parting', help: "Parting surface follows the model's mid-profile (self-registering) instead of a flat plane" }),
  key_count: f('int', 2, { label: 'Alignment Keys', min: 0, max: 4, help: 'Registration features on the parting face (used with a flat parting + no wings)' }),
  parts_count: f('int', 2, { label: 'Mold Pieces', min: 2, max: 4, help: '2 is a normal two-part split; 3-4 splits it into radial wedges around the vertical axis so a model with undercuts on every side can still release' }),
  registration: f('enum', 'KEYS', { label: 'Registration', options: [
    ['KEYS', 'Cone Keys'], ['TEETH', 'Interlocking Teeth'],
  ], help: 'What the alignment features look like (flat parting)' }),

  // --- Sprue / vents -------------------------------------------------------
  sprue: f('bool', true, { label: 'Sprue (pour funnel)', help: 'Cut a funnel from the top into the cavity for pouring' }),
  sprue_flare: f('float', 2.4, { label: 'Funnel Flare', min: 1.0, max: 4.0, step: 0.1, help: 'Mouth width as a multiple of the sprue radius — 1.0 is a straight tube, bigger is a wider catch funnel (auto-capped to the mold)' }),
  big_mouth: f('bool', false, { label: 'Oversized Mouth', help: 'Let the mouth flare grow past the auto-fit cap (≈45% of the mold half-width). It may then overhang the mold edge' }),
  sprue_count: f('int', 1, { label: 'Pour Points', min: 1, max: 4, help: 'Number of pour funnels (more helps fill tall figures)' }),
  sprue_place: f('enum', 'TOP', { label: 'Sprue Placement', options: [
    ['XY', 'Center XY'], ['X', 'Center X'], ['Y', 'Center Y'],
    ['TOP', 'Highest Point'], ['MANUAL', 'Manual X/Y'],
  ], help: "Where the pour funnel sits on the model" }),
  sprue_x: f('float', 0.0, { label: 'X', mm: 1, step: 0.5, help: "Manual funnel X offset from the model's footprint centre" }),
  sprue_y: f('float', 0.0, { label: 'Y', mm: 1, step: 0.5, help: "Manual funnel Y offset from the model's footprint centre" }),
  vent_count: f('int', 0, { label: 'Air Vents', min: 0, max: 8, help: "Thin channels from the cavity's high points to the outside" }),
  vent_radius: f('float', 1.0, { label: 'Vent Radius', min: 0.2, soft: 4, mm: 1, step: 0.1, help: 'Radius of each air vent channel; typing more than the mold can take snaps back to the maximum that fits' }),

  // --- Mesh prep -----------------------------------------------------------
  heal: f('bool', true, { label: 'Heal Mesh', help: 'Merge doubles, drop loose geometry and recalculate normals first' }),
  decimate: f('bool', false, { label: 'Decimate', help: 'Reduce the triangle count before building' }),
  decimate_ratio: f('float', 0.5, { label: 'Ratio', min: 0.1, max: 1.0, step: 0.05, help: 'Decimate ratio (fraction of triangles kept)' }),
  voxel_safe: f('bool', false, { label: 'Safe Remesh', help: 'Voxel-remesh the whole model first — for messy or non-manifold meshes' }),
  voxel_size: f('float', 1.0, { label: 'Remesh Voxel', min: 0.05, mm: 1, step: 0.05, soft: 5, help: 'Voxel size for Safe Remesh (smaller = finer, slower)' }),

  // --- Materials -----------------------------------------------------------
  silicone_preset: f('enum', 'CUSTOM', { label: 'Mold', options: [
    ['CUSTOM', 'Custom'], ['DRAGONSKIN', 'Dragon Skin'], ['MOLDSTAR', 'Mold Star'],
    ['OOMOO', 'Oomoo'], ['ECOFLEX', 'Ecoflex'], ['MOLDMAX', 'Mold Max'],
    ['PLATSIL', 'Platinum RTV'],
  ], help: 'Pick a common mold material to fill in its density, or Custom' }),
  cast_preset: f('enum', 'CUSTOM', { label: 'Cast', options: [
    ['CUSTOM', 'Custom'], ['URETHANE', 'Urethane Resin'], ['EPOXY', 'Epoxy Resin'],
    ['POLYESTER', 'Polyester Resin'], ['PLASTER', 'Plaster'],
    ['WAX', 'Wax'], ['CONCRETE', 'Concrete'],
  ], help: 'Pick a common casting material to fill in its density, or Custom' }),
  silicone_density: f('float', 1.15, { label: 'Mold', min: 0.1, max: 5.0, step: 0.01, help: 'Density of the pour silicone / solid-mold material, g/ml (RTV silicone ≈ 1.1–1.2)' }),
  cast_density: f('float', 1.10, { label: 'Cast', min: 0.1, max: 5.0, step: 0.01, help: 'Density of what you cast, g/ml (resin ≈ 1.1, plaster ≈ 1.8, wax ≈ 0.9)' }),
  plastic_density: f('float', 1.24, { label: 'Print', min: 0.1, max: 5.0, step: 0.01, help: 'Density of the printed plastic, g/ml (PLA ≈ 1.24, PETG ≈ 1.27)' }),
};

// Layout: sections → entries. An entry is a field key, a row [keys], an info
// line {info: fn(v)}, or a caps truth-row {capsRow: true}. `when: fn(v)` mirrors
// panel.py's draw conditions exactly (v = current values object).
export const SECTIONS = [
  {
    title: 'Mold',
    entries: [
      { f: 'box_style' },
      { when: v => v.box_style === 'TRAY', entries: [
        { f: 'tray_mode' },
        { row: ['tray_up', 'tray_outline'] },
        { row: ['tray_wall', 'tray_floor'] },
        { row: ['tray_margin', 'tray_depth'] },
        { info: v => v.tray_mode === 'FRAME'
          ? 'Drop your real object in, then pour silicone'
          : 'Pour silicone over the embedded object' },
      ]},
      { when: v => v.box_style !== 'TRAY', entries: [
        { when: v => v.box_style === 'SOLID', f: 'solid_shape' },
        { f: 'wall_thickness' },
        { when: v => v.box_style === 'POUR_BOX', f: 'shell_wall' },
        { when: v => v.box_style === 'POUR_BOX', f: 'skin_keys' },
        { f: 'base_style' },
        { when: v => v.base_style === 'FLAT', row: ['base_flange'] },
        { when: v => v.base_style === 'FLAT' && v.base_flange, f: 'flange_width' },
        { when: v => v.base_style === 'OPEN', f: 'base_plate' },
        { when: v => v.base_style === 'OPEN' && v.base_plate, f: 'fit_clearance' },
      ]},
    ],
  },
  {
    title: 'Split & Clamp',
    when: v => v.box_style !== 'TRAY',
    entries: [
      { f: 'parts_count' },
      { row: ['split_horizontal'] },
      { when: v => v.split_horizontal, f: 'split_z_offset' },
      { when: v => v.parts_count >= 3, entries: [
        { info: () => 'Radial wedges — each pulls straight out' },
        { when: v => !(v.box_style === 'SOLID' && v.solid_shape === 'BLOCK'), f: 'wings' },
        { when: v => v.wings && !(v.box_style === 'SOLID' && v.solid_shape === 'BLOCK'), entries: [
          { f: 'wing_width' },
          { f: 'bolt_diameter' },
          { row: ['bolt_auto'] },
          { when: v => !v.bolt_auto, f: 'bolt_count' },
        ]},
        { when: v => !(v.wings && !(v.box_style === 'SOLID' && v.solid_shape === 'BLOCK')), f: 'key_count', label: 'Seam Pins' },
      ]},
      { when: v => v.parts_count < 3, entries: [
        { f: 'split_axis' },
        { f: 'split_offset' },
        { f: 'contoured' },
        { when: v => !v.contoured, f: 'key_count' },
        { when: v => !v.contoured && v.key_count > 0 && !v.wings, f: 'registration' },
        { f: 'wings' },
        { when: v => v.wings, entries: [
          { f: 'wing_width' },
          { f: 'bolt_diameter' },
          { row: ['bolt_auto'] },
          { when: v => !v.bolt_auto, f: 'bolt_count' },
        ]},
      ]},
    ],
  },
  {
    title: 'Sprue & Vents',
    when: v => v.box_style !== 'TRAY',
    entries: [
      { f: 'sprue' },
      { when: v => v.sprue, entries: [
        { row: ['sprue_radius', 'big_throat'] },
        { f: 'funnel_height' },
        { row: ['sprue_flare', 'big_mouth'] },
        { f: 'sprue_count' },
        { f: 'sprue_place' },
        { when: v => v.sprue_place === 'MANUAL', row: ['sprue_x', 'sprue_y'] },
        { capsRow: true },   // "Built: throat Ø… · mouth Ø…" truth row (needs a loaded model)
      ]},
      { row: ['vent_count'] },
      { when: v => v.vent_count > 0, row: [null, 'vent_radius'] },
      { ventWarn: true },
    ],
  },
  {
    title: 'Mesh Prep',
    entries: [
      { f: 'heal' },
      { row: ['decimate'] },
      { when: v => v.decimate, row: [null, 'decimate_ratio'] },
      { row: ['voxel_safe'] },
      { when: v => v.voxel_safe, row: [null, 'voxel_size'] },
    ],
  },
  {
    title: 'Material Density (g/ml)',
    entries: [
      { row: ['silicone_preset', 'cast_preset'] },
      { row: ['silicone_density', 'cast_density'] },
      { row: ['plastic_density'] },
    ],
  },
];

// The funnel/vent caps the loaded model implies — same formula as
// properties.mold_caps() (bbox X/Y + wall offset).
export function moldCaps(bbox, v) {
  if (!bbox) return null;
  const offset = v.wall_thickness + (v.box_style === 'POUR_BOX' ? v.shell_wall : 0.0);
  const halfMin = Math.min(bbox.sizeX, bbox.sizeY) * 0.5 + offset;
  if (halfMin <= 0) return null;
  return {
    sprue_r: CAPS.THROAT_CAP * halfMin,
    mouth_r: CAPS.MOUTH_CAP * halfMin,
    vent_r: CAPS.VENT_CAP * halfMin,
    half_min: halfMin,
  };
}

export function defaults() {
  const d = {};
  for (const [k, spec] of Object.entries(FIELDS)) d[k] = spec.def;
  return d;
}
