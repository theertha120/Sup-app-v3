import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs, miniReact, fakeClock, fakeSentry, flush } from './helpers/harness.mjs';

// Run real component hooks and callbacks. Native rendering/animation is faked;
// visual appearance and physical touch remain in the device checklist.
const clock = () => fakeClock(new Date(2026, 10, 15, 12).getTime());
const native = {
  View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal', ScrollView: 'ScrollView',
  TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator',
  RefreshControl: 'RefreshControl', Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
};
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return text(tree.props?.children);
}
function mountComponent(path, name, props, options = {}) {
  const hooks = miniReact(); hooks.react.useLayoutEffect = hooks.react.useEffect;
  const module = loadTs(path, { globals: clock(), mocks: {
    react: hooks.react, 'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    ...options.mocks?.(hooks.react),
  }});
  const mounted = hooks.mount(() => module[name](props));
  let tree;
  const render = () => (tree = mounted.render());
  render();
  const control = label => {
    const found = nodes(tree).find(node => node.props?.label === label || node.props?.accessibilityLabel === label ||
      (node.type === 'Pressable' && text(node) === label));
    assert.ok(found, `Missing control: ${label}`);
    return found;
  };
  return { props, render, nodes: () => nodes(tree), text: () => text(tree), control,
    press(label) { const node = control(label); assert.ok(!node.props.disabled, `${label} is disabled`); const result = node.props.onPress(); render(); return result; },
    enter(label, value) { control(label).props.onChangeText(value); render(); },
    unmount: mounted.unmount,
  };
}
const input = () => ({ performed_on: '2026-11-15', back_feeling: 4,
  exercises: [{ name: 'Plank', category: 'strength', unit: 'seconds', values: [30, 30, 30] }] });
function form(extra = {}) {
  const saved = []; let closed = 0;
  const props = { editing: false, history: [], onClose: () => closed++, onSave: async value => saved.push(value), ...extra };
  return { ...mountComponent('src/features/exercise/WorkoutForm.tsx', 'WorkoutForm', props), saved, closed: () => closed };
}

test('manual flow selects an exercise, enters sets and rating, and saves the exact workout', async () => {
  const f = form();
  f.press('PlankSets × seconds  +'); f.enter('Plank sets', '3'); f.enter('Plank seconds', '30');
  f.press('4, Good'); await f.press('Save workout');
  assert.deepEqual(f.saved, [input()]);
});
test('search narrows the picker and a custom strength name stays editable when it matches a preset', () => {
  const f = form(); f.enter('Search exercises', 'plank');
  assert.ok(f.text().includes('Plank')); assert.ok(!f.text().includes('Deadlift'));
  f.press('+ Other strength exercise'); f.enter('Exercise name', 'Plank');
  assert.equal(f.control('Exercise name').props.value, 'Plank');
  f.enter('Exercise name', 'Side plank'); f.press('Seconds');
  assert.equal(f.control('Side plank seconds').props.value, '');
});
test('mixed workout saves decimal-comma minutes and different amounts per set', async () => {
  const f = form({ initial: input() });
  f.press('Different values per set'); f.enter('Set 2 seconds', '25');
  f.press('+ Add set'); f.enter('Set 4 seconds', '15'); f.press('Remove set 3');
  f.press('+ Add another exercise'); f.press('YogaMinutes  +'); f.enter('Yoga minutes', '12,5');
  await f.press('Save workout');
  assert.deepEqual(f.saved[0].exercises, [
    {name: 'Plank', category: 'strength', unit: 'seconds', values: [30, 25, 15]},
    {name: 'Yoga', category: 'other', unit: 'minutes', values: [12.5]},
  ]);
});
test('save rejects a missing rating and invalid sets without calling storage', async () => {
  const f = form({ initial: { ...input(), back_feeling: 0 } });
  await f.press('Save workout'); f.render(); assert.ok(f.text().includes('Choose how your back felt'));
  f.press('5, Great'); f.enter('Plank sets', '0'); await f.press('Save workout'); f.render();
  assert.ok(f.text().includes('between 1 and 50')); assert.equal(f.saved.length, 0);
});
test('use last values reuses the most recent matching exercise without copying its rating', async () => {
  const f = form({ initial: { ...input(), back_feeling: 0 }, history: [
    { ...input(), exercises: [{ ...input().exercises[0], values: [45, 40] }] },
    { ...input(), exercises: [{ ...input().exercises[0], values: [10] }] },
  ] });
  f.press('↺ Use last values'); assert.equal(f.control('Set 1 seconds').props.value, '45');
  await f.press('Save workout'); f.render(); assert.equal(f.saved.length, 0);
  f.press('3, Okay'); await f.press('Save workout');
  assert.deepEqual(f.saved[0].exercises[0].values, [45, 40]); assert.equal(f.saved[0].back_feeling, 3);
});
test('removing the last exercise prevents an empty workout from being saved', async () => {
  const f = form({ initial: input() }); f.press('Remove Plank'); await f.press('Save workout'); f.render();
  assert.equal(f.saved.length, 0); assert.ok(f.text().includes('Add between 1 and 30 exercises'));
});
test('close asks before discarding edits and Keep editing preserves all values', () => {
  const f = form({ initial: input() }); f.enter('Plank seconds', '40'); f.press('Close exercise log');
  assert.equal(f.closed(), 0); f.press('Keep editing'); assert.equal(f.control('Plank seconds').props.value, '40');
  f.press('Close exercise log'); f.press('Discard'); assert.equal(f.closed(), 1);
});
test('a failed save retains the form and retry submits the same values', async () => {
  let attempt = 0; const received = [];
  const f = form({ initial: input(), onSave: async value => { received.push(value); if (++attempt === 1) throw Error('offline'); } });
  await f.press('Save workout'); f.render();
  assert.ok(f.text().includes('could not be saved')); assert.equal(f.control('Plank seconds').props.value, '30');
  await f.press('Save workout'); assert.deepEqual(received, [input(), input()]);
});
test('rapid double-save and closing while saving cannot submit twice or discard the form', async () => {
  let finish; let calls = 0;
  const f = form({ initial: input(), onSave: () => { calls++; return new Promise(resolve => finish = resolve); } });
  const save = f.control('Save workout').props.onPress;
  const first = save(); const second = save(); f.render();
  assert.equal(calls, 1); assert.equal(f.control('Saving…').props.disabled, true);
  f.nodes().find(node => node.type === 'Modal').props.onRequestClose(); assert.equal(f.closed(), 0);
  finish(); await Promise.all([first, second]); f.render(); assert.equal(f.control('Save workout').props.disabled, false);
});

function week(anchor = '2026-11-15', extra = {}) {
  let pan; let value; let animation;
  const changed = []; const picked = [];
  class Value {
    constructor(n) { this.value = n; value ??= this; }
    setValue(n) { this.value = n; }
    stopAnimation() { if (animation) { const previous = animation; animation = null; previous.callback({ finished: false }); } }
  }
  const props = { anchor, selectedDay: null, marked: new Set(['2026-11-11']),
    onWeekChange: day => { changed.push(day); props.anchor = day; }, onSelectDay: day => picked.push(day), onOpenCalendar() {}, ...extra };
  const mounted = mountComponent('src/features/exercise/WeekCalendar.tsx', 'WeekCalendar', props, { mocks: () => ({
    'react-native': { ...native, Animated: { Value, View: 'AnimatedView', timing: (target, config) => ({ start: callback => { animation = { target, config, callback }; } }) },
      Easing: { cubic() {}, out: fn => fn }, PanResponder: { create: config => { pan = config; return { panHandlers: {} }; } } },
  }) });
  mounted.nodes().find(node => node.props.onLayout).props.onLayout({ nativeEvent: { layout: { width: 280 } } }); mounted.render();
  return { ...mounted, changed, picked, value: () => value.value === 0 ? 0 : value.value,
    finish() { const pending = animation; assert.ok(pending); animation = null; pending.target.setValue(pending.config.toValue); pending.callback({ finished: true }); mounted.render(); },
    move(dx, dy = 0) { pan.onPanResponderMove(null, { dx, dy }); },
    release(dx, vx = 0) { pan.onPanResponderRelease(null, { dx, vx }); },
    claim(dx, dy) { return pan.onMoveShouldSetPanResponder(null, { dx, dy }); },
    terminate() { pan.onPanResponderTerminate(); },
  };
}
test('calendar swipes right to older weeks and left back to this week', () => {
  const w = week(); w.move(80); assert.equal(w.value(), 80); w.release(80); w.finish();
  assert.deepEqual(w.changed, ['2026-11-02']); assert.equal(w.value(), 0);
  w.release(-80); w.finish(); assert.deepEqual(w.changed, ['2026-11-02', '2026-11-09']);
});
test('left swipe at the current week resists the drag and does not enter the future', () => {
  const w = week(); w.move(-80); assert.equal(w.value(), -20); w.release(-80); w.finish();
  assert.deepEqual(w.changed, []); assert.equal(w.value(), 0);
});
test('short drags snap back, fast flicks advance, and vertical scrolling stays available', () => {
  const w = week(); assert.equal(w.claim(4, 0), false); assert.equal(w.claim(15, 30), false); assert.equal(w.claim(30, 5), true);
  w.release(20, 0.1); w.finish(); assert.deepEqual(w.changed, []);
  w.release(15, 0.5); w.finish(); assert.equal(w.changed[0], '2026-11-02');
});
test('interrupted swipes reset, and repeated gestures during animation do not skip weeks', () => {
  const w = week(); w.move(35); w.terminate(); w.finish(); assert.equal(w.value(), 0); assert.equal(w.changed.length, 0);
  w.release(60); assert.equal(w.claim(60, 0), false); w.release(60); w.finish(); assert.equal(w.changed.length, 1);
});
test('week paging crosses year boundaries and clamps at the earliest supported date', () => {
  const w = week('2026-01-01'); w.release(80); w.finish(); assert.equal(w.changed[0], '2025-12-22');
  const earliest = week('1900-01-01'); earliest.release(80); earliest.finish(); assert.equal(earliest.changed.length, 0);
});
test('calendar jumps reset swipe position and day selection remains interactive', () => {
  const w = week(); w.move(30); w.props.anchor = '2026-10-12'; w.render(); assert.equal(w.value(), 0);
  const current = w.nodes().find(node => node.props.importantForAccessibility === 'auto');
  const day = nodes(current).find(node => node.props.accessibilityLabel === new Date(2026, 9, 12).toDateString());
  day.props.onPress(); assert.deepEqual(w.picked, ['2026-10-12']);
  w.props.selectedDay = '2026-10-12'; w.render();
  const selected = w.nodes().find(node => node.props.accessibilityState?.selected && node.type === 'Pressable');
  selected.props.onPress(); assert.equal(w.picked.at(-1), null);
});
test('visible hint stays concise and offscreen calendar pages are hidden from accessibility', () => {
  const w = week('2026-10-12');
  assert.ok(w.text().includes('swipe right for older data')); assert.ok(!w.text().includes('left for newer'));
  assert.equal(w.nodes().filter(node => node.props.accessibilityElementsHidden === true).length, 2);
});
test('month picker changes year, selects leap day and disables future dates', () => {
  const chosen = [];
  const calendar = mountComponent('src/features/exercise/DateCalendar.tsx', 'DateCalendar', { value: '2024-03-01', onChange: value => chosen.push(value) });
  calendar.press('‹'); calendar.press(new Date(2024, 1, 29).toDateString()); assert.deepEqual(chosen, ['2024-02-29']);
  const future = mountComponent('src/features/exercise/DateCalendar.tsx', 'DateCalendar', { value: '2026-11-15', onChange() {} });
  assert.equal(future.control(new Date(2026, 10, 16).toDateString()).props.disabled, true); assert.equal(future.control('›').props.disabled, true);
  const year = mountComponent('src/features/exercise/DateCalendar.tsx', 'DateCalendar', { value: '2026-01-01', onChange() {} });
  year.press('‹'); assert.ok(year.text().includes('2025'));
});

const checkin = (id, logged_at, posture = 'upright', back_feel = 4) =>
  ({ id, posture, back_feel, logged_at, notification_sent_at: null, source: 'notification' });
function screen({ checkins = [] } = {}) {
  let userId = 'user-a'; const history = [{ id: 'workout-a', user_id: userId, created_at: '2026-11-15T04:00:00Z', ...input() }];
  const calls = []; const notifications = []; const sentry = fakeSentry();
  const service = {
    fetchWorkouts: async id => id === 'user-a' ? history : [],
    saveWorkout: async (id, value, existing) => { calls.push(['save', id, existing]); return { ...value, id: existing ?? 'workout-b', user_id: id, created_at: '2026-11-15T05:00:00Z' }; },
    deleteWorkout: async (id, workout) => calls.push(['delete', id, workout]),
  };
  const checkinService = { fetchPostureCheckins: async id => id === 'user-a' ? checkins : [] };
  const mounted = mountComponent('app/(tabs)/exercise.tsx', 'default', {}, { mocks: react => ({
    'expo-router': { useFocusEffect: callback => react.useEffect(callback, [callback]) },
    'expo-font': { useFonts: () => [true, null] },
    '../../assets/fonts/Agrandir-Regular.otf': '', '../../assets/fonts/Agrandir-TextBold.otf': '', '../../assets/fonts/Agrandir-GrandHeavy.otf': '',
    '@/src/components/ui/HeaderBar': { default: 'HeaderBar' }, '@/src/components/ui/BackgroundBlobs': { default: 'BackgroundBlobs' },
    '@/src/components/ui/BrandAlert': { BrandAlert: 'BrandAlert' }, '@/src/components/ui/ScreenErrorBoundary': { default: 'ErrorBoundary' },
    '@/src/contexts/AuthContext': { useAuth: () => ({ userId }) }, '@/src/contexts/ToastContext': { useToast: () => ({ showToast: (...args) => notifications.push(args) }) },
    '@/src/services/exercise/exerciseLogService': service,
    '@/src/features/exercise/WorkoutForm': { WorkoutForm: 'WorkoutForm' }, '@/src/features/exercise/WeekCalendar': { WeekCalendar: 'WeekCalendar' },
    '@/src/features/exercise/DateCalendar': { DateCalendar: 'DateCalendar' },
    '@/src/services/posture/postureCheckinService': checkinService, '@/src/lib/sentry': sentry.module,
    '@/src/features/exercise/PostureCheckinsCard': { PostureCheckinsCard: 'PostureCheckinsCard', checkinDay: (c, toKey) => toKey(new Date(c.logged_at)) },
  }) });
  return { ...mounted, service, checkinService, sentry, calls, notifications, history, setUser: id => userId = id };
}
test('history shows every exercise type without category controls and day selection filters it', async () => {
  const f = screen(); f.history.push({ ...f.history[0], id: 'yoga', performed_on: '2026-11-14', exercises: [{ name: 'Yoga', category: 'other', unit: 'minutes', values: [20] }] });
  await flush(); f.render(); assert.ok(f.text().includes('Plank')); assert.ok(f.text().includes('Yoga'));
  assert.equal(f.nodes().some(node => ['All', 'Strength', 'Other'].includes(node.props.label)), false);
  assert.ok(!f.text().includes('What did I train?'));
  f.nodes().find(node => node.type === 'WeekCalendar').props.onSelectDay('2026-11-14'); f.render();
  assert.ok(!f.text().includes('Plank')); assert.ok(f.text().includes('Yoga'));
  f.press('Show all dates'); assert.ok(f.text().includes('Plank'));
});
test('save and edit update history and clear the date filter', async () => {
  const f = screen(); await flush(); f.render(); f.press('+ Log exercise');
  await f.nodes().find(node => node.type === 'WorkoutForm').props.onSave(input()); f.render();
  assert.equal(f.calls[0][0], 'save'); assert.equal(f.nodes().some(node => node.type === 'WorkoutForm'), false);
  const options = f.nodes().find(node => node.props.accessibilityLabel?.startsWith('Options for'));
  options.props.onPress(); f.render(); f.press('Edit');
  const editor = f.nodes().find(node => node.type === 'WorkoutForm'); assert.equal(editor.props.editing, true);
  await editor.props.onSave({ ...input(), back_feeling: 2 }); f.render();
  assert.ok(f.calls[1][2]); assert.ok(f.text().includes('2/5'));
});
test('Log again creates an unsaved copy with a fresh rating and deletion needs confirmation', async () => {
  const f = screen(); await flush(); f.render();
  f.nodes().find(node => node.props.accessibilityLabel?.startsWith('Options for')).props.onPress(); f.render(); f.press('Log again');
  const editor = f.nodes().find(node => node.type === 'WorkoutForm');
  assert.equal(editor.props.editing, false); assert.equal(editor.props.initial.back_feeling, 0); assert.equal(f.calls.length, 0);
  editor.props.onClose(); f.render();
  f.nodes().find(node => node.props.accessibilityLabel?.startsWith('Options for')).props.onPress(); f.render(); f.press('Delete');
  const alert = f.nodes().find(node => node.type === 'BrandAlert'); assert.equal(alert.props.visible, true); assert.equal(f.calls.length, 0);
  alert.props.buttons.find(button => button.text === 'Delete').onPress(); await flush(); f.render();
  assert.deepEqual(f.calls, [['delete', 'user-a', 'workout-a']]); assert.ok(!f.text().includes('Plank'));
});
test('account changes hide old history immediately and ignore old requests finishing later', async () => {
  const f = screen(); await flush(); f.render(); let resolve;
  f.service.fetchWorkouts = () => new Promise(done => resolve = done);
  const refresh = f.nodes().find(node => node.type === 'ScrollView').props.refreshControl.props.onRefresh;
  refresh(); f.setUser('user-b'); f.service.fetchWorkouts = async () => []; f.render();
  assert.ok(!f.text().includes('Plank')); resolve(f.history); await flush(); f.render(); assert.ok(!f.text().includes('Plank'));
});
test('load and delete errors show retry feedback without removing saved history', async () => {
  const f = screen(); await flush(); f.render(); f.service.deleteWorkout = async () => { throw Error('offline'); };
  f.nodes().find(node => node.props.accessibilityLabel?.startsWith('Options for')).props.onPress(); f.render(); f.press('Delete');
  f.nodes().find(node => node.type === 'BrandAlert').props.buttons.find(button => button.text === 'Delete').onPress(); await flush(); f.render();
  assert.ok(f.text().includes('Plank')); assert.equal(f.notifications.at(-1)[1], 'error');
  f.service.fetchWorkouts = async () => { throw Error('offline'); };
  f.nodes().find(node => node.type === 'ScrollView').props.refreshControl.props.onRefresh(); await flush(); f.render();
  assert.ok(f.text().includes('couldn’t load')); f.service.fetchWorkouts = async () => f.history; f.press('Retry'); await flush(); f.render();
  assert.ok(!f.text().includes('couldn’t load'));
});

test('Exercise stays fourth after Stats and all six tabs remain available', () => {
  function Tabs() {} Tabs.Screen = 'TabScreen';
  const f = mountComponent('app/(tabs)/_layout.tsx', 'default', {}, { mocks: () => ({
    'expo-router': { Tabs }, 'react-native': { ...native, Platform: { select: choices => choices.ios } },
    '@/src/components/ui/LiquidGlass': { default: 'LiquidGlass' },
  }) });
  assert.deepEqual(f.nodes().filter(node => node.type === 'TabScreen').map(node => node.props.name),
    ['home', 'desk', 'stats', 'exercise', 'leaderboard', 'daily']);
});
test('screen-reader actions navigate weeks and never offer a newer week from today', () => {
  const w = week();
  let title = w.nodes().find(node => node.props.accessibilityActions);
  assert.deepEqual(title.props.accessibilityActions.map(action => action.name), ['olderWeek']);
  title.props.onAccessibilityAction({ nativeEvent: { actionName: 'olderWeek' } }); w.finish();
  title = w.nodes().find(node => node.props.accessibilityActions);
  assert.deepEqual(title.props.accessibilityActions.map(action => action.name), ['olderWeek', 'newerWeek']);
  title.props.onAccessibilityAction({ nativeEvent: { actionName: 'newerWeek' } }); w.finish();
  assert.deepEqual(w.changed, ['2026-11-02', '2026-11-09']);
});
test('late saves after an account switch do not leak another account’s workout into history', async () => {
  const f = screen(); await flush(); f.render(); let finish;
  f.service.saveWorkout = () => new Promise(resolve => finish = resolve);
  f.press('+ Log exercise'); const pending = f.nodes().find(node => node.type === 'WorkoutForm').props.onSave(input());
  f.setUser('user-b'); f.render(); await flush(); f.render();
  finish(f.history[0]); await pending; f.render();
  assert.ok(!f.text().includes('Plank')); assert.equal(f.notifications.length, 0);
});
test('swiping a week clears a selected day so the old day filter does not linger', async () => {
  const f = screen(); await flush(); f.render();
  f.nodes().find(node => node.type === 'WeekCalendar').props.onSelectDay('2026-11-14'); f.render();
  assert.ok(!f.text().includes('Plank'));
  f.nodes().find(node => node.type === 'WeekCalendar').props.onWeekChange('2026-11-02'); f.render();
  assert.equal(f.nodes().find(node => node.type === 'WeekCalendar').props.selectedDay, null);
  assert.ok(f.text().includes('Plank'));
});

// ─── Posture check-ins on the exercise log ────────────────────────────────────
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
test('posture check-ins appear under their phone-local date, including days with no workout', async () => {
  const f = screen({ checkins: [checkin('c3', at(15, 0, 30), 'slouched'), checkin('c2', at(14, 18)), checkin('c1', at(14, 9), 'severe', 2)] });
  await flush(); f.render();
  const cards = f.nodes().filter(node => node.type === 'PostureCheckinsCard');
  assert.deepEqual(cards.map(card => [card.props.dayLabel, card.props.checkins.map(c => c.id)]), [['Today', ['c3']], ['Yesterday', ['c2', 'c1']]]);
  assert.ok(f.text().includes('Plank'), 'workouts still shown');
  const headings = f.nodes().filter(node => node.props.accessibilityRole === 'header').map(node => text(node));
  assert.deepEqual(headings, ['Today', 'Yesterday'], 'days newest first, one heading per day');
  const calendar = f.nodes().find(node => node.type === 'WeekCalendar');
  assert.deepEqual([...calendar.props.checkins].sort(), ['2026-11-14', '2026-11-15']);
  assert.deepEqual([...calendar.props.marked], ['2026-11-15'], 'workout dots stay workout-only');
  assert.deepEqual([...f.nodes().find(node => node.type === 'DateCalendar').props.marked].sort(), ['2026-11-14', '2026-11-15']);
});
test('selecting a day filters check-ins too, and a check-in-only day is not shown as empty', async () => {
  const f = screen({ checkins: [checkin('c1', at(14, 9))] });
  await flush(); f.render();
  f.nodes().find(node => node.type === 'WeekCalendar').props.onSelectDay('2026-11-14'); f.render();
  assert.ok(!f.text().includes('Plank'));
  assert.equal(f.nodes().filter(node => node.type === 'PostureCheckinsCard').length, 1);
  assert.ok(!f.text().includes('No workouts here yet'));
  f.nodes().find(node => node.type === 'WeekCalendar').props.onSelectDay('2026-11-13'); f.render();
  assert.equal(f.nodes().filter(node => node.type === 'PostureCheckinsCard').length, 0);
  assert.ok(f.text().includes('No workouts here yet'));
});
test('a check-in load failure keeps workout history, shows a note and reports to Sentry', async () => {
  const f = screen(); f.checkinService.fetchPostureCheckins = async () => { throw Error('relation "posture_checkins" does not exist'); };
  f.nodes().find(node => node.type === 'ScrollView').props.refreshControl.props.onRefresh(); await flush(); f.render();
  assert.ok(f.text().includes('Plank')); assert.ok(!f.text().includes('couldn’t load your exercise history'));
  assert.ok(f.text().includes('couldn’t load your posture check-ins'));
  assert.equal(f.sentry.errors.at(-1).context, 'exercise-posture-checkins-load');
  f.checkinService.fetchPostureCheckins = async () => [checkin('c1', at(15, 9))];
  f.nodes().find(node => node.type === 'ScrollView').props.refreshControl.props.onRefresh(); await flush(); f.render();
  assert.ok(!f.text().includes('couldn’t load your posture check-ins'));
  assert.equal(f.nodes().filter(node => node.type === 'PostureCheckinsCard').length, 1);
});
test('switching accounts hides the previous account’s check-ins', async () => {
  const f = screen({ checkins: [checkin('c1', at(15, 9))] });
  await flush(); f.render(); assert.equal(f.nodes().filter(node => node.type === 'PostureCheckinsCard').length, 1);
  f.setUser('user-b'); f.render();
  assert.equal(f.nodes().filter(node => node.type === 'PostureCheckinsCard').length, 0);
  await flush(); f.render();
  assert.equal(f.nodes().filter(node => node.type === 'PostureCheckinsCard').length, 0);
});
test('week card shows a separate check-in dot and count without changing the exercise count', () => {
  const w = week('2026-11-15', { checkins: new Set(['2026-11-11', '2026-11-12']) });
  assert.ok(w.text().includes('1 day with logged exercise'));
  assert.ok(w.text().includes('2 days with posture check-ins'));
  const current = w.nodes().find(node => node.props.importantForAccessibility === 'auto');
  assert.ok(nodes(current).some(node => node.props.accessibilityLabel === `${new Date(2026, 10, 11).toDateString()}, exercise logged, posture check-in logged`));
  assert.ok(nodes(current).some(node => node.props.accessibilityLabel === `${new Date(2026, 10, 12).toDateString()}, posture check-in logged`));
  assert.ok(!week('2026-11-15').text().includes('posture check-ins'), 'no check-in line when there are none');
});
