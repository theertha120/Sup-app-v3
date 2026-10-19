import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the actual button callback without a device or live sensor session.
const source = ts.createSourceFile('TutorialActions.tsx', readFileSync(new URL('../src/components/onboarding/TutorialActions.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSkip') callback = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const callbackJs = ts.transpile(`const handleSkip = ${callback};`, { target: ts.ScriptTarget.ES2022 });

function skip(tutorialStep, options = {}) {
  const calls = [];
  const deps = {
    tutorialStep,
    skipDisabled: options.disabled ?? false,
    onBeforeSkip: options.modal ? () => calls.push(['close-modal']) : undefined,
    setTutorialStep: step => calls.push(['step', step]),
    dismissTutorial: () => calls.push(['dismiss']),
    router: {
      push: route => calls.push(['push', route]),
      replace: route => calls.push(['replace', route]),
    },
  };
  new Function(...Object.keys(deps), `${callbackJs}; handleSkip();`)(...Object.values(deps));
  return calls;
}

// Every page is reached from the header or navbar: skipping shows the
// "go to" prompt and the user navigates themselves.
for (const [steps, prompt] of [
  [['goals-tip', 'data-tip'], 'go-daily-tip'],
  [['snapshot-tip', 'snapshot-tip-stats'], 'go-settings-tip'],
  [['settings-tip', 'coaching-tip'], 'go-sensor-tip'],
  [['figure-tip', 'supdate-tip', 'end-session-tip'], 'go-stats-tip'],
  [['stats-tip'], 'go-community-tip'],
]) {
  test(`every tip on ${steps[0]} skips to the ${prompt} prompt without navigating`, () => {
    for (const step of steps) {
      assert.deepEqual(skip(step), [['step', prompt]]);
    }
  });
}

test('"go to" prompts have nothing to skip', () => {
  for (const step of ['go-home-tip', 'go-daily-tip', 'go-settings-tip', 'go-sensor-tip', 'go-desk-tip', 'go-stats-tip', 'go-community-tip']) {
    assert.deepEqual(skip(step), []);
  }
});

test('skipping Community still shows the final start-exploring message', () => {
  assert.deepEqual(skip('community-tip'), [['step', 'add-friends-tip']]);
});

test('skipping the final message finishes the tutorial without navigating', () => {
  assert.deepEqual(skip('add-friends-tip'), [['dismiss']]);
});

test('closes coaching setup before moving on and cannot skip during a save', () => {
  assert.deepEqual(skip('coaching-tip', { modal: true }), [
    ['close-modal'], ['step', 'go-sensor-tip'],
  ]);
  assert.deepEqual(skip('coaching-tip', { modal: true, disabled: true }), []);
});

test('inactive tutorials and sensor-specific steps do not navigate', () => {
  for (const step of [null, 'connect-tip', 'calibrate-tip']) assert.deepEqual(skip(step), []);
});
