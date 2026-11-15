// s'up s'core, posture bands and SHS/CPL constants, checked against the
// worked examples in docs/score-methodology.md (also the App Store review doc —
// if one of these fails, update the doc and the code together, deliberately).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifySpinePosture, parseIMUPacket, SHS_RATES, SHS_GRACE_PERIODS_MS,
  INTERVENTION_THRESHOLDS_MS, POSTURE_LABELS, DEFAULT_SAGITTAL_SIGN, DEFAULT_LATERAL_SIGN,
} from '../src/lib/imuParser.ts';
import { fakeSentry, fakeSupabase, imuPacket, loadTs, read } from './helpers/harness.mjs';

const MIN = 60_000;
const STATES = ['upright', 'transition', 'forward_lean', 'slouched', 'severe', 'tilted_left', 'tilted_right'];
const sync = loadTs('src/services/posture/postureSyncService.ts', {
  mocks: { '@/src/lib/supabase': fakeSupabase().module, '@/src/lib/sentry': fakeSentry().module },
});

// ── sup_score (§2) ──────────────────────────────────────────────────────────

test('sup_score matches every worked example in the methodology doc', () => {
  assert.equal(sync.computeSupScore({ upright: 1 * MIN }), 55);
  assert.equal(sync.computeSupScore({ upright: 10 * MIN }), 75);
  assert.equal(sync.computeSupScore({ upright: 60 * MIN }), 93);
  // 75% credit for 60 min: transition is worth exactly 75.
  assert.equal(sync.computeSupScore({ transition: 60 * MIN }), 71);
  assert.equal(sync.computeSupScore({ severe: 1 * MIN }), 45);
});

test('sup_score uses the per-state credit table (100/75/50/50/50/25/0)', () => {
  // With a huge tracked time the 10-min prior is negligible, so score ≈ credit.
  const big = 1_000_000 * MIN;
  const expected = { upright: 100, transition: 75, forward_lean: 50, tilted_left: 50, tilted_right: 50, slouched: 25, severe: 0 };
  for (const [state, credit] of Object.entries(expected)) {
    assert.equal(sync.computeSupScore({ [state]: big }), credit, state);
  }
});

test('sup_score is null with no tracked time and always strictly inside 0–100', () => {
  assert.equal(sync.computeSupScore({}), null);
  assert.equal(sync.computeSupScore({ upright: 0, slouched: 0 }), null);
  for (const ms of [1, MIN, 600 * MIN]) {
    for (const state of STATES) {
      const s = sync.computeSupScore({ [state]: ms });
      assert.ok(s >= 0 && s <= 100, `${state} ${ms}ms → ${s}`);
    }
  }
});

test('period score sums state time across days, applying the prior once (not a mean of daily scores)', () => {
  const rows = [{ stateTotals: { upright: 10 * MIN } }, { stateTotals: { upright: 10 * MIN } }];
  // (100×20 + 50×10) / 30 = 83.33; a mean of the two daily 75s would be 75.
  assert.equal(Math.round(sync.supScoreForRows(rows)), 83);
  assert.equal(Math.round(sync.supScoreForRows([...rows, { stateTotals: null }])), 83, 'rows without totals are skipped');
  assert.equal(sync.supScoreForRows([]), null);
  assert.equal(sync.supScoreForRows([{ stateTotals: null }]), null);
});

// ── Classification bands (§3c) ──────────────────────────────────────────────

const imu = (roll = 0, pitch = 0) => ({ accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 }, angle: { roll, pitch, yaw: 0 } });
// Default mounting: forward flexion = negative top roll relative to bottom.
const classify = (forward, lateral = 0, baseline = null) =>
  classifySpinePosture(imu(-forward, lateral), imu(), baseline);

test('forward bands use fixed thresholds: 12 / 18 / 28 / 42 degrees', () => {
  for (const [deg, state] of [
    [0, 'upright'], [12, 'upright'], [12.1, 'transition'], [18, 'transition'],
    [18.1, 'forward_lean'], [28, 'forward_lean'], [28.1, 'slouched'], [42, 'slouched'], [42.1, 'severe'], [90, 'severe'],
  ]) assert.equal(classify(deg).state, state, `${deg}°`);
});

test('any backward lean is upright, however large', () => {
  for (const deg of [-1, -15, -16, -60]) assert.equal(classify(deg).state, 'upright', `${deg}°`);
});

test('lateral tilt past 8° wins only when it dominates; moderate severity past 16°', () => {
  assert.equal(classify(0, 8).state, 'upright');
  assert.equal(classify(0, 8.1).state, 'tilted_right');
  assert.equal(classify(0, -8.1).state, 'tilted_left');
  assert.equal(classify(0, 10).severity, 'mild');
  assert.equal(classify(0, 16.1).severity, 'moderate');
  // 10° sideways vs 30° forward: 10 is not > 0.7 × 30, so the forward band wins.
  assert.equal(classify(30, 10).state, 'slouched');
});

test('instant score and severity per state are stable', () => {
  const expected = {
    0: ['upright', 'minimal', 100], 15: ['transition', 'mild', 90], 20: ['forward_lean', 'mild', 80],
    30: ['slouched', 'moderate', 45], 50: ['severe', 'severe', 20],
  };
  for (const [deg, [state, severity, score]] of Object.entries(expected)) {
    const r = classify(Number(deg));
    assert.deepEqual([r.state, r.severity, r.instantScore], [state, severity, score]);
  }
  assert.equal(classify(0, 10).instantScore, 65);
});

test('calibration only changes orientation and zero point, never the thresholds', () => {
  const neutral = { topRoll: 5, topPitch: 3, bottomRoll: -2, bottomPitch: 1 };
  // Raw angles that equal the neutral offset → upright.
  assert.equal(classifySpinePosture(imu(5, 3), imu(-2, 1), neutral).state, 'upright');
  // A kit worn the other way round: flipped sagittal sign turns +roll into forward.
  const flipped = { neutral: { topRoll: 0, topPitch: 0, bottomRoll: 0, bottomPitch: 0 }, sagittalSign: 1, lateralSign: -1,
    maxForwardDeg: 5, maxBackwardDeg: 5, maxRightDeg: 5, maxLeftDeg: 5, capturedAt: '' };
  assert.equal(classifySpinePosture(imu(30, 0), imu(), flipped).state, 'slouched');
  assert.equal(classifySpinePosture(imu(0, 10), imu(), flipped).state, 'tilted_left');
  // A tiny calibrated range must NOT make 13° count as slouched (per-user rescaling was reverted).
  assert.equal(classifySpinePosture(imu(13, 0), imu(), flipped).state, 'transition');
  assert.equal(DEFAULT_SAGITTAL_SIGN, -1);
  assert.equal(DEFAULT_LATERAL_SIGN, 1);
});

// ── SHS / CPL constants (§3d) ───────────────────────────────────────────────

test('SHS rates and grace periods match the methodology table', () => {
  assert.deepEqual(SHS_RATES, {
    upright: 0.033, transition: 0, forward_lean: 0, slouched: -0.033, severe: -0.067, tilted_left: -0.02, tilted_right: -0.02,
  });
  assert.deepEqual(SHS_GRACE_PERIODS_MS, {
    upright: 0, transition: 0, forward_lean: 0, slouched: 3 * MIN, severe: 0, tilted_left: 2 * MIN, tilted_right: 2 * MIN,
  });
  // Recovery is deliberately slower than the loading penalties.
  assert.ok(SHS_RATES.upright < -SHS_RATES.severe);
});

test('CPL weights, recovery and intervention thresholds are unchanged', () => {
  const src = read('src/contexts/IMUContext.tsx');
  const block = (name) => src.match(new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\};`))[1];
  const nums = (body) => Object.fromEntries([...body.matchAll(/(\w+):\s*([\d.]+)/g)].map(([, k, v]) => [k, Number(v)]));
  assert.deepEqual(nums(block('CPL_WEIGHTS')), {
    upright: 0, transition: 0.2, forward_lean: 0.6, slouched: 1, severe: 1.5, tilted_left: 0.7, tilted_right: 0.7,
  });
  assert.deepEqual(nums(block('CPL_THRESHOLDS')), {
    forward_lean: 900, slouched: 1200, severe: 300, tilted_left: 900, tilted_right: 900,
  });
  assert.match(src, /const CPL_RECOVERY_RATE = 0\.15;/);
  assert.deepEqual(INTERVENTION_THRESHOLDS_MS, {
    forward_lean: 15 * MIN, slouched: 20 * MIN, severe: 5 * MIN, tilted_left: 15 * MIN, tilted_right: 15 * MIN,
  });
});

test('every posture state has a UI label', () => {
  assert.deepEqual(Object.keys(POSTURE_LABELS).sort(), [...STATES].sort());
});

// ── BLE packet parsing ──────────────────────────────────────────────────────

test('parses a WT9011DCL packet into g, deg/s and degrees', () => {
  const p = parseIMUPacket(imuPacket({ roll: -30, pitch: 12.5, yaw: 90, ax: 0.5, ay: -1, az: 1, gx: 100, gy: -250, gz: 0 }));
  // Tolerance = one raw step (180/32768 deg, 2000/32768 deg/s).
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.07, `${a} ≉ ${b}`);
  near(p.angle.roll, -30); near(p.angle.pitch, 12.5); near(p.angle.yaw, 90);
  near(p.accel.x, 0.5); near(p.accel.y, -1); near(p.accel.z, 1);
  near(p.gyro.x, 100); near(p.gyro.y, -250); near(p.gyro.z, 0);
});

test('rejects short or wrongly-headed packets instead of throwing', () => {
  assert.equal(parseIMUPacket(new DataView(new ArrayBuffer(19))), null);
  const bad = new Uint8Array(20); bad[0] = 0x54; bad[1] = 0x61;
  assert.equal(parseIMUPacket(new DataView(bad.buffer)), null);
});
