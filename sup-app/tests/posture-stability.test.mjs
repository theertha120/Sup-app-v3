import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySpinePosture, createPostureStabilizer } from '../src/lib/imuParser.ts';

const sensor = (roll = 0, pitch = 0) => ({
  accel: { x: 0, y: 0, z: 1 },
  gyro: { x: 0, y: 0, z: 0 },
  angle: { roll, pitch, yaw: 0 },
});
const neutral = { topRoll: 0, topPitch: 0, bottomRoll: 0, bottomPitch: 0 };
const stream = () => {
  const stabilizer = createPostureStabilizer();
  return {
    reset: () => stabilizer.reset(),
    // Default mounting maps negative raw roll to positive forward flexion.
    read: (time, lateral = 0, forward = 0) =>
      stabilizer.update(sensor(-forward, lateral), sensor(), neutral, time),
  };
};
const hold = (s, start, lateral, forward = 0) => {
  let result;
  for (let dt = 0; dt <= 400; dt += 100) result = s.read(start + dt, lateral, forward);
  return result;
};

for (const [sign, state] of [[1, 'tilted_right'], [-1, 'tilted_left']]) {
  test(`${state}: entry requires more than 8 degrees for 400ms`, () => {
    const s = stream();
    assert.equal(s.read(0).state, 'upright');
    assert.equal(hold(s, 100, sign * 8).state, 'upright');
    for (const t of [600, 700, 800, 900, 999]) {
      assert.equal(s.read(t, sign * 8.1).state, 'upright');
    }
    assert.equal(s.read(1000, sign * 8.1).state, state);
  });

  test(`${state}: boundary jitter stays tilted; exit requires below 6 degrees`, () => {
    const s = stream();
    s.read(0);
    assert.equal(hold(s, 100, sign * 10).state, state);
    for (const [i, angle] of [8.1, 7.9, 8.2, 7, 6, 7.8].entries()) {
      assert.equal(s.read(600 + i * 100, sign * angle).state, state);
    }
    for (const t of [1200, 1300, 1400, 1500, 1599]) {
      assert.equal(s.read(t, sign * 5.9).state, state);
    }
    assert.equal(s.read(1600, sign * 5.9).state, 'upright');
  });

  test(`${state}: short excursions never accumulate into a transition`, () => {
    const s = stream();
    s.read(0);
    for (let i = 1; i <= 30; i++) {
      assert.equal(s.read(i * 100, sign * (i % 2 ? 8.1 : 7.9)).state, 'upright');
    }
    assert.equal(hold(s, 3100, sign * 10).state, state);
    s.read(3600, sign * 5);
    s.read(3900, sign * 5);
    assert.equal(s.read(3950, sign * 7).state, state);
    assert.equal(s.read(4000, sign * 5).state, state);
    assert.equal(s.read(4300, sign * 5).state, state);
    assert.equal(s.read(4400, sign * 5).state, 'upright');
  });
}

test('switching sides requires the opposite entry threshold and a fresh confirmation', () => {
  const s = stream();
  s.read(0, 10);
  assert.equal(hold(s, 100, -7).state, 'upright');
  assert.equal(hold(s, 600, -10).state, 'tilted_left');
  assert.equal(hold(s, 1100, 10).state, 'tilted_right');
});

test('changing the candidate restarts the confirmation period', () => {
  const s = stream();
  s.read(0);
  s.read(100, 10);
  s.read(400, 10);
  assert.equal(s.read(450, -10).state, 'upright');
  assert.equal(s.read(700, -10).state, 'upright');
  assert.equal(s.read(849, -10).state, 'upright');
  assert.equal(s.read(850, -10).state, 'tilted_left');
});

test('sideways/forward priority fluctuations are filtered without changing the priority rule', () => {
  const s = stream();
  s.read(0, 15, 20); // lateral wins: 15 > 20 * 0.7
  for (let i = 1; i <= 20; i++) {
    assert.equal(s.read(i * 100, i % 2 ? 13 : 15, 20).state, 'tilted_right');
  }
  assert.equal(hold(s, 2100, 13, 20).state, 'forward_lean');
  assert.equal(hold(s, 2600, 15, 20).state, 'tilted_right');
});

test('pending transitions keep accepted score/severity while angles remain live', () => {
  const s = stream();
  s.read(0);
  const pending = s.read(100, 20);
  assert.deepEqual(pending, {
    state: 'upright', severity: 'minimal', instantScore: 100, pitchDiff: 0, rollDiff: 20,
  });
  const confirmed = hold(s, 200, 20);
  assert.equal(confirmed.state, 'tilted_right');
  assert.equal(confirmed.severity, 'moderate');
  assert.equal(confirmed.instantScore, 65);
});

test('reset clears accepted hysteresis and pending confirmation', () => {
  const s = stream();
  s.read(0, 10);
  s.reset();
  assert.equal(s.read(100, 7).state, 'upright');
  s.read(200, 10);
  s.read(500, 10);
  s.reset();
  assert.equal(s.read(600).state, 'upright');
  assert.equal(s.read(700, 10).state, 'upright');
  assert.equal(s.read(1000, 10).state, 'upright');
  assert.equal(s.read(1100, 10).state, 'tilted_right');
});

test('calibrated offsets and reversed signs still determine the direction', () => {
  const baseline = {
    neutral: { topRoll: 30, bottomRoll: 10, topPitch: 20, bottomPitch: 5 },
    sagittalSign: 1, lateralSign: -1,
    maxForwardDeg: 30, maxBackwardDeg: 10, maxRightDeg: 20, maxLeftDeg: 20,
    capturedAt: '2026-10-17T00:00:00Z',
  };
  const s = createPostureStabilizer();
  s.update(sensor(30, 20), sensor(10, 5), baseline, 0);
  let result;
  for (let t = 100; t <= 500; t += 100) {
    result = s.update(sensor(30, 10), sensor(10, 5), baseline, t);
  }
  assert.equal(result.state, 'tilted_right');
  assert.equal(result.rollDiff, 10);
  s.reset();
  assert.equal(s.update(sensor(50, 20), sensor(10, 5), baseline, 600).state, 'forward_lean');
});

test('existing forward thresholds remain unchanged and sustained changes are confirmed', () => {
  for (const [angle, state] of [
    [-20, 'upright'], [12, 'upright'], [12.1, 'transition'], [18, 'transition'],
    [18.1, 'forward_lean'], [28, 'forward_lean'], [28.1, 'slouched'],
    [42, 'slouched'], [42.1, 'severe'],
  ]) {
    assert.equal(classifySpinePosture(sensor(-angle), sensor(), neutral).state, state);
    const s = stream();
    s.read(0);
    assert.equal(s.read(100, 0, angle).state, 'upright');
    assert.equal(hold(s, 200, 0, angle).state, state);
  }
});
