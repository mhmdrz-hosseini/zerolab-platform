// Pure-math tests for the intake size step (node webui/static/js/intake.test.mjs).
// intake.js touches no DOM until init(), so it imports cleanly under node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_CM, MAX_CM, clampTargetCm, defaultTargetCm, scaleForTargetCm, fmtSizeCm,
  normalizeDeg,
} from './intake.js';

test('printable range is 3–20 cm', () => {
  assert.equal(MIN_CM, 3);
  assert.equal(MAX_CM, 20);
});

test('clampTargetCm keeps in-range values verbatim', () => {
  assert.equal(clampTargetCm(3), 3);
  assert.equal(clampTargetCm(20), 20);
  assert.equal(clampTargetCm(12.65), 12.65);
});

test('clampTargetCm clamps out-of-range values to the limits', () => {
  assert.equal(clampTargetCm(0.5), MIN_CM);
  assert.equal(clampTargetCm(210), MAX_CM);
  assert.equal(clampTargetCm(-5), MIN_CM);
});

test('clampTargetCm rejects garbage to the floor', () => {
  assert.equal(clampTargetCm(NaN), MIN_CM);
  assert.equal(clampTargetCm(undefined), MIN_CM);
});

test('defaultTargetCm keeps an in-range model at its original size', () => {
  assert.equal(defaultTargetCm(12.6), 12.6);
  assert.equal(defaultTargetCm(3), 3);
  assert.equal(defaultTargetCm(20), 20);
});

test('defaultTargetCm snaps out-of-range models to the nearest limit', () => {
  assert.equal(defaultTargetCm(210), MAX_CM);   // 2.1 m statue → 20 cm
  assert.equal(defaultTargetCm(0.12), MIN_CM);  // 1.2 mm charm → 3 cm
});

test('scaleForTargetCm converts cm target to a mm-space factor', () => {
  // 1 unit = 1 mm: a 120 mm model at 20 cm → 200/120
  assert.ok(Math.abs(scaleForTargetCm(20, 120) - 200 / 120) < 1e-12);
  // 3 cm target on a 2 m (2000 mm) model
  assert.ok(Math.abs(scaleForTargetCm(3, 2000) - 30 / 2000) < 1e-12);
  // identity: 10 cm target on a 100 mm model
  assert.equal(scaleForTargetCm(10, 100), 1);
});

test('scaleForTargetCm guards degenerate originals', () => {
  assert.equal(scaleForTargetCm(10, 0), 1);
  assert.equal(scaleForTargetCm(10, -5), 1);
  assert.equal(scaleForTargetCm(10, NaN), 1);
  assert.equal(scaleForTargetCm(10, Infinity), 1);
});

test('scale round-trips the clamped bounds', () => {
  // A model at every original size scaled to its clamped default always
  // lands inside [3 cm, 20 cm].
  for (const mm of [1, 17.3, 30, 126.7, 199.9, 200, 640, 5_000, 1e6]) {
    const target = defaultTargetCm(mm / 10);
    const s = scaleForTargetCm(target, mm);
    const longestCm = (mm * s) / 10;
    assert.ok(longestCm >= MIN_CM - 1e-9 && longestCm <= MAX_CM + 1e-9,
      `${mm} mm → ${longestCm} cm outside 3–20`);
  }
});

test('fmtSizeCm picks human units', () => {
  assert.equal(fmtSizeCm(12.6), '12.6 cm');
  assert.equal(fmtSizeCm(3), '3 cm');
  assert.equal(fmtSizeCm(210), '2.1 m');
  assert.equal(fmtSizeCm(100), '1 m');
  assert.equal(fmtSizeCm(101), '1.01 m');
  assert.equal(fmtSizeCm(0.8), '8 mm');
  assert.equal(fmtSizeCm(NaN), '–');
});

test('normalizeDeg keeps in-range angles', () => {
  assert.equal(normalizeDeg(0), 0);
  assert.equal(normalizeDeg(90), 90);
  assert.equal(normalizeDeg(-45.5), -45.5);
  assert.equal(normalizeDeg(180), 180);
  assert.equal(normalizeDeg(-180), 180);   // folded into (-180, 180]
});

test('normalizeDeg folds full turns and out-of-range angles', () => {
  assert.equal(normalizeDeg(360), 0);
  assert.equal(normalizeDeg(-360), 0);
  assert.equal(normalizeDeg(270), -90);
  assert.equal(normalizeDeg(-270), 90);
  assert.equal(normalizeDeg(185), -175);
  assert.equal(normalizeDeg(720 + 30), 30);
  assert.equal(normalizeDeg(-1e5), 80);    // -100000 % 360 → -80 → +... folds to 80
});

test('normalizeDeg rejects garbage and shaves float fuzz', () => {
  assert.equal(normalizeDeg(NaN), 0);
  assert.equal(normalizeDeg(undefined), 0);
  assert.equal(normalizeDeg('abc'), 0);
  assert.equal(normalizeDeg(89.999999999), 90);
  assert.equal(normalizeDeg(0.1 + 0.2), 0.3);
});
