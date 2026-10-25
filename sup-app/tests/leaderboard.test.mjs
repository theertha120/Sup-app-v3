import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const js = ts.transpile(readFileSync(new URL(path, import.meta.url), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const dates = load('../src/lib/dateKey.ts');
const names = load('../src/utils/displayName.ts');
function service(supabase = {}) {
  return load('../src/services/social/leaderboardPageService.ts', {
    '@/src/lib/supabase': { supabase }, '../../lib/dateKey': dates, '../../utils/displayName': names,
  });
}
const api = service();
const { LeaderboardStore } = load('../src/services/social/leaderboardStore.ts', { './leaderboardPageService': api });
const query = { scope: 'everyone', period: 'day', dateKey: '2026-10-25' };
const profile = (id, username = id) => ({ id, name: id, username, avatar_url: null });
const entry = (i) => ({ user: { id: `u${i}`, name: `User ${i}` }, avgSupScore: 100 - i, rank: i + 1, sessionsCounted: 1 });
function fixture(count = 155) {
  const entries = Array.from({ length: count }, (_, i) => entry(i));
  const calls = [];
  let now = 1000;
  let error = false;
  const store = new LeaderboardStore(async (query, offset, limit, force) => {
    calls.push({ query, offset, limit, force });
    if (error) throw Error('offline');
    return { entries: entries.slice(offset, offset + limit), ownEntry: entries.at(-1) ?? null, total: count, friendCount: 2 };
  }, () => {}, () => now);
  return { store, calls, advance: () => { now += api.LEADERBOARD_STALE_MS; }, fail: (value) => { error = value; } };
}

test('ranking preserves daily means, null-score treatment, ties and zero-data users', () => {
  const { entries } = api.rankCompactLeaderboard([profile('z'), profile('a'), profile('b'), profile('none')], [
    { user_id: 'z', sup_score: 80 }, { user_id: 'a', sup_score: 80 },
    { user_id: 'b', sup_score: 100 }, { user_id: 'b', sup_score: null },
  ], [], 'z', 'everyone');
  assert.deepEqual(entries.map((e) => [e.user.id, e.avgSupScore, e.rank]), [['a', 80, 1], ['z', 80, 1], ['b', 50, 3], ['none', 0, 4]]);
});

test('friends scope includes self, both relationship directions, and no duplicates', () => {
  const result = api.rankCompactLeaderboard(['me', 'friend', 'other'].map((id) => profile(id)), [], [
    { from_user_id: 'me', to_user_id: 'friend' }, { from_user_id: 'friend', to_user_id: 'me' },
  ], 'me', 'friends');
  assert.equal(result.friendCount, 1);
  assert.deepEqual(result.entries.map((e) => e.user.id).sort(), ['friend', 'me']);
  assert.equal(result.ownEntry.user.id, 'me');
});

test('pagination continues through server-imposed short responses', async () => {
  const input = Array.from({ length: 1101 }, (_, i) => i);
  const offsets = [];
  const actual = await api.readLeaderboardPages(async (offset) => {
    offsets.push(offset);
    return { data: input.slice(offset, offset + 37), error: null };
  });
  assert.deepEqual(actual, input);
  assert.equal(offsets.at(-1), 1101);
});

test('a failed data page propagates instead of publishing partial rankings', async () => {
  await assert.rejects(api.readLeaderboardPages(async (offset) => offset === 0
    ? { data: [1, 2], error: null } : { data: null, error: Error('offline') }), /offline/);
});

test('RPC requests only the requested window/page without auth or profile requests', async () => {
  const calls = [];
  const source = service({ rpc: async (...args) => {
    calls.push(args);
    return { data: { entries: [{ ...profile('top'), avg_sup_score: 98.5, sessions_counted: 2, rank: 1 }],
      own_entry: { ...profile('me'), avg_sup_score: 12, sessions_counted: 1, rank: 999 }, total: 1200, friend_count: 3 }, error: null };
  } }).createLeaderboardSource('me');
  const result = await source({ ...query, period: 'week' }, 0, 5);
  assert.deepEqual(calls, [['get_leaderboard_page', { p_start_date: '2026-10-19', p_end_date: '2026-10-25', p_scope: 'everyone', p_offset: 0, p_limit: 5 }]]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.ownEntry.rank, 999);
  assert.equal(result.friendCount, 3);
});

test('permission failures do not silently trigger a fallback', async () => {
  const source = service({ rpc: async () => ({ error: { code: '42501', message: 'denied' } }) }).createLeaderboardSource('me');
  await assert.rejects(source(query, 0, 5), (error) => error.code === '42501');
});

function fallbackDatabase() {
  const profiles = Array.from({ length: 1501 }, (_, i) => profile(`u${String(i).padStart(4, '0')}`));
  const scores = profiles.flatMap((p, i) => Array.from({ length: 7 }, (_, day) => ({ user_id: p.id, date: `2026-10-${19 + day}`, sup_score: i / 15 })));
  const tables = { profiles, posture_daily: scores, friend_requests: [{ id: 'f1', from_user_id: profiles[0].id, to_user_id: profiles[1].id, status: 'accepted' }] };
  const calls = [];
  let rpcCalls = 0;
  return { calls, get rpcCalls() { return rpcCalls; }, supabase: {
    rpc: async () => { rpcCalls++; return { error: { code: 'PGRST202' } }; },
    from: (table) => {
      let rows = tables[table];
      const builder = {
        select: (columns) => { calls.push({ table, columns }); return builder; }, order: () => builder,
        eq: (key, value) => { rows = rows.filter((row) => row[key] === value); return builder; },
        gte: (key, value) => { rows = rows.filter((row) => row[key] >= value); return builder; },
        lte: (key, value) => { rows = rows.filter((row) => row[key] <= value); return builder; },
        or: () => builder,
        range: async (start, end) => ({ data: rows.slice(start, Math.min(end + 1, start + 137)), error: null }),
      };
      return builder;
    },
  } };
}

test('missing-RPC fallback ranks more than 1000 users and 10000 scores completely', async () => {
  const db = fallbackDatabase();
  const source = service(db.supabase).createLeaderboardSource('u0000');
  const result = await source({ ...query, period: 'week' }, 0, 5);
  assert.equal(result.total, 1501);
  assert.equal(result.entries[0].user.id, 'u1500');
  assert.equal(result.entries[0].avgSupScore, 100);
  assert.equal(result.ownEntry.rank, 1501);
  assert.equal(result.ownEntry.sessionsCounted, 7);
  assert.ok(db.calls.filter((call) => call.table === 'posture_daily').every((call) => call.columns === 'user_id, date, sup_score'));
  const before = db.calls.length;
  const friendResult = await source({ ...query, period: 'week', scope: 'friends' }, 0, 50);
  assert.equal(friendResult.total, 2);
  assert.equal(db.calls.length, before);
  assert.equal(db.rpcCalls, 1);
  const nextPage = await source({ ...query, period: 'week' }, 5, 50);
  assert.equal(nextPage.entries.length, 50);
  assert.equal(db.calls.length, before);
});

test('store does no network work until a view is requested', async () => {
  const { store, calls } = fixture();
  assert.equal(calls.length, 0);
  await store.ensure(query, 5);
  assert.equal(calls[0].limit, 5);
  assert.equal(store.get(query).entries.length, 5);
  assert.equal(store.get(query).ownEntry.rank, 155);
});

test('summary and full page requests are coalesced and fetch only missing rows', async () => {
  const { store, calls } = fixture();
  await Promise.all([store.ensure(query, 5), store.ensure(query, 50), store.ensure(query, 50)]);
  assert.deepEqual(calls.map((c) => [c.offset, c.limit]), [[0, 5], [5, 45]]);
  assert.equal(store.get(query).entries.length, 50);
});

test('scrolling appends bounded pages and stops at the end', async () => {
  const { store, calls } = fixture();
  await store.ensure(query, 50);
  await store.loadMore(query);
  await store.loadMore(query);
  await store.loadMore(query);
  await store.loadMore(query);
  assert.deepEqual(calls.map((c) => c.offset), [0, 50, 100, 150]);
  assert.ok(calls.every((c) => c.limit <= 50));
  assert.equal(store.get(query).entries.length, 155);
});

test('failed next pages retain earlier ranks and can be retried', async () => {
  const { store, fail } = fixture();
  await store.ensure(query, 50);
  fail(true);
  await store.loadMore(query);
  assert.equal(store.get(query).entries.length, 50);
  assert.match(store.get(query).error, /couldn’t update/);
  fail(false);
  await store.loadMore(query);
  assert.equal(store.get(query).entries.length, 100);
  assert.equal(store.get(query).error, null);
});

test('scope/period caches are independent and errors do not erase good results', async () => {
  const { store, fail } = fixture();
  await store.ensure(query, 5);
  fail(true);
  const friends = { ...query, scope: 'friends' };
  await store.ensure(friends, 5);
  assert.equal(store.get(query).entries.length, 5);
  assert.equal(store.get(friends).entries.length, 0);
  assert.ok(store.get(friends).error);
});

test('stale/explicit refreshes reload only a page rather than all scrolled history', async () => {
  const { store, advance, calls } = fixture();
  await store.ensure(query, 50);
  await store.loadMore(query);
  await store.ensure(query, 50);
  assert.equal(calls.length, 2);
  advance();
  await store.ensure(query, 50);
  assert.equal(calls[2].offset, 0);
  assert.equal(calls[2].limit, 50);
  assert.equal(store.get(query).entries.length, 50);
});

test('duplicate rows from a changing ranking cannot be appended', async () => {
  const store = new LeaderboardStore(async () => ({ entries: [entry(0)], ownEntry: null, total: 2, friendCount: 0 }), () => {});
  await store.ensure(query, 1);
  await store.loadMore(query);
  assert.equal(store.get(query).entries.length, 1);
  assert.ok(store.get(query).error);
});

test('responses after sign-out cannot write to the disposed account cache', async () => {
  let resolve;
  const store = new LeaderboardStore(() => new Promise((done) => { resolve = done; }), () => {});
  const request = store.ensure(query, 5);
  await Promise.resolve();
  store.dispose();
  resolve({ entries: [entry(0)], ownEntry: null, total: 1, friendCount: 0 });
  await request;
  assert.equal(store.get(query).entries.length, 0);
});
