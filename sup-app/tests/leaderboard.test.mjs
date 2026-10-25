import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const js = ts.transpile(readFileSync(new URL(path, import.meta.url), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
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
    { from_user_id: 'me', to_user_id: null },
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

test('full leaderboard passes rows to a virtual list without rendering them all', () => {
  const source = ts.createSourceFile('leaderboard-full.tsx', readFileSync(new URL('../app/leaderboard-full.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'FullLeaderboardScreen');
  assert.ok(screen);
  const entries = Array.from({ length: 10000 }, (_, i) => entry(i));
  let more = 0;
  const dependencies = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect: (fn) => fn(), useCallback: (fn) => fn,
    useAuth: () => ({ userId: 'u9999' }), useLocalSearchParams: () => ({}),
    require: () => 1,
    useFonts: () => [false, new Error('font unavailable')], useFocusEffect: (fn) => fn(),
    useLeaderboard: () => ({ entries, total: 12000, isLoading: false, isLoadingMore: false, isRefreshing: false,
      friendCount: 0, error: null, refresh: () => {}, loadMore: () => { more++; } }),
    Animated: { Value: class { setValue() {} }, timing: () => ({ start() {} }), View: 'AnimatedView' },
    View: 'View', Text: 'Text', FlatList: 'FlatList', PressFeedback: 'PressFeedback', Ionicons: 'Ionicons',
    HeaderBar: 'HeaderBar', RefreshButton: 'RefreshButton', BackgroundBlobs: 'BackgroundBlobs',
    LeaderboardFontsContext: { Provider: 'Fonts' }, LeaderboardRow: 'LeaderboardRow', styles: {}, PRIMARY_TEXT: '#000',
    PERIODS: [{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }],
  };
  const js = ts.transpile(screen.getText(source).replace("export default ", ""), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 });
  const Screen = new Function(...Object.keys(dependencies), `${js}; return FullLeaderboardScreen;`)(...Object.values(dependencies));
  const tree = Screen();
  assert.equal(tree.type, 'Fonts');
  assert.equal(tree.props.value, false);
  assert.equal(tree.children[0].props.style.opacity, undefined);
  const list = tree.children[0].children.find((child) => child.type === 'FlatList');
  assert.ok(list);
  assert.equal(list.props.data, entries);
  assert.equal(list.props.initialNumToRender, 10);
  assert.equal(list.props.maxToRenderPerBatch, 10);
  assert.equal(list.children.length, 0);
  assert.equal(list.props.renderItem({ item: entries[9999] }).props.isCurrentUser, true);
  list.props.onEndReached();
  assert.equal(more, 1);
});

test('concurrent fallback scopes share the compact source snapshot', async () => {
  const db = fallbackDatabase();
  const source = service(db.supabase).createLeaderboardSource('u0000');
  const [everyone, friends] = await Promise.all([
    source(query, 0, 5), source({ ...query, scope: 'friends' }, 0, 5),
  ]);
  assert.equal(everyone.total, 1501);
  assert.equal(friends.total, 2);
  // One profiles scan, including the final empty page, despite two views.
  assert.equal(db.calls.filter((call) => call.table === 'profiles').length, Math.ceil(1501 / 137) + 1);
});

test('the server function is adopted after it becomes available', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const db = fallbackDatabase();
  const source = service(db.supabase).createLeaderboardSource('u0000');
  await source(query, 0, 5);
  const reads = db.calls.length;
  db.supabase.rpc = async () => ({ data: { entries: [], own_entry: null, total: 0, friend_count: 0 }, error: null });
  now += api.LEADERBOARD_STALE_MS;
  const result = await source(query, 0, 5);
  assert.equal(result.total, 0);
  assert.equal(db.calls.length, reads);
});

test('a successful empty leaderboard is cached without repeated loading', async () => {
  const { store, calls } = fixture(0);
  await store.ensure(query, 50);
  await store.ensure(query, 50);
  await store.loadMore(query);
  assert.equal(calls.length, 1);
  assert.equal(store.get(query).isLoading, false);
  assert.equal(store.get(query).lastUpdatedAt, 1000);
});

test('Community mounts a visible header and loading state even before fonts load', () => {
  const source = ts.createSourceFile('leaderboard.tsx', readFileSync(new URL('../app/(tabs)/leaderboard.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'LeaderboardScreen');
  const dependencies = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect: () => {},
    useAuth: () => ({ userId: 'me' }), useRouter: () => ({}), useTutorial: () => ({ tutorialStep: null }),
    useSafeAreaInsets: () => ({ bottom: 0 }), require: () => 1, useFonts: () => [false],
    useLeaderboard: () => ({ entries: [], ownEntry: null, friendCount: 0, error: null, isLoading: true }),
    LeaderboardFontsContext: { Provider: 'Fonts' }, View: 'View', ScrollView: 'ScrollView', Text: 'Text', PressFeedback: 'PressFeedback',
    BackgroundBlobs: 'BackgroundBlobs', HeaderBar: 'HeaderBar', RefreshButton: 'RefreshButton',
    styles: {}, NAV_BAR_HEIGHT: 72, NAV_BOTTOM_OFFSET: 25, SUMMARY_PERIOD: 'day',
  };
  const js = ts.transpile(screen.getText(source).replace('export default ', ''), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 });
  const Screen = new Function(...Object.keys(dependencies), `${js}; return LeaderboardScreen;`)(...Object.values(dependencies));
  const tree = Screen();
  assert.equal(tree.type, 'Fonts');
  assert.equal(tree.props.value, false);
  assert.equal(tree.children[0].props.style.opacity, undefined);
  const content = tree.children[0].children.find((node) => node?.type === 'ScrollView');
  assert.ok(content.children.some((node) => node?.type === 'HeaderBar'));
  assert.ok(content.children.some((node) => node?.type === 'Text' && node.children.includes('Loading leaderboard…')));
});

test('hung leaderboard requests release the loading lock and ignore late responses', async () => {
  let late;
  let signal;
  let calls = 0;
  const store = new LeaderboardStore((_query, _offset, _limit, _force, requestSignal) => {
    signal = requestSignal;
    return ++calls === 1 ? new Promise((resolve) => { late = resolve; })
      : Promise.resolve({ entries: [entry(1)], ownEntry: null, total: 1, friendCount: 0 });
  }, () => {}, Date.now, 5);
  await store.ensure(query, 5);
  assert.equal(signal.aborted, true);
  assert.equal(store.get(query).isLoading, false);
  assert.ok(store.get(query).error);
  await store.ensure(query, 5);
  assert.equal(store.get(query).entries[0].user.id, 'u1');
  late({ entries: [entry(0)], ownEntry: null, total: 1, friendCount: 0 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.get(query).entries[0].user.id, 'u1');
});

test('timed-out next pages keep existing rows available', async () => {
  const store = new LeaderboardStore(async (_query, offset) => offset ? new Promise(() => {})
    : { entries: [entry(0)], ownEntry: null, total: 2, friendCount: 0 }, () => {}, Date.now, 5);
  await store.ensure(query, 1);
  await store.loadMore(query);
  assert.equal(store.get(query).entries.length, 1);
  assert.equal(store.get(query).isLoadingMore, false);
  assert.ok(store.get(query).error);
});

test('cancellation is forwarded to RPC and aborted fallback snapshots can be replaced', async () => {
  let hang = true;
  let seenSignal;
  const database = {
    rpc: () => ({ abortSignal(signal) { seenSignal = signal; return this; }, then(resolve) { resolve({ error: { code: 'PGRST202' } }); } }),
    from: () => {
      const builder = {};
      for (const method of ['select', 'eq', 'or', 'gte', 'lte', 'order', 'range']) builder[method] = () => builder;
      builder.abortSignal = () => builder;
      builder.then = (resolve) => { if (!hang) resolve({ data: [], error: null }); };
      return builder;
    },
  };
  const source = service(database).createLeaderboardSource('me');
  const store = new LeaderboardStore(source, () => {}, Date.now, 5);
  await store.ensure(query, 5);
  assert.equal(seenSignal.aborted, true);
  hang = false;
  await store.ensure(query, 5);
  assert.equal(store.get(query).error, null);
  assert.equal(store.get(query).total, 0);
  assert.equal(store.get(query).isLoading, false);
});

test('leaderboard labels remain readable when custom fonts are unavailable', () => {
  const { LeaderboardText } = load('../src/components/ui/LeaderboardText.tsx', {
    react: { default: { createElement: (type, props) => ({ type, props }) }, createContext: () => ({}), useContext: () => false },
    'react-native': { Platform: { OS: 'ios' }, StyleSheet: { flatten: (style) => style }, Text: 'NativeText' },
  });
  const text = LeaderboardText({ children: 'Leaderboard', style: { fontFamily: 'Agrandir-GrandHeavy' } });
  assert.equal(text.props.style[1].fontFamily, 'System');
  assert.equal(text.props.style[1].fontWeight, '700');
});

test('leaderboard tab visibility does not rely on an opacity transition', () => {
  const source = ts.createSourceFile('_layout.tsx', readFileSync(new URL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const layout = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'TabsLayout');
  const dependencies = { React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Tabs: { Screen: 'Screen' }, Platform: { select: (options) => options.ios }, colours: {} };
  const js = ts.transpile(layout.getText(source).replace('export default ', ''), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 });
  const Layout = new Function(...Object.keys(dependencies), `${js}; return TabsLayout;`)(...Object.values(dependencies));
  const tree = Layout();
  assert.equal(tree.children.find((node) => node.props.name === 'leaderboard').props.options.animation, 'none');
  assert.equal(tree.children.find((node) => node.props.name === 'desk').props.options.animation, undefined);
});
