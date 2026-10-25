import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the production modules without a native device or database.
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
const { buildStatsPage, statsPageWindow, statsPageCount } = load('../src/services/stats/statsPages.ts', { '../../lib/dateKey': dates });
const { StatsHistoryStore, STATS_STALE_MS, statsWindowKey } = load('../src/services/stats/statsHistoryStore.ts');
const today = new Date(2026, 9, 31, 12);
const window = { start: '2026-10-25', end: '2026-10-31' };
const row = (date, score = 80, minutes = 10) => ({ date, supScore: score, totalDeskMs: minutes * 60000, stateTotals: { upright: minutes * 60000 } });
function fixture(fetchWindow = async () => [row('2026-10-31')]) {
  let now = 1000;
  const requests = [];
  const store = new StatsHistoryStore({
    fetchWindow: (start, end, signal) => { requests.push([start, end]); return fetchWindow(start, end, signal); },
    fetchEarliest: async () => '2020-01-01',
  }, () => {}, () => now);
  return { store, requests, advance: (ms) => { now += ms; } };
}

test('month windows handle the 31st and leap day', () => {
  assert.deepEqual(statsPageWindow('month', 1, today), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(statsPageWindow('month', 1, new Date(2024, 2, 31)), { start: '2024-02-01', end: '2024-02-29' });
  const page = buildStatsPage([row('2026-09-30')], 'month', 1, today);
  assert.equal(page.startDate, '1 sep');
  assert.equal(page.endDate, '30 sep');
  assert.deepEqual(page.hasData, [false, false, false, true]);
});

test('rolling weekday labels and oldest-page boundary agree with dates', () => {
  const page = buildStatsPage([row('2026-10-25', 60), row('2026-10-31', 90)], 'week', 0, today);
  assert.deepEqual(page.labels, ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  assert.deepEqual(page.scores, [60, 0, 0, 0, 0, 0, 90]);
  assert.equal(statsPageCount('2026-10-24', 'week', today), 2);
  assert.equal(statsPageCount('2026-10-25', 'week', today), 1);
});

test('old history is navigable without preparing every page', () => {
  assert.equal(statsPageCount('2020-01-01', 'year', today), 7);
  assert.equal(statsPageCount('2020-01-01', 'month', today), 82);
  assert.equal(statsPageCount(null, 'week', today), 1);
  assert.equal(statsPageCount('2027-01-01', 'week', today), 1);
});

test('calendar windows survive daylight saving and year boundaries', () => {
  for (const now of [new Date(2026, 2, 9, 12), new Date(2026, 10, 2, 12), new Date(2026, 0, 2, 12)]) {
    const bounds = statsPageWindow('week', 0, now);
    assert.equal(dates.addDaysToDateKey(bounds.start, 6), bounds.end);
    assert.equal(statsPageCount(dates.addDaysToDateKey(bounds.end, -7), 'week', now), 2);
  }
});

test('month/year aggregation preserves means, durations and posture totals', () => {
  const rows = [row('2026-10-01', 60, 5), row('2026-10-07', 80, 15), row('2026-10-08', 90, 20)];
  const month = buildStatsPage(rows, 'month', 0, today);
  assert.deepEqual(month.scores, [70, 90, 0, 0]);
  assert.deepEqual(month.sessionMins, [20, 20, 0, 0]);
  assert.equal(month.stateTotals.upright, 40 * 60000);
  const year = buildStatsPage(rows, 'year', 0, today);
  assert.equal(year.scores[9], 77);
  assert.equal(year.sessionMins[9], 40);
});

test('loading is lazy and concurrent chart requests are shared', async () => {
  const { store, requests } = fixture();
  assert.equal(requests.length, 0);
  await Promise.all([store.ensureWindow(window), store.ensureWindow(window), store.ensureWindow(window)]);
  assert.deepEqual(requests, [[window.start, window.end]]);
  assert.equal(store.state.pending, 0);
});

test('fresh windows are reused and stale refreshes retain displayed data', async () => {
  let resolve;
  let calls = 0;
  const { store, requests, advance } = fixture(() => ++calls === 1 ? Promise.resolve([row('2026-10-31')]) : new Promise((done) => { resolve = done; }));
  await store.ensureWindow(window);
  await store.ensureWindow(window);
  assert.equal(requests.length, 1);
  advance(STATS_STALE_MS);
  const request = store.ensureWindow(window);
  await Promise.resolve();
  assert.equal(store.state.windows[statsWindowKey(window)].rows[0].supScore, 80);
  resolve([row('2026-10-31', 95)]);
  await request;
  assert.equal(store.state.windows[statsWindowKey(window)].rows[0].supScore, 95);
});

test('failed refreshes preserve results and can be retried', async () => {
  let fail = false;
  const { store } = fixture(async () => { if (fail) throw new Error('offline'); return [row('2026-10-31')]; });
  await store.ensureWindow(window);
  fail = true;
  await store.refresh();
  assert.equal(store.state.windows[statsWindowKey(window)].rows[0].supScore, 80);
  assert.match(store.state.error, /couldn’t update/);
  assert.equal(store.state.pending, 0);
  fail = false;
  await store.refresh();
  assert.equal(store.state.error, null);
});

test('successful empty periods are cached', async () => {
  const { store, requests } = fixture(async () => []);
  await store.ensureWindow(window);
  await store.ensureWindow(window);
  assert.deepEqual(store.state.windows[statsWindowKey(window)].rows, []);
  assert.equal(requests.length, 1);
});

test('old-account requests cannot populate a disposed cache or another account', async () => {
  let resolve;
  const { store } = fixture(() => new Promise((done) => { resolve = done; }));
  const request = store.ensureWindow(window);
  await Promise.resolve();
  store.dispose();
  const next = fixture().store;
  resolve([row('2026-10-31')]);
  await request;
  assert.deepEqual(store.state.windows, {});
  assert.deepEqual(next.state.windows, {});
});

test('refresh requests each visited window once without loading full history', async () => {
  const { store, requests } = fixture();
  await store.ensureWindow(window);
  await store.refresh();
  assert.equal(requests.length, 2);
  assert.equal(store.state.earliest, '2020-01-01');
});

test('browsing many years keeps memory bounded', async () => {
  const { store } = fixture(async () => []);
  for (let year = 1980; year < 2026; year++) await store.ensureWindow({ start: `${year}-01-01`, end: `${year}-12-31` });
  assert.equal(Object.keys(store.state.windows).length, 24);
  assert.ok(store.state.windows['2025-01-01:2025-12-31']);
});

const { watchStatsFreshness } = load('../src/services/stats/statsFreshness.ts');
test('focus refreshes once, polls only in foreground, checks resume and cleans up', () => {
  let checkCount = 0;
  let active = true;
  let tick;
  let appState;
  let delay;
  const cleanup = [];
  const stop = watchStatsFreshness({
    check: () => { checkCount++; }, isActive: () => active,
    watch: () => () => cleanup.push('realtime'),
    subscribe: (callback) => { appState = callback; return () => cleanup.push('appstate'); },
    intervalMs: STATS_STALE_MS,
    schedule: (callback, ms) => { tick = callback; delay = ms; return 42; },
    cancel: (id) => { assert.equal(id, 42); cleanup.push('timer'); },
  });
  assert.equal(checkCount, 1);
  assert.equal(delay, 60000);
  tick();
  assert.equal(checkCount, 2);
  active = false;
  tick();
  appState('background');
  assert.equal(checkCount, 2);
  active = true;
  appState('active');
  assert.equal(checkCount, 3);
  stop();
  assert.deepEqual(cleanup.sort(), ['appstate', 'realtime', 'timer']);
});

test('automatic checks respect cache age; explicit refresh bypasses it', async () => {
  const { store, requests, advance } = fixture();
  await store.ensureWindow(window);
  await store.refresh(false);
  assert.equal(requests.length, 1);
  advance(STATS_STALE_MS);
  await store.refresh(false);
  assert.equal(requests.length, 2);
  await store.refresh();
  assert.equal(requests.length, 3);
});

test('freshness refreshes visible windows rather than previously browsed history', async () => {
  const { store, requests } = fixture();
  const older = { start: '2020-01-01', end: '2020-12-31' };
  await store.ensureWindow(older);
  await store.ensureWindow(window);
  const stop = store.observe('score-card', [window]);
  store.observe('session-card', [window]);
  await store.refresh();
  assert.deepEqual(requests, [[older.start, older.end], [window.start, window.end], [window.start, window.end]]);
  stop();
});

test('initial failures can recover and discovery does not block the visible period', async () => {
  let failed = true;
  const store = new StatsHistoryStore({
    fetchWindow: async () => { if (failed) throw Error('offline'); return []; },
    fetchEarliest: async () => { throw Error('offline'); },
  }, () => {});
  await store.ensureWindow(window);
  assert.equal(store.state.windows[statsWindowKey(window)], undefined);
  failed = false;
  await store.refresh();
  assert.deepEqual(store.state.windows[statsWindowKey(window)].rows, []);
  assert.match(store.state.error, /couldn’t update/); // earliest query still failed
});

test('carousel renders neighbours without processing thousands of historical pages', () => {
  const source = ts.createSourceFile('stats.tsx', readFileSync(new URL('../app/(tabs)/stats.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const swipe = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'SwipeCard');
  assert.ok(swipe);
  const prepared = new Set();
  const fetched = [];
  const dependencies = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useState: () => [400, () => {}], useId: () => 'card', useRef: (current) => ({ current }),
    useEffect: (callback) => callback(),
    Animated: { Value: class { setValue() {} }, View: 'AnimatedView' },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    View: 'View', Text: 'Text', styles: {}, swipeStyles: {}, PAGE_STRIDE: 300,
  };
  const js = ts.transpile(swipe.getText(source), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 });
  const SwipeCard = new Function(...Object.keys(dependencies), `${js}; return SwipeCard;`)(...Object.values(dependencies));
  const tree = SwipeCard({
    pages: { length: 10000, get: (index) => { prepared.add(index); return { startDate: 'start', endDate: 'end' }; },
      ensure: (index) => fetched.push(index), observe: () => () => {} }, renderPage: () => null,
  });
  assert.deepEqual([...prepared].sort(), [399, 400, 401, 402]);
  assert.deepEqual(fetched, [399, 400, 401]);
  const row = tree.children[1].children[0];
  assert.equal(row.children[0].length, 3);
  assert.equal(row.props.style[1].marginLeft, 399 * 300);
});

test('stats query selects only chart columns and propagates database failures', async () => {
  const calls = [];
  let error = null;
  const query = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.then = (resolve) => resolve({ data: [{ date: '2026-10-31', sup_score: 90, total_desk_ms: 60000, state_totals: { upright: 60000 } }], error });
  const { fetchStatsWindow } = load('../src/services/stats/statsHistoryService.ts', {
    '@/src/lib/supabase': { supabase: { from: () => query } },
  });
  const rows = await fetchStatsWindow('user-a', window.start, window.end);
  assert.equal(rows[0].supScore, 90);
  assert.deepEqual(calls[0], ['select', 'date, sup_score, total_desk_ms, total_minutes, state_totals']);
  assert.ok(calls.some((call) => JSON.stringify(call) === JSON.stringify(['eq', 'user_id', 'user-a'])));
  error = new Error('offline');
  await assert.rejects(fetchStatsWindow('user-a', window.start, window.end), /offline/);
});

test('a hung request times out, releases the loading lock and cannot overwrite a retry', async () => {
  let late;
  let signal;
  let calls = 0;
  const store = new StatsHistoryStore({
    fetchWindow: (_start, _end, requestSignal) => {
      signal = requestSignal;
      return ++calls === 1 ? new Promise((resolve) => { late = resolve; }) : Promise.resolve([row('2026-10-31', 95)]);
    }, fetchEarliest: async () => null,
  }, () => {}, Date.now, 5);
  await store.ensureWindow(window);
  assert.equal(signal.aborted, true);
  assert.equal(store.state.pending, 0);
  assert.match(store.state.error, /tap refresh/);
  await store.refresh();
  assert.equal(store.state.windows[statsWindowKey(window)].rows[0].supScore, 95);
  late([row('2026-10-31', 10)]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.state.windows[statsWindowKey(window)].rows[0].supScore, 95);
});

test('a hung earliest-date request does not block charts or later refreshes', async () => {
  let calls = 0;
  const store = new StatsHistoryStore({
    fetchWindow: async () => [row('2026-10-31')],
    fetchEarliest: () => ++calls === 1 ? new Promise(() => {}) : Promise.resolve('2020-01-01'),
  }, () => {}, Date.now, 5);
  await Promise.all([store.ensureEarliest(), store.ensureWindow(window)]);
  assert.equal(store.state.pending, 0);
  assert.equal(store.state.windows[statsWindowKey(window)].rows.length, 1);
  await store.refresh();
  assert.equal(store.state.earliest, '2020-01-01');
});

test('Stats renders its header and cards even while fonts are pending or failed', () => {
  const source = ts.createSourceFile('stats.tsx', readFileSync(new URL('../app/(tabs)/stats.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'StatsScreen');
  const dependencies = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect: () => {},
    useCallback: (fn) => fn, useMemo: (fn) => fn(), useFocusEffect: () => {}, require: () => 1,
    useAuth: () => ({ isAuthenticated: true, userId: 'me' }), useTutorial: () => ({ tutorialStep: null }),
    useSafeAreaInsets: () => ({ bottom: 0 }), useFonts: () => [false, new Error('font unavailable')],
    usePostureHistory: () => ({ windows: {}, earliest: null, pending: 0, error: null,
      ensureWindow: () => {}, observe: () => () => {}, ensureFresh: () => {}, watch: () => () => {} }),
    toLocalDateKey: () => '2026-10-31', statsPageCount, statsPageWindow, buildStatsPage, statsWindowKey,
    NAV_BAR_HEIGHT: 72, NAV_BOTTOM_OFFSET: 25,
    StatsFontsContext: { Provider: 'Fonts' }, View: 'View', ScrollView: 'ScrollView', Text: 'Text',
    BackgroundBlobs: 'BackgroundBlobs', HeaderBar: 'HeaderBar', RangeSelector: 'RangeSelector',
    RefreshButton: 'RefreshButton', InfoButton: 'InfoButton', SwipeCard: 'SwipeCard', InfoModal: 'InfoModal',
    styles: {}, PRIMARY_TEXT: '#000', STATS_METRIC_INFO: {},
  };
  const js = ts.transpile(screen.getText(source).replace('export default ', ''), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 });
  const Screen = new Function(...Object.keys(dependencies), `${js}; return StatsScreen;`)(...Object.values(dependencies));
  const tree = Screen();
  assert.equal(tree.type, 'Fonts');
  assert.equal(tree.props.value, false);
  const content = tree.children[0].children.find((node) => node?.type === 'ScrollView');
  assert.ok(content);
  assert.ok(content.children.some((node) => node?.type === 'HeaderBar'));
  assert.ok(content.children.some((node) => node?.type === 'RangeSelector'));
});

test('Stats text uses a native font fallback until the custom fonts are ready', () => {
  const source = ts.createSourceFile('stats.tsx', readFileSync(new URL('../app/(tabs)/stats.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'Text');
  const dependencies = { React: { createElement: (type, props) => ({ type, props }) },
    useContext: () => false, StatsFontsContext: {}, StyleSheet: { flatten: (style) => style },
    Platform: { OS: 'ios' }, NativeText: 'NativeText' };
  const js = ts.transpile(component.getText(source), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 });
  const Text = new Function(...Object.keys(dependencies), `${js}; return Text;`)(...Object.values(dependencies));
  const text = Text({ style: { fontFamily: 'Agrandir-GrandHeavy' }, children: 'your stats' });
  assert.equal(text.props.style[1].fontFamily, 'System');
  assert.equal(text.props.style[1].fontWeight, '700');
});

test('both stats database queries receive the request cancellation signal', async () => {
  const received = [];
  const query = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) query[method] = () => query;
  query.abortSignal = (signal) => { received.push(signal); return query; };
  query.maybeSingle = async () => ({ data: { date: '2026-10-01' }, error: null });
  query.then = (resolve) => resolve({ data: [], error: null });
  const source = load('../src/services/stats/statsHistoryService.ts', { '@/src/lib/supabase': { supabase: { from: () => query } } });
  const controller = new AbortController();
  await source.fetchStatsWindow('me', window.start, window.end, controller.signal);
  await source.fetchEarliestStatsDate('me', controller.signal);
  assert.deepEqual(received, [controller.signal, controller.signal]);
});

test('Stats has no transition opacity while the other tab settings stay unchanged', () => {
  const source = ts.createSourceFile('_layout.tsx', readFileSync(new URL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const layout = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'TabsLayout');
  const dependencies = { React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Tabs: { Screen: 'Screen' }, Platform: { select: (options) => options.ios }, colours: {} };
  const js = ts.transpile(layout.getText(source).replace('export default ', ''), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 });
  const Layout = new Function(...Object.keys(dependencies), `${js}; return TabsLayout;`)(...Object.values(dependencies));
  const tree = Layout();
  assert.equal(tree.props.screenOptions.animation, 'shift');
  assert.equal(tree.children.find((screen) => screen.props.name === 'stats').props.options.animation, 'none');
  assert.equal(tree.children.find((screen) => screen.props.name === 'desk').props.options.animation, undefined);
});
