// MoldForge WebUI — application wiring: schema-driven parameter form, model
// upload, job submission/polling, results panel.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Viewer } from './viewer.js';
import { Intake } from './intake.js';
import { analyzeModel } from './analyze.js';
import { advise } from './adviser.js';
import {
  FIELDS, SECTIONS, CAPS, SILICONE_PRESETS, CAST_PRESETS,
  moldCaps, defaults,
} from './schema.js';

const $ = sel => document.querySelector(sel);

const state = {
  values: defaults(),
  file: null,             // the original File, sent to the backend verbatim
  tris: 0,
  scale: 1,               // uniform size-step factor, baked by the driver
  appliedScale: null,     // last factor confirmed via Continue (null = new model)
  targetCm: null,         // confirmed longest-side size in cm
  rotation: [0, 0, 0],    // size-step X/Y/Z degrees, baked by the driver
  appliedRotation: null,  // last rotation confirmed via Continue
  jobId: null,
  polling: null,
  parts: [],              // [{name, file, faces, bytes, visible}]
  skin: null,
  metrics: null,          // analyzeModel() of the current upload
  advised: new Set(),     // keys the adviser set and the user hasn't touched
  userEdited: new Set(),  // keys the user changed manually (kept on re-fit)
  lastWarnings: [],       // model-health notes, survive a parameter reset
  advOpen: false,         // smart-defaults banner expansion
};

const viewer = new Viewer($('#viewport'));

// ---------------------------------------------------------------------------
// schema-driven form

const fieldEls = new Map();   // key -> wrapper element
const condEls = [];           // {el, when}
const infoEls = [];           // {el, fn}
const capsEl = { el: null, row: null };
const ventWarnEl = { el: null };

function makeField(key, labelOverride) {
  const spec = FIELDS[key];
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.dataset.key = key;

  if (spec.type === 'bool') {
    const id = `f_${key}`;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.checked = state.values[key];
    const lab = document.createElement('label');
    lab.htmlFor = id;
    lab.append(cb, document.createTextNode(' ' + (labelOverride || spec.label || key)));
    if (spec.help) lab.title = spec.help;
    cb.addEventListener('change', () => {
      state.values[key] = cb.checked;
      onValuesChanged(key);
    });
    wrap.appendChild(lab);
    fieldEls.set(key, wrap);
    wrap._input = cb;
    return wrap;
  }

  const lab = document.createElement('label');
  lab.textContent = labelOverride || spec.label || key;
  if (spec.help) lab.title = spec.help;
  wrap.appendChild(lab);

  let input;
  if (spec.type === 'enum') {
    if (spec.segmented) {
      input = document.createElement('div');
      input.className = 'segmented';
      for (const [v, text] of spec.options) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = text; b.value = v;
        b.addEventListener('click', () => {
          state.values[key] = v;
          input.querySelectorAll('button').forEach(x =>
            x.classList.toggle('on', x.value === v));
          onValuesChanged(key);
        });
        if (v === state.values[key]) b.classList.add('on');
        input.appendChild(b);
      }
    } else {
      input = document.createElement('select');
      for (const [v, text] of spec.options) {
        const o = document.createElement('option');
        o.value = v; o.textContent = text;
        if (v === state.values[key]) o.selected = true;
        input.appendChild(o);
      }
      input.addEventListener('change', () => {
        state.values[key] = input.value;
        onValuesChanged(key);
      });
    }
  } else {  // int / float
    input = document.createElement('input');
    input.type = 'number';
    input.step = spec.step ?? (spec.type === 'int' ? 1 : 0.1);
    if (spec.min !== undefined) input.min = spec.min;
    if (spec.max !== undefined) input.max = spec.max;
    if (spec.soft !== undefined && spec.max === undefined) {
      input.max = spec.soft * 10;   // generous hard ceiling, soft hinted by step area
    }
    input.value = state.values[key];
    input.addEventListener('change', () => {
      let n = spec.type === 'int' ? parseInt(input.value, 10)
                                   : parseFloat(input.value);
      if (!isFinite(n)) { input.value = state.values[key]; return; }
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      state.values[key] = n;
      input.value = n;
      onValuesChanged(key);
    });
  }
  if (spec.mm) input.title = (spec.help || '') + ' (mm)';
  wrap.appendChild(input);
  wrap._input = input;
  fieldEls.set(key, wrap);
  return wrap;
}

function makeRow(keys, when) {
  const row = document.createElement('div');
  row.className = 'row';
  for (const k of keys) {
    if (k === null) { row.appendChild(document.createElement('div')); continue; }
    row.appendChild(makeField(k));
  }
  if (when) condEls.push({ el: row, when });
  return row;
}

function renderEntries(entries, parent) {
  for (const e of entries) {
    if (e.f !== undefined && e.entries === undefined) {
      const el = makeField(e.f, e.label);
      if (e.when) condEls.push({ el, when: e.when });
      parent.appendChild(el);
    } else if (e.row) {
      parent.appendChild(makeRow(e.row, e.when));
    } else if (e.info) {
      const el = document.createElement('div');
      el.className = 'infoline';
      parent.appendChild(el);
      infoEls.push({ el, fn: e.info });
    } else if (e.capsRow) {
      const el = document.createElement('div');
      el.className = 'truthrow';
      parent.appendChild(el);
      capsEl.el = el;
    } else if (e.ventWarn) {
      const el = document.createElement('div');
      el.className = 'warnline';
      parent.appendChild(el);
      ventWarnEl.el = el;
    } else if (e.entries) {
      const group = document.createElement('div');
      group.className = 'group';
      renderEntries(e.entries, group);
      parent.appendChild(group);
      if (e.when) condEls.push({ el: group, when: e.when });
    }
  }
}

function buildForm() {
  const root = $('#params');
  for (const section of SECTIONS) {
    const sec = document.createElement('section');
    const isBlockSection = section.title === 'Split & Clamp';
    if (section.when) condEls.push({ el: sec, when: section.when });
    const h = document.createElement('h3');
    h.textContent = section.title;
    sec.appendChild(h);
    renderEntries(section.entries, sec);
    root.appendChild(sec);
  }
  refreshForm();
}

function refreshForm() {
  const v = state.values;
  for (const { el, when } of condEls) el.classList.toggle('hidden', !when(v));
  for (const { el, fn } of infoEls) el.textContent = fn(v);
  refreshCaps();
}

function refreshCaps() {
  const v = state.values;
  const bbox = viewer.modelBBox();
  if (capsEl.el) {
    const caps = moldCaps(bbox, v);
    if (!bbox || !v.sprue) {
      capsEl.el.textContent = v.sprue && !bbox
        ? 'upload a model to preview the built funnel sizes' : '';
      capsEl.el.classList.remove('warn');
      return;
    }
    const hm = caps.half_min;
    const throatCap = hm * (v.big_throat ? CAPS.THROAT_CAP_BIG : CAPS.THROAT_CAP);
    const mouthCap = hm * (v.big_mouth ? CAPS.MOUTH_CAP_BIG : CAPS.MOUTH_CAP);
    const neck = Math.min(v.sprue_radius, throatCap);
    const mouth = Math.max(Math.min(neck * v.sprue_flare, mouthCap), neck);
    const throatOver = v.big_throat && neck > hm * CAPS.THROAT_CAP + 1e-6;
    const mouthOver = v.big_mouth && mouth > hm * CAPS.MOUTH_CAP + 1e-6;
    const throatFit = !v.big_throat && v.sprue_radius > hm * CAPS.THROAT_CAP + 1e-6;
    const mouthFit = !v.big_mouth && neck * v.sprue_flare > hm * CAPS.MOUTH_CAP + 1e-6;
    let text = `Built: throat Ø${(2 * neck).toFixed(1)} · mouth Ø${(2 * mouth).toFixed(1)}`;
    if (throatOver || mouthOver) text += ' — oversized funnel, may overhang / thin the shell';
    else if (throatFit || mouthFit) text += ' — auto-fitted to this mold’s size';
    capsEl.el.textContent = text;
    capsEl.el.classList.toggle('warn',
      throatOver || mouthOver || throatFit || mouthFit);
  }
  if (ventWarnEl.el) {
    const caps = moldCaps(bbox, v);
    if (caps && v.vent_count > 0 && v.vent_radius > caps.vent_r + 1e-6) {
      ventWarnEl.el.textContent =
        `vents auto-fitted to Ø${(2 * caps.vent_r).toFixed(1)}`;
    } else {
      ventWarnEl.el.textContent = '';
    }
  }
}

function onValuesChanged(key) {
  // manual edit: this field is no longer "auto" and survives a re-fit
  state.userEdited.add(key);
  state.advised.delete(key);
  markAdvised();
  // preset -> density fill (parity with the add-on's update callbacks)
  if (key === 'silicone_preset') {
    const d = SILICONE_PRESETS[state.values.silicone_preset];
    if (d !== undefined) {
      state.values.silicone_density = d;
      fieldEls.get('silicone_density')._input.value = d;
    }
  }
  if (key === 'cast_preset') {
    const d = CAST_PRESETS[state.values.cast_preset];
    if (d !== undefined) {
      state.values.cast_density = d;
      fieldEls.get('cast_density')._input.value = d;
    }
  }
  if (key === 'silicone_density' || key === 'cast_density') {
    // typing a custom number flips the dropdown back to Custom (add-on parity)
    const presetKey = key === 'silicone_density' ? 'silicone_preset' : 'cast_preset';
    const table = key === 'silicone_density' ? SILICONE_PRESETS : CAST_PRESETS;
    const match = Object.entries(table).find(([, d]) =>
      Math.abs(d - state.values[key]) < 1e-9);
    const want = match ? match[0] : 'CUSTOM';
    if (state.values[presetKey] !== want) {
      state.values[presetKey] = want;
      fieldEls.get(presetKey)._input.value = want;
    }
  }
  refreshForm();
}

// ---------------------------------------------------------------------------
// smart adviser — shape analysis → smart defaults, banner + "auto" markers

function resetFormValues() {
  state.values = defaults();
  state.userEdited.clear();
  state.advised.clear();
  syncAllInputs();
  refreshForm();
}

function syncAllInputs() {
  for (const [key, wrap] of fieldEls) {
    const spec = FIELDS[key];
    const input = wrap._input;
    if (!input) continue;
    if (spec.type === 'bool') input.checked = state.values[key];
    else if (spec.type === 'enum' && spec.segmented)
      input.querySelectorAll('button').forEach(b =>
        b.classList.toggle('on', b.value === state.values[key]));
    else input.value = state.values[key];
  }
}

function markAdvised() {
  for (const [key, wrap] of fieldEls)
    wrap.classList.toggle('advised',
      state.advised.has(key) && !state.userEdited.has(key));
}

// Analyze the rendered model and apply smart defaults. keepType re-fits the
// dimensional parameters to the user's current settings (e.g. after they
// switched mold type manually), preserving manually edited fields.
function runAdviser({ keepType = false } = {}) {
  const m = state.metrics = analyzeModel(viewer.master);
  const res = advise(m, state.values, { keepType });
  const patch = {};
  for (const [k, v] of Object.entries(res.patch)) {
    if (keepType && state.userEdited.has(k)) continue;
    patch[k] = v;
  }
  Object.assign(state.values, patch);
  // "auto" markers track the shape's recommendations, not just this run's
  // changes, so a re-fit that changes nothing keeps them lit
  state.advised = new Set(res.reasons.map(r => r.key)
    .filter(k => !state.userEdited.has(k)));
  state.lastWarnings = res.warnings;
  syncAllInputs();
  refreshForm();
  markAdvised();
  renderAdvisor(res.reasons, res.warnings);
}

function renderAdvisor(reasons, warnings) {
  const el = $('#advisor');
  const n = reasons.length;
  if (!n && !warnings.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const hasError = warnings.some(w => w.level === 'error');
  if (hasError) state.advOpen = true;   // errors never hide behind a toggle
  el.classList.remove('hidden');
  el.classList.toggle('alert', hasError);
  el.innerHTML = `
    <div class="advHead">
      <span class="advTitle">✦ Smart defaults${n ? ` — ${n} adjustment${n > 1 ? 's' : ''} for this shape` : ''}</span>
      <span class="advBtns">
        ${n ? `<button class="advbtn" id="advToggle">${state.advOpen ? 'hide' : 'details'}</button>` : ''}
        <button class="advbtn" id="advReapply" title="Re-fit the parameters to your current settings">re-fit</button>
        <button class="advbtn" id="advReset" title="Restore factory defaults">reset</button>
      </span>
    </div>
    <div id="advBody" class="${state.advOpen ? '' : 'hidden'}">
      ${reasons.map(r => `<div class="advreason"><b>${(FIELDS[r.key] && FIELDS[r.key].label) || r.key}</b> — ${r.text}</div>`).join('')}
      ${warnings.map(w => `<div class="advwarn ${w.level}">${w.level === 'error' ? '⛔' : w.level === 'warn' ? '⚠' : 'ℹ'} ${w.text}</div>`).join('')}
    </div>`;
  const tog = $('#advToggle');
  if (tog) tog.addEventListener('click', () => {
    state.advOpen = !state.advOpen;
    tog.textContent = state.advOpen ? 'hide' : 'details';
    $('#advBody').classList.toggle('hidden', !state.advOpen);
  });
  $('#advReapply').addEventListener('click', () => runAdviser({ keepType: true }));
  $('#advReset').addEventListener('click', () => {
    resetFormValues();
    markAdvised();
    renderAdvisor([], state.lastWarnings);
  });
}

// ---------------------------------------------------------------------------
// model upload + local preview

function countTris(object3d) {
  let n = 0;
  object3d.traverse(o => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      n += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
    }
  });
  return Math.round(n);
}

async function loadPreview(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  if (ext === 'stl') {
    const geom = new STLLoader().parse(buf);
    return { obj: new THREE.Mesh(geom, new THREE.MeshStandardMaterial()),
             zUpFile: true };
  }
  if (ext === 'obj') {
    return { obj: new OBJLoader().parse(new TextDecoder().decode(buf)),
             zUpFile: true };
  }
  if (ext === 'ply') {
    const geom = new PLYLoader().parse(buf);
    return { obj: new THREE.Mesh(geom, new THREE.MeshStandardMaterial()),
             zUpFile: true };
  }
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().parse(buf, '', res, rej));
    return { obj: gltf.scene, zUpFile: false };
  }
  throw new Error('unsupported file');
}

// Error-level model-health notes (separate pieces, …) for the size step.
// The full analysis + parameter advice runs when the user continues, on
// the scaled model.
function modelHealthErrors() {
  try {
    const m = analyzeModel(viewer.master);
    return advise(m, defaults()).warnings
      .filter(w => w.level === 'error').map(w => w.text);
  } catch {
    return [];
  }
}

async function setModel(file) {
  try {
    const { obj, zUpFile } = await loadPreview(file);
    viewer.clearOutputs();
    viewer.setMaster(obj, { zUpFile });
    state.file = file;
    state.tris = countTris(obj);
    state.appliedScale = null;      // nothing confirmed for this model yet
    state.appliedRotation = null;
    state.rotation = [0, 0, 0];
    $('#fileName').textContent = `${file.name} · ${state.tris.toLocaleString()} tris`;
    $('#uploadBtn').classList.remove('empty');
    setGenEnabled();
    Intake.showModel(file.name, state.tris, modelHealthErrors());
  } catch (err) {
    showStatus('error', `Could not load ${file.name}: ${err.message || err}`);
  }
}

// ---------------------------------------------------------------------------
// job submission + polling

function setGenEnabled() {
  $('#generateBtn').disabled =
    !state.file || state.jobId !== null || Intake.isActive();
}

async function generate() {
  if (!state.file || Intake.isActive()) return;
  const fd = new FormData();
  fd.append('file', state.file, state.file.name);
  fd.append('params', JSON.stringify({
    ...state.values,
    model_scale: Math.round((state.scale || 1) * 1e6) / 1e6,
    model_rotation: state.rotation.map(a =>
      Math.round((a || 0) * 1e4) / 1e4),
  }));
  state.jobId = null;
  setGenEnabled();
  showProgress(0, 'submitting…');
  try {
    const r = await fetch('/api/generate', { method: 'POST', body: fd });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    const { job_id } = await r.json();
    state.jobId = job_id;
    pollJob(job_id);
  } catch (err) {
    state.jobId = null;
    setGenEnabled();
    showStatus('error', `Submission failed: ${err.message || err}`);
  }
}

function pollJob(id) {
  if (state.polling) clearInterval(state.polling);
  state.polling = setInterval(async () => {
    let j;
    try {
      const r = await fetch(`/api/job/${id}`);
      if (!r.ok) throw new Error('job vanished');
      j = await r.json();
    } catch (e) {
      clearInterval(state.polling); state.polling = null;
      state.jobId = null; setGenEnabled();
      showStatus('error', 'Lost contact with the build worker.');
      return;
    }
    if (j.status === 'queued' || j.status === 'running') {
      showProgress(j.progress, j.phase);
      return;
    }
    clearInterval(state.polling); state.polling = null;
    state.jobId = null; setGenEnabled();
    if (j.status === 'error') {
      showStatus('error', `Mold generation failed: ${j.error}`);
      return;
    }
    await presentResult(id, j.result);
  }, 800);
}

// ---------------------------------------------------------------------------
// results

function fmtVol(unitsCubed, density) {
  const ml = unitsCubed / 1000.0;      // 1 unit = 1 mm, panel._vol_row parity
  const g = density ? ` · ${Math.round(ml * density).toLocaleString()} g` : '';
  return `${ml.toLocaleString(undefined, { maximumFractionDigits: 1 })} ml${g}`;
}

function volRow(name, unitsCubed, density) {
  const v = state.values;
  return `<div class="volrow"><span>${name}</span><b>${fmtVol(unitsCubed, density)}</b></div>`;
}

async function presentResult(jobId, res) {
  const v = state.values;
  const { volumes: V, notes, summary } = res;

  // summary line — mirrors operators._finalize
  let line;
  if (summary.style === 'TRAY') {
    line = summary.tray_mode === 'FRAME'
      ? `Frame ready. Silicone to pour ≈ ${Math.round(V.silicone_volume).toLocaleString()} mm³ around your object.`
      : `Tray ready. Pour ≈ ${Math.round(V.silicone_volume).toLocaleString()} mm³ of silicone over the embedded master.`;
  } else if (summary.style === 'POUR_BOX') {
    line = `Pour box ready. ${summary.skin_keys ? 'Silicone skin' : 'Silicone to pour'} ≈ ${Math.round(V.silicone_volume).toLocaleString()} mm³.`;
  } else {
    line = `Mold ready. Material ≈ ${Math.round(V.silicone_volume).toLocaleString()} mm³.`;
  }
  if (summary.radial) line += ` Split into ${summary.parts_count} radial wedges.`;

  // warnings & notes
  const warns = [...(res.warnings || [])];
  if (notes.remeshed) warns.push('model was auto-remeshed (non-manifold or very heavy, so fine surface detail is smoothed)');
  if (notes.trimmed) warns.push('a small severed fragment was trimmed to keep each half one solid');
  if (notes.undercut > 0.04) warns.push(`~${Math.round(notes.undercut * 100)}% of the model is undercut on the ${notes.axis} axis and may not release cleanly (try another Split Axis)`);

  // volume rows — mirrors panel.py draw logic
  let rows = '';
  if (summary.style === 'TRAY') {
    rows += volRow('Silicone to pour', V.silicone_volume, v.silicone_density);
    rows += volRow('Pan plastic', V.plastic_volume, v.plastic_density);
    if (summary.tray_mode !== 'FRAME') rows += volRow('Cast material', V.cavity_volume, v.cast_density);
  } else if (summary.style === 'POUR_BOX') {
    rows += volRow(summary.skin_keys ? 'Silicone skin' : 'Silicone to pour', V.silicone_volume, v.silicone_density);
    rows += volRow('Box plastic', V.plastic_volume, v.plastic_density);
    rows += volRow('Cast material', V.cavity_volume, v.cast_density);
  } else {
    rows += volRow('Mold material', V.silicone_volume, v.silicone_density);
    rows += volRow('Cast material', V.cavity_volume, v.cast_density);
  }

  // load the generated STLs into the viewer. They arrive already in their
  // RECOMMENDED PRINT ORIENTATION with the bottom at Z=0 (the backend bakes
  // the transform in, so downloads are slicer-ready); the assembly pose is
  // reconstructed from the reported rotation + original center.
  const print = res.print || null;
  state.parts = res.parts.map(p => ({ ...p, visible: true }));
  state.skin = res.skin || null;
  const geoms = [];
  for (let i = 0; i < res.parts.length; i++) {
    const p = res.parts[i];
    const buf = await (await fetch(`/api/job/${jobId}/parts/${p.file}`)).arrayBuffer();
    const meta = print
      ? (i < print.parts.length ? print.parts[i] : print.master) || {} : {};
    geoms.push({
      name: p.name,
      geometry: new STLLoader().parse(buf),
      isMaster: p.role === 'master',
      quaternion: meta.q || null,
      assemblyCenter: meta.assembly_center || null,
    });
  }
  viewer.setParts(geoms);
  if (res.skin) {
    const buf = await (await fetch(`/api/job/${jobId}/parts/${res.skin}`)).arrayBuffer();
    viewer.setSkin(new STLLoader().parse(buf));
  }
  viewer.fitView();

  const partRows = state.parts.map((p, i) => {
    const color = p.role === 'master' ? 0xaab2bd
      : (i < 6 ? [0x4f8cff, 0xff6b6b, 0xffd166, 0x06d6a0, 0xb28dff, 0xff9f43][i] : 0x888888);
    const label = p.role === 'master' ? 'Master · your model' : p.name;
    return `
    <div class="partrow" data-i="${i}">
      <label><input type="checkbox" class="partVis" checked>
        <span class="swatch" style="background:#${(0x1000000 + color).toString(16).slice(1)}"></span>
        ${label}</label>
      <span class="meta">${p.faces.toLocaleString()} tris</span>
      <a href="/api/job/${jobId}/parts/${p.file}" download>STL</a>
    </div>`;
  }).join('');
  const skinRow = state.skin ? `
    <div class="partrow skin">
      <label><input type="checkbox" id="skinVis" checked>
        <span class="swatch skin"></span>MF_Skin (silicone preview)</label>
      <span class="meta">translucent · assembly view</span>
      <a href="/api/job/${jobId}/parts/${state.skin}" download>STL</a>
    </div>` : '';

  // per-part print orientation rationale ("if this went to a slicer now…")
  let printBox = '';
  if (print) {
    const entries = [...print.parts, ...(print.master ? [print.master] : [])];
    const hint = print.master
      ? 'Print the Master too — the silicone cures around it.'
      : 'Every part sits on the plate exactly as it should be printed.';
    printBox = `
      <div class="volbox">
        <div class="volhead">Print Plan <span class="mmnote">bed-ready · bottom on Z=0</span></div>
        <div class="printhint">${hint} STLs download in this orientation.</div>
        ${entries.map(e => `<div class="printrow">
          <b>${e.name}</b> <span class="pdims">${e.dims ? `${e.dims[0]}×${e.dims[1]}×${e.dims[2]} mm` : ''}</span><br>
          <span class="pwhy">${e.why || ''}</span>
        </div>`).join('')}
      </div>`;
  }

  $('#results').innerHTML = `
    <div class="resultCard">
      <div class="okline">${line}</div>
      ${warns.length ? `<div class="warns">${warns.map(w => `<div>⚠ ${w}</div>`).join('')}</div>` : ''}
      <div class="volbox">
        <div class="volhead">Estimated Volume / Weight <span class="mmnote">(1 unit = 1 mm)</span></div>
        ${rows}
      </div>
      ${printBox}
      <div class="volbox">
        <div class="volhead">Parts (${res.parts.length}) · ${res.elapsed_s}s
          <a class="zip" href="/api/job/${jobId}/zip" download>Download all (.zip)</a></div>
        ${partRows}${skinRow}
      </div>
    </div>`;

  $('#results').querySelectorAll('.partVis').forEach(cb => {
    cb.addEventListener('change', () => {
      const i = +cb.closest('.partrow').dataset.i;
      state.parts[i].visible = cb.checked;
      viewer.togglePart(i, cb.checked);
    });
  });
  const skinCb = $('#skinVis');
  if (skinCb) skinCb.addEventListener('change', () => viewer.setSkinVisible(skinCb.checked));
  $('#viewerBar').classList.remove('hidden');
  setViewMode(print ? 'print' : 'assembly');
}

// Print-bed ⇄ assembly view (the segmented control in the viewer bar). Print
// bed is the default after a build: parts laid out on the plate, bottom on
// Z=0, in their recommended orientation. Assembly shows the mold system put
// back together around the model, with explode + silicone skin.
function setViewMode(mode) {
  const print = mode === 'print';
  $('#viewMode').querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', (b.dataset.mode === 'print') === print));
  $('#viewMode').classList.toggle('hidden', !viewer.parts.length || !viewer.plate);
  $('#explodeWrap').classList.toggle('hidden', print);
  $('#masterVisWrap').classList.toggle('hidden', print);
  viewer.setPrintMode(print);
  viewer.fitView();
}

// ---------------------------------------------------------------------------
// status widgets

function showProgress(frac, phase) {
  $('#results').innerHTML = `
    <div class="progressCard">
      <div class="ptitle">Generating mold…</div>
      <div class="pbar"><div class="pfill" style="width:${Math.round((frac || 0) * 100)}%"></div></div>
      <div class="pphase">${phase || ''}</div>
    </div>`;
}

function showStatus(kind, msg) {
  $('#results').innerHTML =
    `<div class="${kind === 'error' ? 'errorCard' : 'resultCard'}">${msg}</div>`;
}

// ---------------------------------------------------------------------------
// wiring

$('#uploadBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', e => {
  if (e.target.files[0]) setModel(e.target.files[0]);
});
$('#generateBtn').addEventListener('click', generate);

const vp = $('#viewport');
vp.addEventListener('dragover', e => { e.preventDefault(); vp.classList.add('drag'); });
vp.addEventListener('dragleave', () => vp.classList.remove('drag'));
vp.addEventListener('drop', e => {
  e.preventDefault(); vp.classList.remove('drag');
  if (e.dataTransfer.files[0]) setModel(e.dataTransfer.files[0]);
});

$('#fitBtn').addEventListener('click', () => viewer.fitView());
$('#wireBtn').addEventListener('click', e => {
  const on = e.currentTarget.classList.toggle('on');
  viewer.setWireframe(on);
});
$('#viewMode').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setViewMode(b.dataset.mode);
});
$('#masterVis').addEventListener('change', e => viewer.setMasterVisible(e.target.checked));
$('#explode').addEventListener('input', e => viewer.setExplode(+e.target.value / 100));

// ---------------------------------------------------------------------------
// step 1 (preview & size) + mobile pane tabs

Intake.init(viewer, {
  onPickFile: () => $('#fileInput').click(),
  onDrop: f => setModel(f),
  onStageChange: () => {
    setGenEnabled();
    syncPanes();
  },
  onConfirm: ({ scale, targetCm, rotation }) => {
    const rot = Array.isArray(rotation) && rotation.length === 3
      ? rotation : [0, 0, 0];
    const changed = state.appliedScale === null ||
      Math.abs(scale - state.appliedScale) > 1e-9 ||
      !state.appliedRotation ||
      rot.some((a, i) => Math.abs(a - state.appliedRotation[i]) > 1e-9);
    state.scale = scale;
    state.targetCm = targetCm;
    state.rotation = rot;
    if (!changed) return;             // just peeked — keep edits and results
    // new/confirmed-different size or orientation → fresh-model semantics:
    // drop stale outputs and re-fit the parameters (the adviser reads the
    // world-space shape, so a rotated model gets re-analyzed too)
    state.appliedScale = scale;
    state.appliedRotation = rot;
    state.parts = [];
    state.skin = null;
    viewer.clearOutputs();
    $('#viewerBar').classList.add('hidden');
    $('#sizeChip').textContent = `${targetCm.toFixed(1)} cm`;
    $('#sizeChip').classList.remove('hidden');
    const rotTxt = rot.some(a => Math.abs(a) > 1e-9)
      ? ` Orientation ${rot.map(a => `${+a.toFixed(1)}°`).join(' / ')}.`
      : '';
    showStatus('info', `Model ready at ${targetCm.toFixed(1)} cm longest side.` +
      `${rotTxt} Review the parameters, then Generate Mold.`);
    resetFormValues();
    runAdviser();
    viewer.fitView();
  },
});
$('#sizeChip').addEventListener('click', () => Intake.show());

const stageTabs = $('#stageTabs');
const PANES = ['paramsPane', 'viewportWrap', 'resultsPane'];

stageTabs.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  stageTabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  applyTab();
});

function applyTab() {
  const on = stageTabs.querySelector('button.on')?.dataset.pane || 'paramsPane';
  for (const id of PANES) $('#' + id).classList.toggle('hidden', id !== on);
}

// On narrow screens only one editor pane shows (tab bar above); on wide
// screens all three are visible exactly as before.
function syncPanes() {
  if (Intake.isActive()) {
    $('#viewportWrap').classList.remove('hidden');
    return;
  }
  if (window.matchMedia('(max-width: 900px)').matches) applyTab();
  else for (const id of PANES) $('#' + id).classList.remove('hidden');
}
window.addEventListener('resize', () => { if (!Intake.isActive()) syncPanes(); });

buildForm();
Intake.show();   // start at step 1: upload → preview & size
