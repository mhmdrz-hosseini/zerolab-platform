// Step 1 — "Preview & Size": the stage every upload lands in before the
// molding editor. The shared viewer canvas (#viewportWrap) is moved into
// this stage so the model can be inspected and rotated, next to a size
// control that uniformly scales the model so its longest side lands
// between MIN_CM and MAX_CM (1 scene unit = 1 mm), and an X/Y/Z rotation
// control (degrees) that sets the orientation the engine will build the
// mold in. Rotating re-measures the model, so the size control always
// targets the longest side of the currently oriented model.
//
// Pure math is exported at module level (node-testable); all DOM work is
// wired in init(), so importing this file outside a browser is safe.

export const MIN_CM = 3;
export const MAX_CM = 20;

// Printable-range clamp for a "final size" value in centimetres.
export function clampTargetCm(cm) {
  if (!Number.isFinite(cm)) return MIN_CM;
  return Math.min(MAX_CM, Math.max(MIN_CM, cm));
}

// First suggestion for a model whose longest side is `origCm`: keep the
// original when it already fits, else snap to the nearest limit.
export function defaultTargetCm(origCm) {
  return clampTargetCm(origCm);
}

// Uniform scale factor that makes a model with longest side `origLongestMm`
// measure `targetCm` centimetres (1 scene unit = 1 mm).
export function scaleForTargetCm(targetCm, origLongestMm) {
  if (!Number.isFinite(origLongestMm) || origLongestMm <= 0) return 1;
  return (targetCm * 10) / origLongestMm;
}

// Human-friendly size: "2.1 m" / "12.6 cm" / "8 mm".
export function fmtSizeCm(cm) {
  if (!Number.isFinite(cm)) return '–';
  if (cm >= 100) return `${+(cm / 100).toPrecision(3)} m`;
  if (cm < 1) return `${Math.round(cm * 10)} mm`;
  return `${+cm.toFixed(1)} cm`;
}

// Fold any angle in degrees into (-180, 180] — 270 becomes -90, -270
// becomes 90, 360 becomes 0 — and shave float fuzz from the round trip.
export function normalizeDeg(deg) {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  const r = Math.round(d * 100) / 100;
  return r === 0 ? 0 : r;   // -360 % 360 is -0; callers expect +0
}

let viewer = null;
let cb = {};
let els = null;
let active = false;
let orig = null;        // { x, y, z, longestMm, cm } at scale 1, current rotation
let targetCm = MIN_CM;
let rot = [0, 0, 0];    // degrees around X/Y/Z, as sent to the engine
let raf = 0;

const $ = sel => document.querySelector(sel);

function scaleNow() {
  return orig ? scaleForTargetCm(targetCm, orig.longestMm) : 1;
}

function paintSliderFill() {
  const p = ((targetCm - MIN_CM) / (MAX_CM - MIN_CM)) * 100;
  els.slider.style.background =
    `linear-gradient(90deg, rgba(232,180,74,.9) ${p}%, var(--line2) ${p}%)`;
}

function renderCard() {
  if (!orig) return;
  const s = scaleNow();
  els.dims.innerHTML =
    `<b>${(orig.x * s / 10).toFixed(1)} × ${(orig.y * s / 10).toFixed(1)} × ` +
    `${(orig.z * s / 10).toFixed(1)} cm</b> <span class="dimnote">(L × W × H)</span>`;
  els.factor.textContent = Math.abs(s - 1) < 5e-4
    ? 'original size' : `×${+s.toPrecision(3)}`;
  els.reset.disabled = Math.abs(targetCm - defaultTargetCm(orig.cm)) < 0.05;
}

function applyLive() {
  if (!viewer?.master || !orig) return;
  viewer.master.scale.setScalar(scaleNow());
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => viewer.fitView());
}

function setTarget(cm, source) {
  targetCm = clampTargetCm(+cm);
  const text = targetCm.toFixed(1);
  if (source !== 'slider') els.slider.value = text;
  if (source !== 'num') els.num.value = text;
  paintSliderFill();
  renderCard();
  applyLive();
}

// Re-measure the oriented model at scale 1 (rotating changes the bounding
// box, hence what "longest side" means) and re-apply the size target.
function remeasure() {
  if (!viewer?.master) return;
  const b = viewer.masterBBoxAtScale1();
  if (!b) return;
  const longest = Math.max(b.sizeX, b.sizeY, b.sizeZ);
  if (!Number.isFinite(longest) || longest <= 0) return;
  orig = { x: b.sizeX, y: b.sizeY, z: b.sizeZ, longestMm: longest,
           cm: longest / 10 };
  renderCard();
  applyLive();
}

function setRot(next) {
  rot = next.map(normalizeDeg);
  els.rot.forEach((inp, i) => { inp.value = `${rot[i]}`; });
  if (!viewer?.master) return;
  viewer.setMasterSpin(rot[0], rot[1], rot[2]);
  remeasure();
}

export const Intake = {
  init(viewerRef, callbacks = {}) {
    viewer = viewerRef;
    cb = callbacks;
    els = {
      stage: $('#intake'), hero: $('#intakeHero'),
      card: $('#sizeCard'), name: $('#sizeName'), tris: $('#sizeTris'),
      dims: $('#sizeDims'), hint: $('#sizeHint'), warn: $('#sizeWarn'),
      slider: $('#sizeSlider'), num: $('#sizeNum'),
      orig: $('#sizeOrig'), factor: $('#sizeFactor'),
      reset: $('#sizeReset'), continueBtn: $('#sizeContinue'),
      repick: $('#sizeRepick'),
      rot: [$('#rotX'), $('#rotY'), $('#rotZ')], rotReset: $('#rotReset'),
    };
    els.slider.addEventListener('input', e => setTarget(e.target.value, 'slider'));
    els.num.addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      setTarget(Number.isFinite(v) ? v : targetCm, 'num');
    });
    els.reset.addEventListener('click', () =>
      orig && setTarget(defaultTargetCm(orig.cm)));
    els.rot.forEach((input, axis) => input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      const next = [...rot];
      next[axis] = Number.isFinite(v) ? v : rot[axis];
      setRot(next);
    }));
    els.rotReset.addEventListener('click', () => setRot([0, 0, 0]));
    els.continueBtn.addEventListener('click', () => {
      if (!orig) return;
      Intake.hide();
      cb.onConfirm?.({ scale: scaleNow(), targetCm, rotation: [...rot] });
    });
    els.repick.addEventListener('click', () => cb.onPickFile?.());
    els.hero.addEventListener('click', () => cb.onPickFile?.());
    // the whole stage is a drop zone (the viewport handles its own drops)
    for (const ev of ['dragover', 'dragleave', 'drop']) {
      els.stage.addEventListener(ev, e => {
        if (e.target.closest('#viewport')) return;
        e.preventDefault();
        els.stage.classList.toggle('drag', ev === 'dragover');
        if (ev === 'drop') {
          els.stage.classList.remove('drag');
          const f = e.dataTransfer?.files?.[0];
          if (f) cb.onDrop?.(f);
        }
      });
    }
    paintSliderFill();
  },

  // Enter step 1 (hero when no model is loaded, size card otherwise).
  show() {
    active = true;
    document.body.classList.add('intake-active');
    $('#viewportWrap').classList.remove('hidden');
    $('#intakeViewportSlot').appendChild($('#viewportWrap'));
    cb.onStageChange?.(true);
  },

  // A model was just loaded into the viewer: measure it, pick the default
  // target and open the size card. `errors` are error-level health notes.
  showModel(name, tris, errors = []) {
    const b = viewer.modelBBox();
    const longest = Math.max(b.sizeX, b.sizeY, b.sizeZ);
    els.hero.classList.add('hidden');
    els.card.classList.remove('hidden');
    els.name.textContent = name;
    els.tris.textContent = tris ? `${tris.toLocaleString()} triangles` : '';
    if (!Number.isFinite(longest) || longest <= 0) {
      orig = null;
      els.dims.textContent = '';
      els.hint.textContent = 'Could not measure this model — please try another file.';
      els.continueBtn.disabled = true;
      Intake.show();
      return;
    }
    orig = { x: b.sizeX, y: b.sizeY, z: b.sizeZ, longestMm: longest,
             cm: longest / 10 };
    rot = [0, 0, 0];                    // a fresh upload starts unrotated
    els.rot.forEach(inp => { inp.value = '0'; });
    els.continueBtn.disabled = false;
    els.orig.textContent = `Original: ${fmtSizeCm(orig.cm)}`;
    if (orig.cm > MAX_CM) {
      els.hint.textContent =
        `Your model is ${fmtSizeCm(orig.cm)} on its longest side — resized to ${MAX_CM} cm to fit.`;
    } else if (orig.cm < MIN_CM) {
      els.hint.textContent =
        `Your model is ${fmtSizeCm(orig.cm)} on its longest side — enlarged to ${MIN_CM} cm.`;
    } else {
      els.hint.textContent = '';
    }
    els.warn.innerHTML = errors.slice(0, 2).map(t => `⛔ ${t}`).join('<br>');
    setTarget(defaultTargetCm(orig.cm));
    Intake.show();
  },

  // Back to the editor layout (Continue was pressed).
  hide() {
    active = false;
    document.body.classList.remove('intake-active');
    $('#layout').insertBefore($('#viewportWrap'), $('#resultsPane'));
    cb.onStageChange?.(false);
  },

  isActive: () => active,
  getTargetCm: () => targetCm,
  getScale: () => scaleNow(),
  getRotation: () => [...rot],
};
