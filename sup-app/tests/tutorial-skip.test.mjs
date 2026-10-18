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

for (const [steps, nextStep, method, route] of [
  [['goals-tip', 'data-tip'], 'snapshot-tip', 'push', '/(tabs)/daily'],
  [['snapshot-tip', 'snapshot-tip-stats'], 'settings-tip', 'push', '/settings'],
  [['settings-tip', 'coaching-tip'], 'connect-tip', 'push', '/sensor-setup'],
  [['figure-tip', 'supdate-tip', 'end-session-tip'], 'stats-tip', 'replace', '/(tabs)/stats'],
  [['stats-tip', 'stats-tip-trend', 'stats-tip-session', 'stats-tip-breakdown'], 'community-tip', 'replace', '/(tabs)/leaderboard'],
]) {
  test(`every tip on ${steps[0]} skips to the next page's first tip`, () => {
    for (const step of steps) {
      assert.deepEqual(skip(step), [['step', nextStep], [method, route]]);
    }
  });
}

test('skipping Community still shows the final start-exploring message', () => {
  for (const step of ['community-tip', 'community-tip-full']) {
    assert.deepEqual(skip(step), [['step', 'add-friends-tip']]);
  }
});

test('skipping the final message finishes the tutorial without navigating', () => {
  assert.deepEqual(skip('add-friends-tip'), [['dismiss']]);
});

test('closes coaching setup before navigation and cannot skip during a save', () => {
  assert.deepEqual(skip('coaching-tip', { modal: true }), [
    ['close-modal'], ['step', 'connect-tip'], ['push', '/sensor-setup'],
  ]);
  assert.deepEqual(skip('coaching-tip', { modal: true, disabled: true }), []);
});

test('inactive tutorials and sensor-specific steps do not navigate', () => {
  for (const step of [null, 'connect-tip', 'calibrate-tip']) assert.deepEqual(skip(step), []);
});
