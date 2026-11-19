// XP replaces the s'up s'core (docs/xp.md): level curve, daily XP rules,
// totals, building activity from saved rows, saving XP to posture_daily /
// profiles, and every place that triggers a sync.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs, fakeClock, fakeSupabase, fakeSentry, flush, miniReact, opArg, eqs } from './helpers/harness.mjs';

const rules = loadTs('src/services/xp/xpRules.ts');
const MIN = 60_000;
const day = (patch = {}) => ({ ...rules.emptyDay('2026-11-18'), ...patch });

// ─── Levels ───────────────────────────────────────────────────────────────────

test('level steps are 100, 200, then the sum of the two before (300, 500, 800, …)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(rules.levelStep), [100, 200, 300, 500, 800, 1300, 2100]);
});

test('level thresholds match the spec: L1 100, L2 300, L3 600, L4 1100', () => {
  const at = (xp) => rules.levelFor(xp).level;
  assert.deepEqual([0, 99, 100, 299, 300, 599, 600, 1099, 1100, 1900].map(at), [0, 0, 1, 1, 2, 2, 3, 3, 4, 5]);
  assert.equal(at(400), 2, '"400 means level 2"');
});

test('progress text reads like "Level 3 - 21/500"', () => {
  assert.equal(rules.formatLevel(rules.levelFor(621)), 'Level 3 - 21/500');
  assert.equal(rules.formatLevel(rules.levelFor(0)), 'Level 0 - 0/100');
  assert.equal(rules.formatLevel(rules.levelFor(300)), 'Level 2 - 0/300');
});

test('bad totals (negative, NaN, fractional) never break the level', () => {
  assert.equal(rules.levelFor(-50).level, 0);
  assert.equal(rules.levelFor(NaN).totalXp, 0);
  assert.equal(rules.levelFor(150.9).xpIntoLevel, 50);
  assert.ok(rules.levelFor(1e12).level > 10, 'huge totals still finish');
});

// ─── Daily XP rules ───────────────────────────────────────────────────────────

test('a posture check-in earns 10 once a day, however many are logged', () => {
  assert.equal(rules.xpForDay(day({ postureCheckins: 1 })).total, 10);
  assert.equal(rules.xpForDay(day({ postureCheckins: 30 })).total, 10);
  assert.equal(rules.xpForDay(day()).total, 0);
});

test('an exercise log earns 10 once a day', () => {
  assert.equal(rules.xpForDay(day({ exerciseLogs: 1 })).total, 10);
  assert.equal(rules.xpForDay(day({ exerciseLogs: 3 })).total, 10);
});

test('sessions earn 5 per full 10 minutes, capped at 150 a day', () => {
  const xp = (ms) => rules.xpForDay(day({ sessionMs: { sit: ms } })).breakdown.sessions;
  assert.equal(xp(10 * MIN - 1), 0, 'under 10 minutes earns nothing');
  assert.equal(xp(10 * MIN), 5);
  assert.equal(xp(25 * MIN), 10);
  assert.equal(xp(300 * MIN), 150, '5 hours hits the cap');
  assert.equal(xp(600 * MIN), 150, 'never more than 150');
});

test('s’it, s’quat and s’tep time add up before rounding and share the 150 cap', () => {
  assert.equal(rules.sessionXp({ sit: 6 * MIN, squat: 4 * MIN }), 5, '6 + 4 minutes = one block');
  assert.equal(rules.sessionXp({ sit: 200 * MIN, squat: 100 * MIN, step: 100 * MIN }), 150);
  assert.equal(rules.sessionXp({ sit: -5, step: NaN }), 0);
});

test('daily goals earn 10 / 20 / 40 each by difficulty', () => {
  assert.equal(rules.xpForDay(day({ goalsCompleted: ['easy'] })).total, 10);
  assert.equal(rules.xpForDay(day({ goalsCompleted: ['medium'] })).total, 20);
  assert.equal(rules.xpForDay(day({ goalsCompleted: ['hard'] })).total, 40);
  assert.equal(rules.xpForDay(day({ goalsCompleted: ['easy', 'hard'] })).total, 50);
});

test('a full day adds every source, with a breakdown', () => {
  const result = rules.xpForDay(day({ postureCheckins: 2, exerciseLogs: 1, sessionMs: { sit: 45 * MIN }, goalsCompleted: ['medium'] }));
  assert.deepEqual(result.breakdown, { postureCheckin: 10, exerciseLog: 10, sessions: 20, goals: 20 });
  assert.equal(result.total, 60);
});

// ─── Totals ───────────────────────────────────────────────────────────────────

test('total XP adds up over the days, today is today’s running total, empty days are left out', () => {
  const summary = rules.summarizeXp([
    { ...rules.emptyDay('2026-11-16'), sessionMs: { sit: 300 * MIN }, exerciseLogs: 1 }, // 160
    { ...rules.emptyDay('2026-11-17') },                                                 // 0
    { ...rules.emptyDay('2026-11-18'), postureCheckins: 1, sessionMs: { sit: 20 * MIN } }, // 20
  ], '2026-11-18');
  assert.equal(summary.totalXp, 180);
  assert.equal(summary.todayXp, 20);
  assert.deepEqual(summary.days.map((d) => d.date), ['2026-11-18', '2026-11-16']);
  assert.equal(rules.formatLevel(summary), 'Level 1 - 80/200');
});

// ─── XP service: building activity and saving to Supabase ────────────────────

const local = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();

/**
 * Loads xpService against an in-memory posture_daily / posture_checkins /
 * exercise_workouts / profiles. `daily` rows are { date, total_desk_ms, xp }.
 */
function service({ daily = [], checkins = [], workouts = [], failInsert = null, failProfile = false } = {}) {
  const tables = { daily: daily.map((r) => ({ ...r })), profile: { xp_total: 0, xp_level: 0 } };
  const sentry = fakeSentry();
  const db = fakeSupabase((q) => {
    const op = (m) => q.ops.find(([name]) => name === m);
    const where = eqs(q);
    if (q.table === 'posture_daily') {
      if (op('update')) {
        const rows = tables.daily.filter((r) => r.date === where.date);
        rows.forEach((r) => Object.assign(r, op('update')[1]));
        return { data: rows.map((r) => ({ date: r.date })), error: null };
      }
      if (op('insert')) {
        if (failInsert) { const e = failInsert; failInsert = null; if (e.code === '23505') tables.daily.push({ date: op('insert')[1].date, total_desk_ms: 999 }); return { error: e }; }
        tables.daily.push({ ...op('insert')[1] });
        return { error: null };
      }
      if (op('maybeSingle')) return { data: tables.daily.find((r) => r.date === where.date) ?? null, error: null };
      if (op('range')) {
        const [, from, to] = op('range');
        return { data: tables.daily.slice(from, to + 1).map((r) => ({ xp: r.xp ?? 0 })), error: null };
      }
    }
    if (q.table === 'posture_checkins') {
      const from = op('gte')[2]; const to = op('lt')[2];
      return { count: checkins.filter((c) => c.logged_at >= from && c.logged_at < to).length, error: null };
    }
    if (q.table === 'exercise_workouts') return { count: workouts.filter((w) => w.performed_on === where.performed_on).length, error: null };
    if (q.table === 'profiles') {
      if (op('update')) { if (failProfile) return { error: { message: 'rls' } }; Object.assign(tables.profile, op('update')[1]); return { error: null }; }
      return { data: tables.profile, error: null };
    }
    return { data: null, error: null };
  });
  const mod = loadTs('src/services/xp/xpService.ts', {
    globals: fakeClock(new Date(2026, 10, 18, 12).getTime()),
    mocks: {
      '@/src/lib/supabase': db.module,
      '@/src/lib/sentry': sentry.module,
      '@/src/services/posture/postureSyncService': {
        fetchAllPostureRows: async () => tables.daily.map((r) => ({ date: r.date, totalDeskMs: r.total_desk_ms ?? null, xp: r.xp ?? 0 })),
      },
      '@/src/services/exercise/exerciseLogCache': {
        loadWorkouts: async () => workouts,
        loadCheckins: async () => checkins,
      },
    },
  });
  const writes = (table, method) => db.queries.filter((q) => q.table === table && opArg(q, method) !== undefined);
  return { ...mod, tables, db, sentry, writes };
}

test('saved rows become one activity per phone-local day', () => {
  const s = service();
  const days = s.buildDailyActivity({
    daily: [{ date: '2026-11-17', totalDeskMs: 30 * MIN }, { date: '2026-11-18', totalDeskMs: null }],
    workouts: [{ performed_on: '2026-11-17' }, { performed_on: '2026-11-17' }],
    // Just after local midnight: belongs to the 18th whatever the UTC date is.
    checkins: [{ logged_at: local(18, 0, 30) }, { logged_at: local(17, 23, 30) }, { logged_at: 'not a date' }],
  });
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(byDate['2026-11-17'].sessionMs.sit, 30 * MIN);
  assert.equal(byDate['2026-11-17'].exerciseLogs, 2);
  assert.equal(byDate['2026-11-17'].postureCheckins, 1);
  assert.equal(byDate['2026-11-18'].postureCheckins, 1);
  assert.equal(byDate['2026-11-18'].sessionMs.sit, undefined, 'null session time is ignored');
});

test('syncDayXp saves the day’s XP onto its existing row (XP columns only) and updates the profile', async () => {
  const s = service({
    daily: [{ date: '2026-11-18', total_desk_ms: 45 * MIN, xp: 0 }, { date: '2026-11-17', total_desk_ms: 0, xp: 40 }],
    checkins: [{ logged_at: local(18, 9) }],
    workouts: [{ performed_on: '2026-11-18' }],
  });
  const result = await s.syncDayXp('user-a', '2026-11-18');
  assert.equal(result.total, 40, '20 session + 10 check-in + 10 exercise');
  const [update] = s.writes('posture_daily', 'update');
  assert.deepEqual(opArg(update, 'update'), { xp: 40, xp_breakdown: { postureCheckin: 10, exerciseLog: 10, sessions: 20, goals: 0 } });
  assert.deepEqual(eqs(update), { user_id: 'user-a', date: '2026-11-18' });
  assert.equal(s.writes('posture_daily', 'insert').length, 0, 'existing row: no insert, posture data untouched');
  assert.deepEqual(s.tables.profile, { xp_total: 80, xp_level: 0 }, 'profile total = sum of every day’s stored XP');
  assert.deepEqual(eqs(s.writes('profiles', 'update')[0]), { id: 'user-a' });
});

test('a day with XP but no posture_daily row (check-in / workout only) gets a row with zeroed posture columns', async () => {
  const s = service({ checkins: [{ logged_at: local(18, 9) }] });
  await s.syncDayXp('user-a', '2026-11-18');
  const row = opArg(s.writes('posture_daily', 'insert')[0], 'insert');
  assert.equal(row.date, '2026-11-18');
  assert.equal(row.user_id, 'user-a');
  assert.equal(row.xp, 10);
  assert.equal(row.total_desk_ms, 0);
  assert.equal(row.session_count, 0);
  assert.equal(Object.values(row.state_totals).every((v) => v === 0), true);
  assert.equal('sup_score' in row, false, 'the retired s’core is never written');
  assert.equal(s.tables.profile.xp_total, 10);
});

test('a day with no XP and no row is left alone (no empty rows created)', async () => {
  const s = service();
  await s.syncDayXp('user-a', '2026-11-18');
  assert.equal(s.writes('posture_daily', 'insert').length, 0);
});

test('if a session rebuild creates the row at the same moment, XP is set on that row instead', async () => {
  const s = service({ checkins: [{ logged_at: local(18, 9) }], failInsert: { code: '23505' } });
  await s.syncDayXp('user-a', '2026-11-18');
  assert.equal(s.writes('posture_daily', 'update').length, 2, 'update, insert conflict, update again');
  assert.equal(s.tables.daily.find((r) => r.date === '2026-11-18').xp, 10);
  assert.equal(s.tables.daily.find((r) => r.date === '2026-11-18').total_desk_ms, 999, 'rebuild’s posture data kept');
});

test('a failed sync never throws; it reports to Sentry (the next login repairs it)', async () => {
  const s = service({ checkins: [{ logged_at: local(18, 9) }], failInsert: { code: '42501', message: 'rls' } });
  assert.equal(await s.syncDayXp('user-a', '2026-11-18'), null);
  assert.equal(s.sentry.errors[0].context, 'xp-sync-day');
});

test('syncs run one at a time, so two quick changes can’t race', async () => {
  const s = service({ daily: [{ date: '2026-11-18', total_desk_ms: 10 * MIN, xp: 0 }] });
  const order = [];
  await Promise.all([
    s.syncDayXp('user-a', '2026-11-18').then(() => order.push('first')),
    s.syncDayXp('user-a', '2026-11-18').then(() => order.push('second')),
  ]);
  assert.deepEqual(order, ['first', 'second']);
  const tables = s.db.queries.map((q) => q.table);
  const firstProfile = tables.indexOf('profiles');
  assert.ok(tables.slice(0, firstProfile).filter((t) => t === 'exercise_workouts').length === 1, 'second sync starts after the first finishes');
});

test('syncAllXp backfills history, fixes out-of-date days (including back to 0) and sets the profile total', async () => {
  const s = service({
    daily: [
      { date: '2026-11-10', total_desk_ms: 120 * MIN, xp: 0 },  // before XP existed → 60
      { date: '2026-11-11', total_desk_ms: 0, xp: 10 },          // workout since deleted → 0
      { date: '2026-11-12', total_desk_ms: 20 * MIN, xp: 10 },   // already right → untouched
    ],
    workouts: [{ performed_on: '2026-11-15' }],                   // no row yet → new row, 10
    checkins: [{ logged_at: local(18, 8) }],                       // today → new row, 10
  });
  const summary = await s.syncAllXp('user-a', '2026-11-18');
  const xpBy = Object.fromEntries(s.tables.daily.map((r) => [r.date, r.xp]));
  assert.deepEqual(xpBy, { '2026-11-10': 60, '2026-11-11': 0, '2026-11-12': 10, '2026-11-15': 10, '2026-11-18': 10 });
  assert.ok(!s.writes('posture_daily', 'update').some((q) => eqs(q).date === '2026-11-12'), 'correct days aren’t rewritten');
  assert.deepEqual([summary.totalXp, summary.todayXp, summary.level], [90, 10, 0]);
  assert.deepEqual(s.tables.profile, { xp_total: 90, xp_level: 0 });
});

test('fetchLevelProgress reads profiles.xp_total and works out the level', async () => {
  const s = service();
  s.tables.profile.xp_total = 621;
  assert.equal(rules.formatLevel(await s.fetchLevelProgress('user-a')), 'Level 3 - 21/500');
});

// ─── Everything that triggers an XP sync ──────────────────────────────────────

test('ending a session rebuilds the day, then syncs that day’s XP', async () => {
  const { setupImu } = await import('./helpers/imuProvider.mjs');
  const s = setupImu();
  s.connected('top'); s.connected('bottom');
  s.packets(); await flush(); s.rerender();
  s.stream(10_000);
  await s.ctx().disconnectAll();
  assert.equal(s.calls.xp.length, 0, 'not before the rebuild');
  s.clock.advance(5000); await flush();
  assert.equal(s.calls.rebuild.length, 1);
  assert.deepEqual(s.calls.xp, [s.calls.rebuild[0]], 'same user and day, after the rebuild');
});

test('XpSync backfills XP once per sign-in', () => {
  const hooks = miniReact();
  let userId = 'user-a'; const calls = [];
  const mod = loadTs('src/features/xp/XpSync.tsx', { mocks: {
    react: hooks.react,
    '@/src/contexts/AuthContext': { useAuth: () => ({ userId }) },
    '@/src/services/xp/xpService': { syncAllXp: async (id) => { calls.push(id); return null; } },
  } });
  const m = hooks.mount(() => mod.default());
  m.render(); m.render();
  userId = null; m.render();
  userId = 'user-b'; m.render();
  assert.deepEqual(calls, ['user-a', 'user-b']);
});

// ─── Change notifications (Stats / level / leaderboard reload on real changes) ─

test('a sync announces an XP change only when it actually changed something', async () => {
  const s = service({ checkins: [{ logged_at: local(18, 9) }] });
  const heard = [];
  const unsubscribe = s.subscribeToXpChanges((id) => heard.push(id));
  await s.syncDayXp('user-a', '2026-11-18');
  assert.deepEqual(heard, ['user-a'], 'first check-in of the day: 0 → 10');
  await s.syncDayXp('user-a', '2026-11-18');
  assert.deepEqual(heard, ['user-a'], 'nothing changed: no announcement, no rewrite');
  assert.equal(s.writes('posture_daily', 'update').length, 1);
  unsubscribe();
  s.tables.profile.xp_total = 999; // out of date
  await s.syncDayXp('user-a', '2026-11-18');
  assert.deepEqual(heard, ['user-a'], 'unsubscribed listeners hear nothing');
});

test('a profile total that was out of date is fixed and announced even if no day changed', async () => {
  const s = service({ daily: [{ date: '2026-11-17', total_desk_ms: 20 * MIN, xp: 10 }] });
  const heard = [];
  s.subscribeToXpChanges((id) => heard.push(id));
  await s.syncAllXp('user-a', '2026-11-18');
  assert.deepEqual(heard, ['user-a']);
  assert.equal(s.tables.profile.xp_total, 10);
  await s.syncAllXp('user-a', '2026-11-18');
  assert.deepEqual(heard, ['user-a'], 'second sign-in sync: all correct, so silent');
  assert.equal(s.writes('profiles', 'update').length, 1, 'profile not rewritten when unchanged');
});

test('a failing listener is reported and doesn’t stop the others', async () => {
  const s = service({ checkins: [{ logged_at: local(18, 9) }] });
  const heard = [];
  s.subscribeToXpChanges(() => { throw Error('boom'); });
  s.subscribeToXpChanges((id) => heard.push(id));
  assert.equal((await s.syncDayXp('user-a', '2026-11-18')).total, 10);
  assert.deepEqual(heard, ['user-a']);
  assert.equal(s.sentry.errors.at(-1).context, 'xp-change-listener');
});

// ─── Stats' posture history reloads when XP changes ──────────────────────────

function history({ userId = 'user-a' } = {}) {
  const hooks = miniReact();
  const auth = { userId, isAuthenticated: true };
  const listeners = new Set();
  const fetches = [];
  let respond = (id) => Promise.resolve([{ date: '2026-11-18', xp: fetches.length * 10 }]);
  const mod = loadTs('src/contexts/PostureHistoryContext.tsx', {
    globals: fakeClock(new Date(2026, 10, 18, 12).getTime()),
    mocks: {
      react: hooks.react,
      './AuthContext': { useAuth: () => auth },
      '../lib/sentry': fakeSentry().module,
      '@/src/services/posture/postureSyncService': { fetchAllPostureRows: (id) => { fetches.push(id); return respond(id); } },
      '@/src/services/xp/xpService': { subscribeToXpChanges: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
    },
  });
  const mounted = hooks.mount(() => mod.PostureHistoryProvider({ children: null }));
  let tree;
  const render = async () => { tree = mounted.render(); await flush(); tree = mounted.render(); };
  return {
    auth, fetches, listeners, render, value: () => tree.props.value, unmount: mounted.unmount,
    xpChanged: (id) => [...listeners].forEach((fn) => fn(id)),
    hold: () => { let release; respond = () => new Promise((done) => { release = done; }); return (rows) => release(rows); },
  };
}

test('Stats’ history reloads when your XP changes, so new XP shows without tapping refresh', async () => {
  const h = history();
  await h.render();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.value().rows[0].xp, 10);
  h.xpChanged('user-a'); await h.render();
  assert.equal(h.fetches.length, 2);
  assert.equal(h.value().rows[0].xp, 20);
  h.xpChanged('someone-else'); await h.render();
  assert.equal(h.fetches.length, 2, 'other users’ changes are ignored');
});

test('an XP change during the first load (sign-in backfill) triggers one more load instead of being dropped', async () => {
  const h = history();
  const release = h.hold();
  await h.render();
  h.xpChanged('user-a'); h.xpChanged('user-a');
  assert.equal(h.fetches.length, 1, 'no overlapping requests');
  release([{ date: '2026-11-18', xp: 0 }]); await h.render();
  assert.equal(h.fetches.length, 2, 'exactly one follow-up load');
});

test('signing out stops listening for XP changes', async () => {
  const h = history();
  await h.render();
  assert.equal(h.listeners.size, 1);
  h.auth.userId = null; h.auth.isAuthenticated = false; await h.render();
  assert.equal(h.listeners.size, 0);
});
