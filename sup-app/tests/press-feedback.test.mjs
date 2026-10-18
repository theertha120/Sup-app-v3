import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPressFeedback } from '../src/lib/pressFeedback.ts';

test('resting and disabled controls preserve their existing appearance', () => {
  for (const feedback of ['button', 'link', 'scale']) {
    assert.equal(getPressFeedback({}, false, false, feedback, 0xffffffff), undefined);
    assert.equal(getPressFeedback({}, true, true, feedback, 0xffffffff), undefined);
  }
});

test('a held button darkens and shrinks without changing layout dimensions', () => {
  assert.deepEqual(getPressFeedback({}, true, false, 'button', 0xffffffff), {
    backgroundColor: 'rgba(214, 214, 214, 1)',
    transform: [{ scale: 0.97 }],
  });
});

test('pressed colours preserve transparency and handle Android signed colours', () => {
  assert.equal(getPressFeedback({}, true, false, 'button', 0x80ffffff).backgroundColor,
    `rgba(214, 214, 214, ${128 / 255})`);
  assert.deepEqual(getPressFeedback({}, true, false, 'button', -1),
    getPressFeedback({}, true, false, 'button', 0xffffffff));
});

test('existing transforms are retained and the input style is not mutated', () => {
  const base = { transform: [{ translateX: 8 }, { rotate: '15deg' }] };
  const result = getPressFeedback(base, true, false, 'button', undefined);
  assert.deepEqual(result.transform, [{ translateX: 8 }, { rotate: '15deg' }, { scale: 0.97 }]);
  assert.equal(base.transform.length, 2);
});

test('tutorial links fade without scaling or adding a background', () => {
  assert.deepEqual(getPressFeedback({}, true, false, 'link', undefined), { opacity: 0.55 });
  assert.deepEqual(getPressFeedback({ opacity: 0.8 }, true, false, 'link', undefined), { opacity: 0.8 * 0.55 });
});

test('transparent buttons get a visible tint while pressed', () => {
  assert.equal(getPressFeedback({}, true, false, 'button', 0).backgroundColor, 'rgba(29, 1, 74, 0.12)');
});

test('navigation and range tabs shrink without tinting or fading', () => {
  assert.deepEqual(getPressFeedback({ backgroundColor: '#ffffff' }, true, false, 'scale', 0xffffffff), {
    transform: [{ scale: 0.97 }],
  });
});
