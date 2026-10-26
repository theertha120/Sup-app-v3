import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
function load(path, dependencies = {}) {
  const js = ts.transpile(readFileSync(new URL(path, import.meta.url), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const dates = load('../src/lib/dateKey.ts');
const names = load('../src/utils/displayName.ts');
// Exercise main's actual score implementation, not a duplicate formula in tests.
const posture = ts.createSourceFile('posture.ts', readFileSync(new URL('../src/services/posture/postureSyncService.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const declarations = ['POSTURE_CREDIT', 'SUP_SCORE_PRIOR_SCORE', 'SUP_SCORE_PRIOR_MS', 'ALL_STATES'];
const scoringSource = posture.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && ['unroundedSupScore', 'supScoreForRows'].includes(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declarations.includes(declaration.name.getText(posture)))
).map((node) => node.getText(posture).replace(/^export /, '')).join('\n');
const supScoreForRows = new Function(`${ts.transpile(scoringSource, { target: ts.ScriptTarget.ES2022 })}; return supScoreForRows;`)();
const period = load('../src/services/social/leaderboardPeriodService.ts', {
  '../posture/postureSyncService': { supScoreForRows }, '../../utils/displayName': names, '../../lib/dateKey': dates,
});
const data = load('../src/services/social/leaderboardData.ts');
const { LeaderboardStore } = load('../src/services/social/leaderboardStore.ts', { './leaderboardData': data });
const query = { scope: 'everyone', period: 'day', dateKey: '2026-10-26' };
const entry = (i) => ({ user: { id: `u${i}`, name: `User ${i}` }, rank: i + 1, avgSupScore: 100 - i, sessionsCounted: 1 });
function fixture() {
  const entries = Array.from({ length: 123 }, (_, i) => entry(i));
  const calls = [];
  let fail = false;
  const store = new LeaderboardStore(async (_query, offset, limit) => {
    calls.push([offset, limit]);
    if (fail) throw Error('offline');
    return { entries: entries.slice(offset, offset + limit), ownEntry: entries.at(-1), total: entries.length, friendCount: 2 };
  }, () => {});
  return { store, calls, fail: (value) => { fail = value; } };
}

test('weekly ranking keeps main time-weighted scoring and counts its prior once', () => {
  const users = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const rows = new Map([
    ['a', [{ date: '2026-10-20', stateTotals: { upright: 600000 } }, { date: '2026-10-26', stateTotals: { severe: 5400000 } }]],
    ['b', [{ date: '2026-10-26', stateTotals: { forward_lean: 600000 } }]],
  ]);
  const ranked = period.rankLeaderboard(users, rows, 'week', new Date(2026, 9, 26));
  assert.equal(ranked[0].user.id, 'b');
  assert.equal(ranked[1].avgSupScore, 13.6); // mean of daily scores would incorrectly be 40
});

test('ties keep competition ranks, alphabetical handles, and zero for no tracked data', () => {
  const users = [{ id: 'z', name: 'Z' }, { id: 'a', name: 'A' }, { id: 'none', name: 'None' }];
  const rows = new Map(['z', 'a'].map((id) => [id, [{ date: '2026-10-26', stateTotals: { upright: 600000 } }]]));
  assert.deepEqual(period.rankLeaderboard(users, rows, 'day', new Date(2026, 9, 26)).map((row) => [row.user.id, row.rank]), [['a', 1], ['z', 1], ['none', 3]]);
});

test('login creates no requests; summary fetches five and includes own rank independently', async () => {
  const { store, calls } = fixture();
  assert.equal(calls.length, 0);
  await store.ensure(query, 5);
  assert.deepEqual(calls, [[0, 5]]);
  assert.equal(store.get(query).entries.length, 5);
  assert.equal(store.get(query).ownEntry.rank, 123);
});

test('concurrent summary and full-page consumers share work and request only missing rows', async () => {
  const { store, calls } = fixture();
  await Promise.all([store.ensure(query, 5), store.ensure(query, 50), store.ensure(query, 50)]);
  assert.deepEqual(calls, [[0, 5], [5, 45]]);
});

test('paging stops at the end and failures retain existing rows', async () => {
  const { store, calls, fail } = fixture();
  await store.ensure(query, 50);
  fail(true);
  await store.more(query);
  assert.equal(store.get(query).entries.length, 50);
  assert.ok(store.get(query).error);
  fail(false);
  await store.more(query);
  await store.more(query);
  const count = calls.length;
  await store.more(query);
  assert.equal(calls.length, count);
  assert.equal(store.get(query).entries.length, 123);
});

test('old account results cannot fill a disposed cache', async () => {
  let resolve;
  const store = new LeaderboardStore(() => new Promise((done) => { resolve = done; }), () => {});
  const request = store.ensure(query, 5);
  await Promise.resolve();
  store.dispose();
  resolve({ entries: [entry(0)], ownEntry: null, total: 1, friendCount: 0 });
  await request;
  assert.equal(store.get(query).entries.length, 0);
});

test('roster requests no longer make an auth call or wait for local avatars', async () => {
  const { fetchLeaderboardByStreak } = load('../src/services/social/leaderboardService.ts', {
    '@/src/lib/supabase': { supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [{ id: 'me', name: 'Me', avatar_url: 'public-avatar' }], error: null }) }) }) } },
  });
  const users = await fetchLeaderboardByStreak();
  assert.equal(users[0].avatar, 'public-avatar');
});

function sourceFor(supabase) {
  return load('../src/services/social/leaderboardPageService.ts', {
    '@/src/lib/supabase': { supabase }, '../../lib/dateKey': dates, './leaderboardPeriodService': period,
  });
}
function fallbackDatabase() {
  const profiles = Array.from({ length: 1205 }, (_, i) => ({ id: `u${String(i).padStart(4, '0')}`, name: `User ${i}`, username: null, avatar_url: null }));
  const rows = profiles.flatMap((p, i) => Array.from({ length: 7 }, (_, day) => ({ user_id: p.id, date: `2026-10-${20 + day}`, state_totals: i ? { upright: i * 60000 } : null })));
  const tables = { profiles, posture_daily: rows, friend_requests: [{ id: 'f', from_user_id: 'u0000', to_user_id: 'u0001', status: 'accepted' }] };
  const calls = [];
  let rpcError = { code: 'PGRST202' };
  return { calls, rpcError: (value) => { rpcError = value; }, database: {
    rpc: (_name, args) => ({ abortSignal() { return this; }, then(resolve) { calls.push(['rpc', args]); resolve({ error: rpcError }); } }),
    from: (table) => {
      let current = tables[table];
      let offset = 0;
      const builder = {
        select: (columns) => { calls.push([table, columns]); return builder; }, order: () => builder, abortSignal: () => builder,
        eq: (key, value) => { current = current.filter((row) => row[key] === value); return builder; },
        gte: (key, value) => { current = current.filter((row) => row[key] >= value); return builder; },
        lte: (key, value) => { current = current.filter((row) => row[key] <= value); return builder; },
        or: () => builder, range: (start) => { offset = start; return builder; },
        then: (resolve) => resolve({ data: current.slice(offset, offset + 137), error: null }),
      };
      return builder;
    },
  } };
}

test('pagination finishes even when server pages are shorter than requested', async () => {
  const { readLeaderboardPages } = sourceFor({});
  const rows = Array.from({ length: 1100 }, (_, i) => i);
  assert.deepEqual(await readLeaderboardPages(async (offset) => ({ data: rows.slice(offset, offset + 37), error: null })), rows);
  await assert.rejects(readLeaderboardPages(async (offset) => offset ? { data: null, error: Error('offline') } : { data: [1], error: null }), /offline/);
});

test('compatibility reads preserve scoring and rank more than 1000 users completely', async () => {
  const db = fallbackDatabase();
  const source = sourceFor(db.database).createLeaderboardSource('u0000');
  const signal = new AbortController().signal;
  const page = await source({ ...query, period: 'week' }, 0, 5, false, signal);
  assert.equal(page.total, 1205);
  assert.equal(page.ownEntry.rank, 1205);
  assert.equal(page.entries[0].avgSupScore, 99.9);
  assert.equal(page.entries[0].sessionsCounted, 7);
  const before = db.calls.length;
  const friends = await source({ ...query, period: 'week', scope: 'friends' }, 0, 5, false, signal);
  assert.equal(friends.total, 2);
  assert.equal(db.calls.length, before);
  assert.ok(db.calls.filter(([table]) => table === 'posture_daily').every(([, columns]) => columns === 'user_id, date, state_totals'));
});

test('server requests are bounded and permission errors are not hidden by fallback', async () => {
  let args;
  const database = { rpc: (name, values) => {
    assert.equal(name, 'community_leaderboard_page'); args = values;
    return { abortSignal() { return this; }, then(resolve) { resolve({ data: { entries: [], own: null, total: 0, friends: 0 }, error: null }); } };
  } };
  await sourceFor(database).createLeaderboardSource('me')(query, 0, 5, false, new AbortController().signal);
  assert.equal(args.p_limit, 5);
  assert.equal(args.p_start, query.dateKey);
  const db = fallbackDatabase(); db.rpcError({ code: '42501' });
  await assert.rejects(sourceFor(db.database).createLeaderboardSource('me')(query, 0, 5, false, new AbortController().signal), (error) => error.code === '42501');
  assert.equal(db.calls.length, 1);
});

test('a stalled request releases its lock and a late result cannot replace the retry', async () => {
  let resolve;
  let calls = 0;
  let signal;
  const page = (i) => ({ entries: [entry(i)], ownEntry: null, total: 1, friendCount: 0 });
  const store = new LeaderboardStore((_query, _offset, _limit, _force, current) => {
    signal = current;
    return ++calls === 1 ? new Promise((done) => { resolve = done; }) : Promise.resolve(page(1));
  }, () => {}, Date.now, { timeoutMs: 5 });
  await store.ensure(query, 5);
  assert.equal(signal.aborted, true);
  assert.equal(store.get(query).pending, false);
  await store.ensure(query, 5);
  resolve(page(0));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(store.get(query).entries[0].user.id, 'u1');
});

function renderFull(view, fonts = true) {
  const source = ts.createSourceFile('full.tsx', readFileSync(new URL('../app/leaderboard-full.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'FullLeaderboardScreen');
  const deps = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useState: (value) => [value, () => {}], useRef: (current) => ({ current }), useCallback: (fn) => fn, useEffect: (fn) => fn(),
    useAuth: () => ({ userId: 'u9999' }), useLocalSearchParams: () => ({}), useFonts: () => [fonts], useFocusEffect: (fn) => fn(),
    useLeaderboard: () => view, require: () => 1,
    Animated: { Value: class { setValue() {} }, timing: () => ({ start() {} }), View: 'AnimatedView' },
    View: 'View', Text: 'Text', FlatList: 'FlatList', PressFeedback: 'PressFeedback', Ionicons: 'Ionicons',
    HeaderBar: 'HeaderBar', RefreshButton: 'RefreshButton', BackgroundBlobs: 'BackgroundBlobs', LeaderboardRow: 'LeaderboardRow',
    CommunityFonts: { Provider: 'Fonts' }, styles: {}, PRIMARY_TEXT: '#000', PERIODS: [{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }],
  };
  const js = ts.transpile(screen.getText(source).replace('export default ', ''), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(deps), `${js}; return FullLeaderboardScreen();`)(...Object.values(deps));
}
function findNode(tree, type) {
  if (!tree) return null;
  if (Array.isArray(tree)) { for (const item of tree) { const found = findNode(item, type); if (found) return found; } }
  if (tree.type === type) return tree;
  return tree.children ? findNode(tree.children, type) : null;
}
test('the full leaderboard virtualizes a long list and fetches near the end', () => {
  let more = 0;
  const entries = Array.from({ length: 10000 }, (_, i) => entry(i));
  const list = findNode(renderFull({ entries, total: 12000, pending: false, friendCount: 1, error: null, loadMore: () => more++ }), 'FlatList');
  assert.ok(list);
  assert.equal(list.props.data, entries);
  assert.equal(list.props.initialNumToRender, 10);
  assert.equal(list.children.length, 0);
  assert.equal(list.props.renderItem({ item: entries[9999] }).props.isCurrentUser, true);
  list.props.onEndReached();
  assert.equal(more, 1);
});

test('full rankings and header stay visible when font loading fails', () => {
  const tree = renderFull({ entries: [], total: 0, friendCount: 0, error: null, isLoading: true }, false);
  assert.ok(tree);
  assert.equal(tree.props.value, false);
  assert.equal(tree.children[0].props.style.opacity, undefined);
  assert.ok(findNode(findNode(tree, 'FlatList').props.ListHeaderComponent, 'HeaderBar'));
});

test('Community renders a loading message and header without waiting for fonts', () => {
  const file = ts.createSourceFile('community.tsx', readFileSync(new URL('../app/(tabs)/leaderboard.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'LeaderboardScreen');
  const deps = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useState: (value) => [value, () => {}], useRef: (current) => ({ current }), useEffect: () => {},
    useAuth: () => ({ userId: 'me' }), useRouter: () => ({}), useTutorial: () => ({ tutorialStep: null }),
    useSafeAreaInsets: () => ({ bottom: 0 }), useFonts: () => [false], require: () => 1,
    useLeaderboard: () => ({ entries: [], ownEntry: null, friendCount: 0, isLoading: true, error: null }),
    View: 'View', Text: 'Text', ScrollView: 'ScrollView', PressFeedback: 'PressFeedback',
    HeaderBar: 'HeaderBar', RefreshButton: 'RefreshButton', BackgroundBlobs: 'BackgroundBlobs',
    CommunityFonts: { Provider: 'Fonts' }, styles: {}, NAV_BAR_HEIGHT: 72, NAV_BOTTOM_OFFSET: 25, SUMMARY_PERIOD: 'day',
  };
  const js = ts.transpile(fn.getText(file).replace('export default ', ''), { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
  const tree = new Function(...Object.keys(deps), `${js}; return LeaderboardScreen();`)(...Object.values(deps));
  assert.equal(tree.children[0].props.style.opacity, undefined);
  assert.ok(findNode(tree, 'HeaderBar'));
  assert.ok(findNode(tree, 'Text'));
});

test('focus checks reuse fresh data and stale checks reload a bounded first page', async () => {
  let now = 1000;
  const calls = [];
  const store = new LeaderboardStore(async (_query, offset, limit, force) => {
    calls.push([offset, limit, force]);
    return { entries: Array.from({ length: limit }, (_, i) => entry(offset + i)), ownEntry: null, total: 500, friendCount: 0 };
  }, () => {}, () => now);
  await store.ensure(query, 50);
  await store.ensure(query, 50);
  assert.equal(calls.length, 1);
  now = 11000;
  await store.more(query);
  assert.equal(store.get(query).updatedAt, 1000); // appended rows must not hide stale first-page data
  now = 62000;
  await store.ensure(query, 50);
  assert.deepEqual(calls.at(-1), [0, 50, true]);
});

test('updates received during a request queue a fresh read rather than publishing the old result', async () => {
  let resolve;
  let calls = 0;
  const page = (i) => ({ entries: [entry(i)], ownEntry: null, total: 1, friendCount: 0 });
  const store = new LeaderboardStore(() => ++calls === 1 ? new Promise((done) => { resolve = done; }) : Promise.resolve(page(1)), () => {});
  const stop = store.observe(query, 5);
  const request = store.ensure(query, 5);
  await Promise.resolve();
  store.invalidate();
  resolve(page(0));
  await request;
  assert.equal(calls, 2);
  assert.equal(store.get(query).entries[0].user.id, 'u1');
  stop();
});

test('offscreen changes invalidate the cache without fetching until return', async () => {
  const { store, calls } = fixture();
  await store.ensure(query, 5);
  store.invalidate();
  assert.equal(calls.length, 1);
  await store.ensure(query, 5);
  assert.equal(calls.length, 2);
});

test('freshness checks poll in foreground, debounce saves, resume and clean up', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { startCommunityFreshness } = load('../src/services/social/communityFreshness.ts');
  let checks = 0, invalidations = 0, active = true, changed, resume;
  const cleanup = [];
  const stop = startCommunityFreshness({
    check: () => checks++, invalidate: () => invalidations++, isActive: () => active, pollMs: 60000,
    connect: (callback) => { changed = callback; return () => cleanup.push('realtime'); },
    onResume: (callback) => { resume = callback; return () => cleanup.push('resume'); },
  });
  assert.equal(checks, 1);
  changed(); changed();
  t.mock.timers.tick(349); assert.equal(invalidations, 0);
  t.mock.timers.tick(1); assert.equal(invalidations, 1);
  active = false; changed(); t.mock.timers.tick(60000);
  assert.equal(checks, 1); assert.equal(invalidations, 1);
  active = true; resume(); assert.equal(invalidations, 2);
  t.mock.timers.tick(60000); assert.equal(checks, 2);
  stop();
  t.mock.timers.tick(60000); assert.equal(checks, 2);
  assert.deepEqual(cleanup.sort(), ['realtime', 'resume']);
});

test('accepting a friend notifies Community only after a successful save', async () => {
  let error = null;
  const builder = { select: () => builder, eq: () => builder,
    maybeSingle: async () => ({ data: { id: 'request', to_user_id: 'me', status: 'pending' }, error: null }),
    update: () => builder, then: (resolve) => resolve({ error }) };
  const friends = load('../src/services/social/friendService.ts', { '@/src/lib/supabase': { supabase: { from: () => builder } }, '@/src/utils/displayName': names });
  const changes = [];
  const stop = friends.subscribeToFriendChanges((id) => changes.push(id));
  assert.equal((await friends.acceptFriendRequest('request', 'me')).ok, true);
  assert.deepEqual(changes, ['me']);
  error = Error('offline');
  assert.equal((await friends.acceptFriendRequest('request', 'me')).ok, false);
  assert.deepEqual(changes, ['me']);
  stop();
});
