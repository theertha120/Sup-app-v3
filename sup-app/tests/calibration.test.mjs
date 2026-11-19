// 5-step calibration in IMUContext: neutral capture, orientation detection
// (kit worn either way round), low-confidence leans, persistence, reset, and
// that classification afterwards uses the captured zero point and signs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeAsyncStorage, flush, imuPacket } from './helpers/harness.mjs';
import { setupImu } from './helpers/imuProvider.mjs';

const SEC = 1000;
const BASELINE_KEY = 'sup_clinical_baseline_v2';
const NEUTRAL_KEY = 'sup_neutral_offset_v1';
// Raw angles while sitting upright: the kit's own mounting offsets.
const NEUTRAL = { top: { roll: 5, pitch: 2 }, bottom: { roll: -3, pitch: 1 } };

const pose = ({ topRoll = 0, topPitch = 0 } = {}) => ({
  top: { roll: NEUTRAL.top.roll + topRoll, pitch: NEUTRAL.top.pitch + topPitch },
  bottom: NEUTRAL.bottom,
});

function hold(s, p, ms) {
  for (let t = 0; t < ms; t += 100) {
    s.onData('top', imuPacket(p.top));
    s.onData('bottom', imuPacket(p.bottom));
    s.clock.advance(100);
  }
  s.rerender();
}

/** Runs one calibration step while the user holds pose `p` (null = no packets). */
function step(s, n, p) {
  s.ctx().startCalibrationStep(n);
  s.rerender();
  if (p) hold(s, p, 3200); else { s.clock.advance(3200); s.rerender(); }
  s.clock.advance(1600);
  s.rerender();
}

async function calibrated({ forward = -20, back = 10, right = 12, left = -9 } = {}) {
  const s = setupImu();
  s.connected('top'); s.connected('bottom');
  await flush();
  step(s, 1, pose());
  // Default mounting: leaning forward makes (top − bottom) roll negative.
  step(s, 2, pose({ topRoll: forward }));
  step(s, 3, pose({ topRoll: back }));
  step(s, 4, pose({ topPitch: right }));
  step(s, 5, pose({ topPitch: left }));
  await flush();
  return s;
}

test('five steps produce a saved baseline with neutral offsets, ranges and default orientation', async () => {
  const s = await calibrated();
  const cal = s.ctx().calibration;
  assert.deepEqual(cal.stepComplete, [true, true, true, true, true]);
  assert.equal(cal.isComplete, true);
  assert.equal(cal.lowConfidenceStep, null);
  const b = s.ctx().clinicalBaseline;
  const near = (a, e) => assert.ok(Math.abs(a - e) < 0.05, `${a} ≉ ${e}`);
  near(b.neutral.topRoll, 5); near(b.neutral.topPitch, 2); near(b.neutral.bottomRoll, -3); near(b.neutral.bottomPitch, 1);
  near(b.maxForwardDeg, 20); near(b.maxBackwardDeg, 10); near(b.maxRightDeg, 12); near(b.maxLeftDeg, 9);
  assert.equal(b.sagittalSign, -1);
  assert.equal(b.lateralSign, 1);
  assert.deepEqual(JSON.parse(s.storage.store.get(BASELINE_KEY)).sagittalSign, -1);
  assert.ok(s.storage.store.has(NEUTRAL_KEY), 'step 1 saves the neutral offset on its own');
  assert.equal(s.ctx().isNeutralCalibrated, true);
});

test('after calibrating, the user\'s own upright reads as upright and a 35° lean as slouched', async () => {
  const s = await calibrated();
  hold(s, pose(), 3 * SEC);
  assert.equal(s.ctx().posture.state, 'upright', 'raw mounting offsets are cancelled by the neutral capture');
  hold(s, pose({ topRoll: -35 }), 3 * SEC);
  assert.equal(s.ctx().posture.state, 'slouched');
  hold(s, pose({ topPitch: 12 }), 3 * SEC);
  assert.equal(s.ctx().posture.state, 'tilted_right');
});

test('a kit worn the other way round is detected and classified correctly', async () => {
  const s = await calibrated({ forward: 20, right: -12, left: 9 });
  const b = s.ctx().clinicalBaseline;
  assert.equal(b.sagittalSign, 1);
  assert.equal(b.lateralSign, -1);
  hold(s, pose({ topRoll: 35 }), 3 * SEC);
  assert.equal(s.ctx().posture.state, 'slouched', 'forward on this kit is +roll');
  hold(s, pose({ topRoll: -35 }), 3 * SEC);
  assert.equal(s.ctx().posture.state, 'upright', 'and the opposite direction is a (benign) backward lean');
  hold(s, pose({ topPitch: -12 }), 3 * SEC);
  assert.equal(s.ctx().posture.state, 'tilted_right');
});

test('a lean under 5° is flagged low-confidence and keeps the default orientation', async () => {
  const s = setupImu();
  s.connected('top'); s.connected('bottom');
  step(s, 1, pose());
  s.ctx().startCalibrationStep(2);
  hold(s, pose({ topRoll: 3 }), 3200);  // barely moved — and in the "reversed" direction
  assert.equal(s.ctx().calibration.lowConfidenceStep, 2, 'calibration screen is told to ask for a redo');
  s.clock.advance(1600); s.rerender();
  // Redoing the step clears the warning before the new capture.
  s.ctx().startCalibrationStep(2);
  s.rerender();
  assert.equal(s.ctx().calibration.lowConfidenceStep, null);
  hold(s, pose({ topRoll: 2 }), 3200);
  s.clock.advance(1600);
  step(s, 3, pose({ topRoll: 10 }));
  step(s, 4, pose({ topPitch: 12 }));
  step(s, 5, pose({ topPitch: -9 }));
  const b = s.ctx().clinicalBaseline;
  assert.equal(b.sagittalSign, -1, 'an unclear lean never flips the orientation');
  assert.equal(b.maxForwardDeg, 10, 'forward range has a 10° floor');
});

test('a step with no s\'pot data is abandoned, not marked complete', async () => {
  const s = setupImu();
  step(s, 1, null);
  assert.deepEqual(s.ctx().calibration.stepComplete, [false, false, false, false, false]);
  assert.equal(s.ctx().calibration.currentStep, null);
  assert.equal(s.ctx().isNeutralCalibrated, false);
  assert.equal(s.storage.store.has(NEUTRAL_KEY), false);
});

test('a saved calibration is loaded on startup and used straight away', async () => {
  const baseline = {
    neutral: { topRoll: 5, topPitch: 2, bottomRoll: -3, bottomPitch: 1 },
    maxForwardDeg: 20, maxBackwardDeg: 10, maxRightDeg: 12, maxLeftDeg: 9, capturedAt: '2026-11-01T00:00:00Z',
    sagittalSign: 1, lateralSign: 1,
  };
  const s = setupImu({ storage: fakeAsyncStorage({ [BASELINE_KEY]: JSON.stringify(baseline) }) });
  await flush();
  s.rerender();
  assert.equal(s.ctx().isNeutralCalibrated, true);
  assert.equal(s.ctx().calibration.isComplete, true);
  s.connected('top'); s.connected('bottom');
  hold(s, pose({ topRoll: 35 }), 3 * SEC);
  assert.equal(s.ctx().posture.state, 'slouched', 'the saved (reversed) orientation is applied');
});

test('resetting calibration clears it from state and storage', async () => {
  const s = await calibrated();
  s.ctx().resetCalibration();
  await flush();
  s.rerender();
  assert.equal(s.ctx().clinicalBaseline, null);
  assert.equal(s.ctx().isNeutralCalibrated, false);
  assert.deepEqual(s.ctx().calibration.stepComplete, [false, false, false, false, false]);
  assert.equal(s.storage.store.has(BASELINE_KEY), false);
  assert.equal(s.storage.store.has(NEUTRAL_KEY), false);
});

test('answering the s\'train pop-up: "moved" halves s\'train, "not now" costs 5 SHS', async () => {
  const s = setupImu();
  await flush(); // packets are ignored until saved calibration / session state has loaded
  s.connected('top'); s.connected('bottom');
  s.stream(210 * SEC, 60);                // severe until the intervention fires
  assert.equal(s.ctx().activeIntervention?.state, 'severe');
  const cpl = s.ctx().cpl;
  s.ctx().dismissIntervention(true);
  s.rerender();
  assert.equal(s.ctx().activeIntervention, null);
  assert.ok(Math.abs(s.ctx().cpl - cpl / 2) <= 1, `cpl ${cpl} → ${s.ctx().cpl}`);
  const shs = s.ctx().shs;
  s.ctx().dismissIntervention(false);
  s.rerender();
  assert.ok(Math.abs(s.ctx().shs - (shs - 5)) <= 1, `shs ${shs} → ${s.ctx().shs}`);
});
