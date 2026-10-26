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
