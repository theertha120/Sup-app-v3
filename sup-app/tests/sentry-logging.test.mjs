import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
function load(path, dependencies, extras = {}) {
  const js = ts.transpile(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(extras), js)(name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(extras));
  return module.exports;
}
function fixture() {
  const reports = [];
  let now = 0;
  class Clock extends Date { static now() { return now; } }
  const sentry = load('../src/lib/sentry.ts', {
    '@sentry/react-native': { captureException: (...args) => reports.push(args) },
  }, { Date: Clock });
  let response = () => ({ data: null, error: null });
  const supabase = {
    from(table) {
      let action;
      const query = {};
      for (const name of ['select', 'insert', 'update', 'upsert', 'eq', 'gte', 'lt', 'order', 'limit', 'maybeSingle', 'single']) {
        query[name] = () => { if (['insert', 'update', 'upsert'].includes(name) || !action) action = name; return query; };
      }
      query.then = (resolve, reject) => Promise.resolve().then(() => response(table, action)).then(resolve, reject);
      return query;
    },
  };
  const posture = load('../src/services/posture/postureSyncService.ts', {
    '@/src/lib/supabase': { supabase }, '@/src/lib/sentry': sentry,
    '@/src/lib/dateKey': {
      toLocalDateKey: () => '2026-10-26', addDaysToDateKey() {},
      localDayRange: () => ({ start: new Date(0), end: new Date(86400000) }),
    },
  });
  return { reports, sentry, posture, respond: fn => { response = fn; }, time: value => { now = value; } };
}
const aggregates = { totalDurationMs: 5000, stateTotals: { upright: 5000 } };
const dbError = { message: 'write denied', code: '42501', details: 'policy', hint: null };

test('Sentry wraps database errors and keeps operation context and existing network severity', () => {
  const f = fixture();
  f.sentry.captureError(dbError, 'posture-session-end', { sessionId: 's1' });
  const [error, event] = f.reports[0];
  assert.ok(error instanceof Error);
  assert.equal(error.message, dbError.message);
  assert.equal(event.tags.context, 'posture-session-end');
  assert.equal(event.extra.code, '42501');
  f.sentry.captureError(new Error('Network request failed'), 'posture-session-start');
  assert.equal(f.reports[1][1].level, 'warning');
});

test('periodic errors are throttled per operation and allowed again after a minute', () => {
  const f = fixture();
  const report = f.sentry.createThrottledErrorReporter();
  report(dbError, 'snapshot');
  f.time(20000); report(dbError, 'snapshot');
  report(dbError, 'local-save');
  assert.equal(f.reports.length, 2);
  f.time(60000); report(dbError, 'snapshot');
  assert.equal(f.reports.length, 3);
});

for (const method of ['endSession', 'snapshotSession']) {
  for (const failure of ['returned', 'thrown']) {
    test(`${method} reports ${failure} failure once and preserves its nonthrowing behaviour`, async () => {
      const f = fixture();
      f.respond(() => { if (failure === 'thrown') throw new Error('storage unreachable'); return { error: dbError }; });
      await f.posture[method]('s1', aggregates);
      assert.equal(f.reports.length, 1);
      assert.equal(f.reports[0][1].tags.context, method === 'endSession' ? 'posture-session-end' : 'posture-session-snapshot');
      assert.deepEqual(Object.keys(f.reports[0][1].extra).filter(k => !['code', 'details', 'hint'].includes(k)), ['sessionId']);
    });
  }
}

test('successful session saves and missing session ids generate no errors', async () => {
  const f = fixture();
  await f.posture.endSession('s1', aggregates);
  await f.posture.snapshotSession('s1', aggregates);
  await f.posture.endSession(null, aggregates);
  await f.posture.snapshotSession(null, aggregates);
  assert.equal(f.reports.length, 0);
});

test('startSession reports an insert failure once and still returns null', async () => {
  const f = fixture();
  f.respond((_table, action) => action === 'insert' ? { error: dbError } : { data: [] });
  assert.equal(await f.posture.startSession('u1'), null);
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0][1].tags.context, 'posture-session-start');
});

test('daily rebuild reports failed queries, upserts and score writes with their stage', async () => {
  for (const stage of ['sessions-read', 'daily-save', 'score-save']) {
    const f = fixture();
    f.respond((table, action) => {
      if (table === 'posture_sessions') return stage === 'sessions-read' ? { error: dbError } : { data: [{ total_duration_ms: 5000, state_totals: { upright: 5000 } }] };
      if (action === 'upsert') return { error: stage === 'daily-save' ? dbError : null };
      if (action === 'update') return { error: stage === 'score-save' ? dbError : null };
      return { data: null };
    });
    await f.posture.rebuildDailyFromSessions('u1', '2026-10-26');
    assert.equal(f.reports.length, 1);
    assert.equal(f.reports[0][1].tags.context, 'posture-daily-rebuild');
    assert.equal(f.reports[0][1].extra.stage, stage);
  }
});

test('BLE connection failure reports slot once, retains disconnected state, and omits device identifiers', async () => {
  const f = fixture();
  const { bleService } = load('../src/services/BLEService.ts', {
    'react-native-ble-plx': { BleManager: class { onStateChange() {} } },
    'react-native': { Platform: { OS: 'ios' }, PermissionsAndroid: {} },
    '../lib/sentry': f.sentry,
  }, { setTimeout: callback => { callback(); }, console: { error() {}, log() {}, warn() {} } });
  const statuses = [];
  bleService.stopScan = () => {};
  bleService.setCallbacks(() => {}, (_slot, status) => statuses.push(status));
  await bleService.connectDevice({ id: 'private-device-id', connect: async () => { throw new Error('connection failed'); } }, 'top');
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0][1].tags.context, 'spot-connect');
  assert.deepEqual(f.reports[0][1].extra, { slot: 'top' });
  assert.equal(statuses.at(-1).connected, false);
});
