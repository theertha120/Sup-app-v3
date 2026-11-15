const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
function load(relative) {
  const filename = path.resolve(__dirname, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Date, require: name => load(path.relative(__dirname, path.resolve(path.dirname(filename), name + '.ts'))) });
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
