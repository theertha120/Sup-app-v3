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
    fetchWindow: (...args) => { requests.push(args); return fetchWindow(...args); },
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
