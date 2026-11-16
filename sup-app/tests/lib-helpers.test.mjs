// Pure helpers in src/lib plus small storage-backed services.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDaysToDateKey, fromLocalDateKey, localDayRange, toLocalDateKey } from '../src/lib/dateKey.ts';
import { formatSessionMins } from '../src/lib/formatDuration.ts';
import { parsePairingQR } from '../src/lib/qrPairing.ts';
import { parseSpotName } from '../src/lib/spotNaming.ts';
import { compareSessions, computeSessionHighlights } from '../src/lib/sessionHighlights.ts';
import { computeOnboardingResult } from '../src/lib/onboarding/archetypeScoring.ts';
import { fakeAsyncStorage, fakeClock, fakeSentry, fakeSupabase, flush, loadTs } from './helpers/harness.mjs';

const MIN = 60_000;

// ── dateKey (device-local calendar day) ─────────────────────────────────────

test('date keys are the phone-local calendar day, zero-padded', () => {
  assert.equal(toLocalDateKey(new Date(2026, 0, 5, 0, 0, 1)), '2026-01-05');
  assert.equal(toLocalDateKey(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
  assert.equal(fromLocalDateKey('2026-03-09').getTime(), new Date(2026, 2, 9).getTime());
});

test('adding days rolls over months, years and leap days', () => {
  assert.equal(addDaysToDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysToDateKey('2028-03-01', -1), '2028-02-29');
  assert.equal(addDaysToDateKey('2026-11-13', -7), '2026-11-06');
});

test('a local day range is [local midnight, next local midnight)', () => {
  const { start, end } = localDayRange('2026-11-13');
  assert.equal(start.getTime(), new Date(2026, 10, 13).getTime());
  assert.equal(end.getTime(), new Date(2026, 10, 14).getTime());
});

// ── formatting ──────────────────────────────────────────────────────────────

test('session minutes format as "45min" / "1h 5min"', () => {
  assert.equal(formatSessionMins(0), '0min');
  assert.equal(formatSessionMins(44.6), '45min');
  assert.equal(formatSessionMins(60), '1h 0min');
  assert.equal(formatSessionMins(65), '1h 5min');
  assert.equal(formatSessionMins(605), '10h 5min');
});

// ── pairing ─────────────────────────────────────────────────────────────────

test('pairing QR codes decode to exact advertised names', () => {
  assert.deepEqual(parsePairingQR('{"pair_id": 7, "top": "spot_top_0007_05_08", "bottom": "spot_bot_0007_05_08"}'),
    { pairId: 7, topName: 'spot_top_0007_05_08', bottomName: 'spot_bot_0007_05_08' });
  // Names are matched verbatim, whatever format the kit was renamed to.
  assert.equal(parsePairingQR('{"pair_id": 1, "top": "WT901BLE68", "bottom": "anything"}').topName, 'WT901BLE68');
});

test('malformed QR content returns null instead of throwing', () => {
  for (const raw of ['', 'not json', 'null', '[]', '42', '{"pair_id":"7","top":"a","bottom":"b"}',
    '{"pair_id":7,"top":"","bottom":"b"}', '{"pair_id":7,"top":"a"}', '{"pair_id":null,"top":"a","bottom":"b"}']) {
    assert.equal(parsePairingQR(raw), null, raw);
  }
});

test('s\'pot names parse in every accepted punctuation style', () => {
  for (const name of ['spot_top_0048_05_01', "s'pot_top_0048.05-01", 's’pot_top_0048_05-01', 'SPOT_TOP_0048_05_01', ' spot_top_0048_05_01 ']) {
    assert.deepEqual(parseSpotName(name), { role: 'top', code: '0048', batch: '05', suffix: '01' }, name);
  }
  assert.equal(parseSpotName('spot_bot_0001_01_01').role, 'bottom');
  for (const bad of ['WT901BLE68', 'spot_mid_0048_05_01', 'spot_top_48_05_01', 'spot_top_0048_05_01x']) {
    assert.equal(parseSpotName(bad), null, bad);
  }
});

// ── end-of-session summary ──────────────────────────────────────────────────

const t0 = new Date(2026, 10, 13, 9, 0).getTime();
const seg = (state, fromMin, toMin) => ({ state, startMs: t0 + fromMin * MIN, endMs: t0 + toMin * MIN });

test('highlights: best streak, longest slouch, slip point and corrections', () => {
  const h = Object.fromEntries(computeSessionHighlights([
    seg('upright', 0, 12), seg('slouched', 12, 20), seg('upright', 20, 22), seg('severe', 22, 30),
  ]).map(({ label, text }) => [label, text]));
  assert.equal(h['Best streak'], '12 min upright, 9:00-9:12');
  assert.equal(h['Longest slouch'], '8 min, starting 9:12');
  assert.equal(h['Where it slipped'], 'Posture dropped after 10 min');
  assert.equal(h.Corrections, 'You fixed your posture 1 time');
});

test('highlights: short blips are absorbed and an all-good session needs no corrections', () => {
  const h = Object.fromEntries(computeSessionHighlights([
    seg('upright', 0, 5), { state: 'slouched', startMs: t0 + 5 * MIN, endMs: t0 + 5 * MIN + 10_000 }, seg('upright', 5 + 1 / 6, 11),
  ]).map(({ label, text }) => [label, text]));
  assert.equal(h['Best streak'], '11 min upright, 9:00-9:11');
  assert.equal(h['Longest slouch'], 'None over a minute');
  assert.equal(h.Corrections, 'None needed');
  assert.deepEqual(computeSessionHighlights([]), []);
});

test('session comparison: length as % change, posture shares as point differences', () => {
  const rows = compareSessions(
    { durationMs: 30 * MIN, stateTotals: { upright: 24 * MIN, slouched: 6 * MIN } },
    { durationMs: 20 * MIN, stateTotals: { upright: 10 * MIN, slouched: 10 * MIN } },
  );
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.deepEqual([by['Session length'].change, by['Session length'].improved], ['+50%', true]);
  assert.deepEqual([by['Good alignment'].current, by['Good alignment'].change, by['Good alignment'].improved], ['80%', '+30%', true]);
  assert.deepEqual([by.Slouching.change, by.Slouching.improved], ['-30%', true], 'less slouching is an improvement');
  assert.deepEqual([by.Tilting.change, by.Tilting.improved], ['no change', null]);
});

// ── onboarding archetype ────────────────────────────────────────────────────

test('onboarding archetype: clear winner, Compiler bonus, Q3 tiebreak and defaults', () => {
  assert.equal(computeOnboardingResult('A', 'C', 'B', 'A', 'B', 'D').archetype, 'Strategist');
  // Q1 Strategist vs Q2 Ritualist tie (no Compiler bonus) → Q3=A tiebreak picks Ritualist.
  assert.equal(computeOnboardingResult('A', 'A', 'A', 'B', 'B', 'D').archetype, 'Ritualist');
  // Compiler wins any tie it is part of.
  assert.equal(computeOnboardingResult('B', 'A', 'C', 'B', 'B', 'D').archetype, 'Compiler');
  // Q3=D falls back to Q1's answer.
  assert.equal(computeOnboardingResult('C', 'A', 'D', 'B', 'B', 'D').archetype, 'Autonomist');
  const r = computeOnboardingResult('A', 'C', 'B', 'A', 'A', 'C');
  assert.deepEqual([r.chronotype, r.interoception, r.elasticity], ['Lark', 'Sensor-Driven', 'Fluid']);
});

// ── behaviour profile presets ───────────────────────────────────────────────

test('active-time presets resolve to one start/end range in day order', () => {
  const { resolveTimeRangeFromPresets, getPresetBehaviorHours } = loadTs('src/services/user/behaviorProfileService.ts', {
    mocks: { '@/src/lib/supabase': fakeSupabase().module, '../../lib/supabase': fakeSupabase().module, '@/src/lib/sentry': fakeSentry().module, '../../lib/sentry': fakeSentry().module },
  });
  assert.deepEqual(resolveTimeRangeFromPresets(['evening', 'morning']), { start: '07:00', end: '20:59' });
  assert.deepEqual(resolveTimeRangeFromPresets(['late_night']), { start: '21:00', end: '01:00' });
  assert.deepEqual(resolveTimeRangeFromPresets([]), { start: '09:00', end: '17:00' });
  // Must stay in step with the reminder engine's own preset table.
  assert.deepEqual(getPresetBehaviorHours('afternoon'), { start: '12:00', end: '16:59' });
});

// ── caches ──────────────────────────────────────────────────────────────────

test('daily pair cache is per user and day, and expires after a minute', async () => {
  const clock = fakeClock();
  const storage = fakeAsyncStorage();
  const cache = loadTs('src/services/posture/dailyPostureCache.ts', {
    mocks: { '@react-native-async-storage/async-storage': storage, '@/src/lib/sentry': fakeSentry().module },
    globals: { Date: clock.Date },
  });
  const pair = { today: { supScore: 70 }, previous: null };
  await cache.setCachedDailyPair('u1', '2026-11-13', pair);
  assert.deepEqual(await cache.getCachedDailyPair('u1', '2026-11-13'), pair);
  assert.equal(await cache.getCachedDailyPair('u2', '2026-11-13'), null, 'other users never see it');
  assert.equal(await cache.getCachedDailyPair('u1', '2026-11-12'), null);
  clock.advance(60_001);
  assert.equal(await cache.getCachedDailyPair('u1', '2026-11-13'), null, 'stale after 60s');
  storage.store.set('dailyPair:u1:bad', '{not json');
  assert.equal(await cache.getCachedDailyPair('u1', 'bad'), null, 'corrupt entry is ignored');
});

test('last-session summary survives reloads per user and rejects malformed data', async () => {
  const storage = fakeAsyncStorage();
  const store = loadTs('src/services/session/lastSessionSummaryStore.ts', {
    mocks: { '@react-native-async-storage/async-storage': storage, '../../lib/sentry': fakeSentry().module },
  });
  const summary = { version: 1, startMs: 1, endMs: 2, score: 70, timeline: [], highlights: [], comparison: null, message: null, color: 'green' };
  store.saveLastSessionSummary('u1', summary);
  await flush();
  assert.deepEqual(await store.loadLastSessionSummary('u1'), summary);
  assert.equal(await store.loadLastSessionSummary('u2'), null);
  storage.store.set('sup_last_session_summary_u3', JSON.stringify({ version: 2, startMs: 1 }));
  assert.equal(await store.loadLastSessionSummary('u3'), null);
  store.clearLastSessionSummary('u1');
  await flush();
  assert.equal(await store.loadLastSessionSummary('u1'), null);
});
