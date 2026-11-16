/* global __dirname:readonly */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Date, require: name => mocks[name] ?? load(path.relative(__dirname, path.resolve(path.dirname(filename), name + '.ts'))), Error, Number });
  return exports;
}
const { validateWorkout, formatAmount, repeatWorkout } = load('../src/features/exercise/model.ts');
const workout = () => ({ performed_on: '2026-11-15', back_feeling: 4,
  exercises: [{ name: 'Plank', category: 'strength', unit: 'seconds', values: [30, 30, 30] }] });
const validate = value => validateWorkout(value, '2026-11-15');
test('accepts mixed strength and duration in a workout', () => {
  const input = workout();
  input.exercises.push({ name: 'Yoga', category: 'other', unit: 'minutes', values: [12.5] });
  assert.equal(validate(input), null);
});
test('rejects invalid calendar days and future dates', () => {
  for (const date of ['2026-02-30', '2026-11-16', '2026-13-01', '', '0099-01-01'])
    assert.ok(validate({ ...workout(), performed_on: date }), date);
  assert.equal(validate({ ...workout(), performed_on: '2024-02-29' }), null);
});
test('requires an explicit back rating', () => {
  for (const rating of [0, 6, 1.5, NaN]) assert.ok(validate({ ...workout(), back_feeling: rating }));
});
test('rejects missing names, invalid units and nonpositive or fractional sets', () => {
  for (const patch of [{ name: ' ' }, { unit: 'minutes' }, { values: [] }, { values: [0] },
    { values: [-1] }, { values: [1.5] }, { values: [NaN] }, { values: [Infinity] }, { values: [10001] }]) {
    const input = workout(); Object.assign(input.exercises[0], patch); assert.ok(validate(input));
  }
  assert.ok(validate({ ...workout(), exercises: [] }));
});
test('formats uniform and varying sets without losing amounts', () => {
  assert.equal(formatAmount(workout().exercises[0]), '3 × 30 sec');
  assert.equal(formatAmount({ ...workout().exercises[0], values: [30, 25, 20] }), '30 / 25 / 20 sec');
});
test('log again resets rating, uses today and makes an independent copy', () => {
  const original = workout(); const copy = repeatWorkout(original);
  assert.equal(copy.back_feeling, 0);
  const now = new Date();
  assert.equal(copy.performed_on, `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`);
  copy.exercises[0].values[0] = 90;
  assert.equal(original.exercises[0].values[0], 30);
});

function service(responses) {
  const calls = [];
  const client = { from(table) {
    calls.push(['from', table]);
    const query = {};
    for (const method of ['select', 'eq', 'order', 'range', 'insert', 'update', 'delete', 'single']) {
      query[method] = (...args) => { calls.push([method, ...args]); return query; };
    }
    query.then = (resolve, reject) => Promise.resolve(responses.shift()).then(resolve, reject);
    return query;
  }};
  return { calls, ...load('../src/services/exercise/exerciseLogService.ts', {
    '@/src/lib/supabase': { supabase: client },
    '@/src/features/exercise/model': { validateWorkout: input => validate(input) },
  }) };
}
test('history is account-scoped and loads beyond the first page', async () => {
  const first = Array.from({length: 500}, (_, id) => ({id: String(id)}));
  const api = service([{ data: first, error: null }, { data: [{id: '500'}], error: null }]);
  assert.equal((await api.fetchWorkouts('user-a')).length, 501);
  assert.equal(api.calls.filter(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'user-a').length, 2);
  assert.deepEqual(api.calls.filter(call => call[0] === 'range'), [['range', 0, 499], ['range', 500, 999]]);
});
test('create normalizes names and preserves all exercise amounts', async () => {
  const api = service([{ data: { id: 'new' }, error: null }]);
  const input = workout(); input.exercises[0].name = '  Plank  ';
  await api.saveWorkout('user-a', input);
  const payload = api.calls.find(call => call[0] === 'insert')[1];
  assert.equal(payload.user_id, 'user-a');
  assert.equal(payload.exercises[0].name, 'Plank');
  assert.equal(JSON.stringify(payload.exercises[0].values), '[30,30,30]');
});
test('edit and delete constrain both workout id and owner', async () => {
  for (const operation of ['edit', 'delete']) {
    const api = service([{ data: {id: 'existing'}, error: null }]);
    if (operation === 'edit') await api.saveWorkout('user-a', workout(), 'existing');
    else await api.deleteWorkout('user-a', 'existing');
    assert.ok(api.calls.some(call => call[0] === 'eq' && call[1] === 'id' && call[2] === 'existing'));
    assert.ok(api.calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'user-a'));
  }
});
test('invalid workouts never reach storage', async () => {
  const api = service([]);
  await assert.rejects(api.saveWorkout('user-a', {...workout(), back_feeling: 0}));
  assert.equal(api.calls.length, 0);
});
test('load, save and delete errors reach the caller for retry', async () => {
  const failure = new Error('Connection failed');
  for (const operation of ['load', 'save', 'delete']) {
    const api = service([{ data: null, error: failure }]);
    await assert.rejects(operation === 'load' ? api.fetchWorkouts('user-a') : operation === 'save' ? api.saveWorkout('user-a', workout()) : api.deleteWorkout('user-a', 'existing'), /Connection failed/);
  }
});

test('limits allow 30 exercises and 50 sets, but reject excess or multiple activity durations', () => {
  const entry = workout().exercises[0];
  assert.equal(validate({ ...workout(), exercises: Array.from({length: 30}, () => ({...entry, values: Array(50).fill(1)})) }), null);
  assert.ok(validate({ ...workout(), exercises: Array(31).fill(entry) }));
  assert.ok(validate({ ...workout(), exercises: [{ ...entry, values: Array(51).fill(1) }] }));
  assert.ok(validate({ ...workout(), exercises: [{ name: 'Yoga', category: 'other', unit: 'minutes', values: [10, 20] }] }));
});
test('custom exercises enforce name length and category-specific units', () => {
  for (const exercise of [
    {name: 'Side plank', category: 'strength', unit: 'seconds', values: [30]},
    {name: 'Bird dog', category: 'strength', unit: 'reps', values: [10]},
    {name: 'Dance', category: 'other', unit: 'minutes', values: [20.5]},
  ]) assert.equal(validate({...workout(), exercises: [exercise]}), null);
  assert.ok(validate({...workout(), exercises: [{...workout().exercises[0], name: 'x'.repeat(81)}]}));
  assert.ok(validate({...workout(), exercises: [{...workout().exercises[0], category: 'other'}]}));
});
test('an exact full history page is followed by a final empty page without duplicates', async () => {
  const rows = Array.from({length: 500}, (_, id) => ({id: String(id)}));
  const api = service([{data: rows, error: null}, {data: [], error: null}]);
  const result = await api.fetchWorkouts('user-a');
  assert.equal(result.length, 500); assert.equal(new Set(result.map(row => row.id)).size, 500);
});
test('failure on a later history page rejects instead of returning a misleading partial history', async () => {
  const api = service([{data: Array(500).fill({id: 'row'}), error: null}, {data: null, error: Error('lost connection')}]);
  await assert.rejects(api.fetchWorkouts('user-a'), /lost connection/);
});
