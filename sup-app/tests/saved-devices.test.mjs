import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the actual account guard, load effect and save callback from setup.
const source = ts.createSourceFile('sensor-setup.tsx', readFileSync(new URL('../app/sensor-setup.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect, save;
const ownerStatements = [];
function visit(node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d =>
    ['savedDeviceOwnerRef', 'savedDeviceOwner', 'ownsSavedDevices'].includes(d.name.getText(source)))) ownerStatements.push(node.getText(source));
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'savedDeviceOwnerRef.current.userId !== userId') ownerStatements.push(node.getText(source));
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('const [topRaw, bottomRaw]')) effect = node.arguments[0].getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'saveDevice') save = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(effect && save && ownerStatements.length === 4);
const js = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022 });
const renderOwner = new Function('useRef', 'userId', js(ownerStatements.join('\n') + '\nreturn { savedDeviceOwnerRef, savedDeviceOwner, ownsSavedDevices };'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const device = id => ({ id, name: id });
function fixture() {
  let ref;
  let top = null, bottom = null;
  const stored = new Map();
  const reads = new Map();
  let pendingWrite;
  let cleanup;
  const storage = {
    getItem: key => reads.get(key)?.promise ?? Promise.resolve(stored.get(key) ?? null),
    setItem: async (key, value) => { stored.set(key, value); await pendingWrite?.promise; },
  };
  function render(userId) {
    const owner = renderOwner(initial => ref ??= { current: initial }, userId);
    const deps = {
      ...owner, userId, AsyncStorage: storage,
      storageKey: (slot, id) => `${id}:${slot}`,
      setSavedTop: value => { top = value; }, setSavedBottom: value => { bottom = value; },
      makeDisplayName: slot => `${userId}_${slot}`,
    };
    const compile = expression => new Function(...Object.keys(deps), js(`return (${expression});`))(...Object.values(deps));
    return { load: compile(effect), save: compile(save) };
  }
  return {
    stored, reads, render,
    switch(userId) { const account = render(userId); cleanup?.(); cleanup = account.load(); return account; },
    unmount() { cleanup?.(); },
    state: () => [top, bottom],
    delayWrite() { pendingWrite = deferred(); return pendingWrite; },
  };
}

test('switching to an empty account or signing out clears the previous saved devices', async () => {
  const f = fixture();
  f.stored.set('a:top', JSON.stringify(device('a-top')));
  f.stored.set('a:bottom', JSON.stringify(device('a-bottom')));
  f.switch('a'); await settle();
  assert.deepEqual(f.state().map(d => d.id), ['a-top', 'a-bottom']);
  f.switch('b');
  assert.deepEqual(f.state(), [null, null]);
  await settle();
  assert.deepEqual(f.state(), [null, null]);
  f.switch(null); await settle();
  assert.deepEqual(f.state(), [null, null]);
  assert.ok(f.stored.has('a:top')); // Keep A's devices for their next login.
});

test('a delayed old load cannot overwrite the new account', async () => {
  const f = fixture();
  const read = deferred(); f.reads.set('a:top', read);
  f.switch('a');
  f.stored.set('b:top', JSON.stringify(device('b-top')));
  f.switch('b'); await settle();
  read.resolve(JSON.stringify(device('a-top'))); await settle();
  assert.equal(f.state()[0].id, 'b-top');
});

test('a pending save stays in its own storage and cannot overwrite the next account', async () => {
  const f = fixture();
  const a = f.switch('a'); await settle();
  const write = f.delayWrite();
  const saving = a.save('top', device('a-top'));
  f.stored.set('b:top', JSON.stringify(device('b-top')));
  f.switch('b'); await settle();
  write.resolve(); await saving;
  assert.equal(f.state()[0].id, 'b-top');
  assert.equal(JSON.parse(f.stored.get('a:top')).id, 'a-top');
  assert.equal(JSON.parse(f.stored.get('b:top')).id, 'b-top');
});

test('old connection callbacks cannot save after A to B to A or after unmount', async () => {
  const f = fixture();
  const oldA = f.switch('a'); await settle();
  f.switch('b'); f.switch('a'); await settle();
  await oldA.save('top', device('stale'));
  assert.equal(f.stored.has('a:top'), false);
  const current = f.switch('a'); await settle();
  f.unmount();
  await current.save('bottom', device('unmounted'));
  assert.equal(f.stored.has('a:bottom'), false);
});

test('current account saves still update the screen normally', async () => {
  const f = fixture();
  const a = f.switch('a'); await settle();
  await a.save('top', device('top'));
  await a.save('bottom', device('bottom'));
  assert.deepEqual(f.state().map(d => d.id), ['top', 'bottom']);
});
