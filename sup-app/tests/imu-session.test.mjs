// IMUContext session lifecycle, driven by fake s'pot packets through the real
// provider (real imuParser + stabiliser; BLE, Supabase, storage, notifications
// faked). Covers: session start, backgrounding, disconnect gap + prompt,
// deliberate end, post-end packet suppression, SHS/CPL ticking, interventions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flush, imuPacket } from './helpers/harness.mjs';
import { setupImu } from './helpers/imuProvider.mjs';

const SEC = 1000;

const setup = setupImu;

async function started(s, forward = 0) {
  // Packets are ignored until saved calibration / the running-session record
  // have loaded from storage (v2 background-service work), so let that finish.
  await flush();
  s.connected('top'); s.connected('bottom');
  s.packets(forward);
  await flush();
  s.rerender();
}

test('first packet from both s\'pots starts exactly one session for the signed-in user', async () => {
  const s = setup();
  s.connected('top'); s.connected('bottom');
  s.onData('top', imuPacket());
  await flush();
  assert.equal(s.calls.start.length, 0, 'one slot alone does not start a session');
  s.packets();
  s.stream(3 * SEC);
  await flush();
  assert.deepEqual(s.calls.start, ['user-1']);
  assert.notEqual(s.ctx().sessionStartTimeMs, null);
  assert.equal(s.ctx().posture.state, 'upright');
});

test('backgrounding (e.g. screen off) snapshots the session but does not end it', async () => {
  const s = setup();
  await started(s);
  s.stream(5 * SEC);
  s.background();
  await flush();
  assert.equal(s.calls.snapshot.length >= 1, true);
  assert.equal(s.calls.snapshot.at(-1).id, 'sess-1');
  assert.equal(s.calls.end.length, 0);
  // Packets keep counting in the same session after coming back.
  s.active();
  s.stream(5 * SEC);
  await flush();
  assert.equal(s.calls.start.length, 1);
});

test('the session is snapshotted every 20s while running', async () => {
  const s = setup();
  await started(s);
  s.stream(61 * SEC);
  await flush();
  assert.equal(s.calls.snapshot.length, 3);
});

test('an unexpected drop prompts "reconnect or end", keeps the session open, and notifies in the background', async () => {
  const s = setup();
  await started(s);
  s.stream(5 * SEC);
  s.dropped('top');
  s.onUnexpected('top', { id: 'top-id' });
  s.rerender();
  assert.equal(s.calls.end.length, 0, 'drop alone never ends the session');
  assert.ok(s.calls.alerts.some((a) => a.kind === 'spot-disconnected-top'));
  const prompt = s.alert();
  assert.equal(prompt.visible, true);
  assert.equal(prompt.dismissable, false);
  assert.deepEqual(prompt.buttons.map((b) => b.text), ["end s'ession", "reconnect s'pot"]);
  prompt.buttons[1].onPress();
  assert.deepEqual(s.calls.confirmReconnect, ['top']);
});

test('choosing "end s\'ession" on the prompt saves the session and cancels the reconnect', async () => {
  const s = setup();
  await started(s);
  s.stream(5 * SEC);
  s.dropped('top');
  s.onUnexpected('top', { id: 'top-id' });
  s.rerender();
  s.alert().buttons[0].onPress();
  assert.deepEqual(s.calls.cancelReconnect, ['top']);
  assert.equal(s.calls.end.length, 1);
  assert.equal(s.calls.end[0].id, 'sess-1');
});

test('disconnected time is excluded from the saved session duration', async () => {
  const s = setup();
  await started(s);
  s.stream(60 * SEC);
  s.dropped('top');
  s.clock.advance(120 * SEC);             // 2 minutes with a s'pot gone
  s.connected('top');
  s.stream(60 * SEC);
  await s.ctx().disconnectAll();
  const { totalDurationMs } = s.calls.end[0].agg;
  assert.ok(Math.abs(totalDurationMs - 120 * SEC) <= 500, `tracked ${totalDurationMs}ms, expected ~120000`);
});

test('a reconnect mid-session continues the same session (no second start)', async () => {
  const s = setup();
  await started(s);
  s.stream(10 * SEC);
  s.dropped('bottom');
  s.clock.advance(30 * SEC);
  s.connected('bottom');
  s.stream(10 * SEC);
  await flush();
  assert.equal(s.calls.start.length, 1);
  assert.equal(s.calls.end.length, 0);
});

test('a deliberate end saves once, rebuilds the start day after 5s, and ignores draining packets', async () => {
  const s = setup();
  await started(s);
  s.stream(10 * SEC);
  await s.ctx().disconnectAll();
  assert.equal(s.calls.end.length, 1);
  assert.equal(s.calls.rebuild.length, 0);
  s.clock.advance(5 * SEC);
  assert.deepEqual(s.calls.rebuild, [['user-1', '2026-11-13']]);
  // Packets still arriving from the BLE stack must not open a phantom session.
  s.stream(5 * SEC);
  await flush();
  assert.equal(s.calls.start.length, 1);
  // A fresh connection lifts the suppression; the next packets start session 2.
  s.connected('top'); s.connected('bottom');
  s.stream(1 * SEC);
  await flush();
  assert.equal(s.calls.start.length, 2);
});

test('endSessionKeepConnected ends the session and waits for startNewSession', async () => {
  const s = setup();
  await started(s);
  s.stream(5 * SEC);
  s.ctx().endSessionKeepConnected();
  assert.equal(s.calls.end.length, 1);
  s.stream(5 * SEC);
  await flush();
  assert.equal(s.calls.start.length, 1);
  s.ctx().startNewSession();
  s.stream(1 * SEC);
  await flush();
  assert.equal(s.calls.start.length, 2);
});

test('a session that runs past midnight is rebuilt under the day it started', async () => {
  const s = setup();
  s.clock.set(new Date(2026, 10, 13, 23, 59, 0).getTime());
  await started(s);
  s.stream(3 * 60 * SEC);
  await s.ctx().disconnectAll();
  s.clock.advance(5 * SEC);
  assert.deepEqual(s.calls.rebuild, [['user-1', '2026-11-13']]);
});

test('SHS rises while upright and drops immediately while severe; CPL builds while severe', async () => {
  const s = setup();
  await started(s, 60);                   // severe from the first packet
  s.stream(30 * SEC, 60);
  // −0.067/s for ~30s from 100 → ~98; CPL +1.5/s → ~45.
  assert.ok(s.ctx().shs <= 98 && s.ctx().shs >= 97, `shs ${s.ctx().shs}`);
  assert.ok(s.ctx().cpl >= 43 && s.ctx().cpl <= 47, `cpl ${s.ctx().cpl}`);
  s.stream(30 * SEC, 0);                  // upright: CPL recovers slowly (0.15/s)
  assert.ok(s.ctx().cpl < 45 && s.ctx().cpl > 38, `cpl ${s.ctx().cpl}`);
});

test('slouching is free for the 3-minute grace period, then costs SHS', async () => {
  const s = setup();
  await started(s, 35);                   // slouched band
  s.stream(170 * SEC, 35);
  assert.equal(s.ctx().shs, 100);
  s.stream(60 * SEC, 35);
  assert.ok(s.ctx().shs < 100, `shs ${s.ctx().shs}`);
});

test('5 minutes of severe posture fires one s\'train intervention (in-app + background)', async () => {
  const s = setup();
  await started(s, 60);
  s.stream(190 * SEC, 60);
  assert.equal(s.ctx().activeIntervention, null);
  s.stream(20 * SEC, 60);                 // CPL passes 300 at ~200s of severe
  assert.equal(s.ctx().activeIntervention?.state, 'severe');
  const interventions = s.calls.alerts.filter((a) => a.kind === 'posture-intervention');
  assert.equal(interventions.length, 1);
  s.stream(30 * SEC, 60);
  assert.equal(s.calls.alerts.filter((a) => a.kind === 'posture-intervention').length, 1, 'does not re-fire while still severe');
});

test('saved aggregates carry avg/min SHS, max CPL and the per-state totals the Desk tracker reported', async () => {
  const s = setup();
  await started(s, 60);
  s.stream(20 * SEC, 60);
  s.ctx().setSessionStateTotals({ severe: 20 * SEC });
  await s.ctx().disconnectAll();
  const { agg } = s.calls.end[0];
  assert.deepEqual(agg.stateTotals, { severe: 20 * SEC });
  assert.ok(agg.minShs < 100 && agg.avgShs < 100 && agg.maxCpl > 0);
});

test('no session row is created when signed out, and ending writes nothing', async () => {
  const s = setup({ userId: null });
  s.calls.start.length = 0;
  await started(s);
  s.stream(5 * SEC);
  await flush();
  // v2 background-service work: with no login the row isn't requested at all;
  // ensureSessionRow retries from the snapshot tick once a user is known.
  assert.deepEqual(s.calls.start, [], 'no session row is requested while signed out');
  await s.ctx().disconnectAll();
  s.clock.advance(5 * SEC); await flush();
  assert.equal(s.calls.end.length, 0, 'ending writes nothing');
  assert.equal(s.calls.rebuild.length, 0);
});
