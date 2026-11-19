// posture_sessions / posture_daily / streak writes, against a recording fake
// Supabase client. Checks what gets written, not the real database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eqs, fakeClock, fakeSentry, fakeSupabase, flush, loadTs, opArg, quietConsole } from './helpers/harness.mjs';

const MIN = 60_000;

function setup(respond, { start } = {}) {
  const clock = fakeClock(start);
  const db = fakeSupabase(respond);
  const sentry = fakeSentry();
  const sync = loadTs('src/services/posture/postureSyncService.ts', {
    mocks: { '@/src/lib/supabase': db.module, '@/src/lib/sentry': sentry.module },
    globals: { Date: clock.Date, console: quietConsole },
  });
  return { sync, db, sentry, clock };
}
const writesTo = (db, table, method) => db.queries.filter((q) => q.table === table && q.ops.some(([m]) => m === method));

// ── session lifecycle ───────────────────────────────────────────────────────

test('startSession inserts a row and returns its id; no user means no write', async () => {
  const { sync, db } = setup((q) => (opArg(q, 'insert') ? { data: { id: 'sess-1' }, error: null } : { data: [], error: null }));
  assert.equal(await sync.startSession(null), null);
  assert.equal(writesTo(db, 'posture_sessions', 'insert').length, 0);
  assert.equal(await sync.startSession('user-1'), 'sess-1');
  const insert = opArg(writesTo(db, 'posture_sessions', 'insert')[0], 'insert');
  assert.equal(insert.user_id, 'user-1');
  assert.ok(insert.started_at);
});

test('startSession failure returns null and reports to Sentry', async () => {
  const { sync, sentry } = setup((q) => (opArg(q, 'insert') ? { data: null, error: { message: 'rls' } } : { data: [] }));
  assert.equal(await sync.startSession('user-1'), null);
  assert.ok(sentry.errors.some((e) => e.context === 'posture-session-start'));
});

const aggregates = {
  avgShs: 88.4, minShs: 70, maxCpl: 120, avgInstantScore: 91, totalDurationMs: 600_000.6,
  stateTotals: { upright: 400_000, slouched: 200_000 },
};

test('endSession marks the session completed with all seven state keys filled', async () => {
  const { sync, db } = setup();
  await sync.endSession(null, aggregates);
  assert.equal(db.queries.length, 0, 'no session id → no write');
  await sync.endSession('sess-1', aggregates);
  const [q] = writesTo(db, 'posture_sessions', 'update');
  const row = opArg(q, 'update');
  assert.equal(eqs(q).id, 'sess-1');
  assert.equal(row.is_completed_session, true);
  assert.equal(row.total_duration_ms, 600_001);
  assert.deepEqual(row.state_totals, {
    upright: 400_000, transition: 0, forward_lean: 0, slouched: 200_000, severe: 0, tilted_left: 0, tilted_right: 0,
  });
  assert.equal(row.avg_shs, 88.4);
});

test('snapshotSession saves progress but never marks the session completed', async () => {
  const { sync, db } = setup();
  await sync.snapshotSession('sess-1', aggregates);
  const row = opArg(writesTo(db, 'posture_sessions', 'update')[0], 'update');
  assert.equal(row.is_completed_session, false);
  assert.equal(row.total_duration_ms, 600_001);
});

// ── daily rebuild ───────────────────────────────────────────────────────────

test('rebuildDailyFromSessions sums completed sessions for the local day (and no longer writes the retired s’core)', async () => {
  const sessions = [
    { total_duration_ms: 10 * MIN, state_totals: { upright: 10 * MIN }, avg_shs: 90, min_shs: 80, max_cpl: 50 },
    { total_duration_ms: 30 * MIN, state_totals: { upright: 20 * MIN, slouched: 10 * MIN }, avg_shs: 70, min_shs: 60, max_cpl: 200 },
  ];
  const { sync, db } = setup((q) => {
    if (q.table === 'posture_sessions') return { data: sessions, error: null };
    if (q.table === 'posture_daily' && opArg(q, 'select')) return { data: { intervention_count: 4 }, error: null };
    return { data: null, error: null };
  });
  await sync.rebuildDailyFromSessions('user-1', '2026-11-13');

  const read = db.queries.find((q) => q.table === 'posture_sessions');
  // v2 background-service work: sessions never marked completed (app killed,
  // phone died) are included too, using their last 20s snapshot — the day is
  // rebuilt from scratch each time, so nothing is counted twice.
  assert.equal(eqs(read).is_completed_session, undefined, 'unfinished sessions are included');
  assert.equal(opArg(read, 'gte'), 'started_at');
  // Range is the phone-local day [midnight, next midnight).
  const from = read.ops.find(([m]) => m === 'gte')[2];
  const to = read.ops.find(([m]) => m === 'lt')[2];
  assert.equal(new Date(from).getTime(), new Date(2026, 10, 13).getTime());
  assert.equal(new Date(to).getTime(), new Date(2026, 10, 14).getTime());

  const row = opArg(writesTo(db, 'posture_daily', 'upsert')[0], 'upsert');
  assert.equal(row.date, '2026-11-13');
  assert.equal(row.total_desk_ms, 40 * MIN);
  assert.equal(row.session_count, 2);
  assert.equal(row.intervention_count, 4, 'existing intervention count is preserved');
  assert.equal(row.avg_score, 75, '30 of 40 min upright');
  assert.equal(row.avg_shs, 75, 'duration-weighted: (90×10 + 70×30) / 40');
  assert.equal(row.min_shs, 60);
  assert.equal(row.max_cpl, 200);
  assert.equal(row.good_posture_minutes, 30);
  assert.equal(row.bad_posture_minutes, 10);

  // [s'up s'core — RETIRED] It used to write sup_score = 75 here; XP is now saved by syncDayXp after the rebuild.
  assert.equal(writesTo(db, 'posture_daily', 'update').length, 0, 'no sup_score write');
  assert.equal('sup_score' in row, false);
});

test('rebuildDailyFromSessions writes nothing when the day has no completed sessions', async () => {
  const { sync, db } = setup((q) => (q.table === 'posture_sessions' ? { data: [], error: null } : { data: null }));
  await sync.rebuildDailyFromSessions('user-1', '2026-11-13');
  assert.equal(writesTo(db, 'posture_daily', 'upsert').length, 0);
});

test('a failed session read is reported and does not overwrite the day', async () => {
  const { sync, db, sentry } = setup((q) => (q.table === 'posture_sessions' ? { data: null, error: { message: 'down' } } : {}));
  await sync.rebuildDailyFromSessions('user-1', '2026-11-13');
  assert.equal(writesTo(db, 'posture_daily', 'upsert').length, 0);
  assert.ok(sentry.errors.some((e) => e.context === 'posture-daily-rebuild'));
});

// ── stale-session recovery ──────────────────────────────────────────────────

test('starting a session closes abandoned (>30 min, not completed) sessions and rebuilds their days', async () => {
  const start = new Date(2026, 10, 13, 10, 0).getTime();
  const stale = { id: 'old', started_at: new Date(2026, 10, 12, 22, 0).toISOString(), ended_at: new Date(2026, 10, 12, 23, 0).toISOString() };
  const { sync, db } = setup((q) => {
    if (q.table === 'posture_sessions' && opArg(q, 'insert')) return { data: { id: 'new' }, error: null };
    if (q.table === 'posture_sessions' && eqs(q).is_completed_session === false) return { data: [stale], error: null };
    return { data: [], error: null };
  }, { start });
  await sync.startSession('user-1');
  await flush();
  const lookup = db.queries.find((q) => eqs(q).is_completed_session === false);
  assert.equal(new Date(lookup.ops.find(([m]) => m === 'lt')[2]).getTime(), start - 30 * MIN);
  const close = db.queries.find((q) => q.table === 'posture_sessions' && eqs(q).id === 'old');
  assert.deepEqual(opArg(close, 'update'), { ended_at: stale.ended_at, is_completed_session: true });
  // Rebuild runs for the stale session's own (local) start day.
  const rebuild = db.queries.filter((q) => q.table === 'posture_sessions' && String(opArg(q, 'select')).startsWith('total_duration_ms'));
  assert.equal(new Date(rebuild[0].ops.find(([m]) => m === 'gte')[2]).getTime(), new Date(2026, 10, 12).getTime());
});

// ── streaks (device-local day) ──────────────────────────────────────────────

async function streakAfterOpen(profile, now = new Date(2026, 10, 13, 0, 30).getTime()) {
  const { sync, db } = setup((q) => (q.table === 'profiles' && opArg(q, 'select') ? { data: profile, error: null } : { data: null }), { start: now });
  await sync.checkStreakOnAppOpen('user-1');
  return opArg(writesTo(db, 'profiles', 'update')[0] ?? { ops: [] }, 'update') ?? null;
}

test('opening the app the day after extends the streak', async () => {
  assert.deepEqual(await streakAfterOpen({ current_streak: 4, last_activity_date: '2026-11-12' }),
    { current_streak: 5, last_activity_date: '2026-11-13' });
});

test('opening twice in one day does not change the streak', async () => {
  assert.equal(await streakAfterOpen({ current_streak: 4, last_activity_date: '2026-11-13' }), null);
});

test('a missed day resets the streak to 1', async () => {
  assert.deepEqual(await streakAfterOpen({ current_streak: 9, last_activity_date: '2026-11-10' }),
    { current_streak: 1, last_activity_date: '2026-11-13' });
  assert.deepEqual(await streakAfterOpen({ current_streak: 0, last_activity_date: null }),
    { current_streak: 1, last_activity_date: '2026-11-13' });
});

test('streak days use the local calendar day, not UTC, across month and year ends', async () => {
  assert.deepEqual(await streakAfterOpen({ current_streak: 2, last_activity_date: '2026-12-31' }, new Date(2027, 0, 1, 0, 5).getTime()),
    { current_streak: 3, last_activity_date: '2027-01-01' });
  assert.deepEqual(await streakAfterOpen({ current_streak: 2, last_activity_date: '2028-02-28' }, new Date(2028, 1, 29, 23, 55).getTime()),
    { current_streak: 3, last_activity_date: '2028-02-29' });
});

// ── XP (docs/xp.md) ─────────────────────────────────────────────────────────

test('posture_daily reads include each day’s XP (0 when missing), which every screen now shows as the score', async () => {
  const { sync, db } = setup(() => ({ data: [
    { date: '2026-11-17', total_desk_ms: 20 * MIN, sup_score: 70, xp: 25 },
    { date: '2026-11-18', total_desk_ms: 0, sup_score: null, xp: null },
  ], error: null }));
  const rows = await sync.fetchAllPostureRows('user-1');
  assert.deepEqual(rows.map((r) => [r.date, r.xp]), [['2026-11-17', 25], ['2026-11-18', 0]]);
  assert.match(opArg(db.queries[0], 'select'), /\bxp\b/);
});
