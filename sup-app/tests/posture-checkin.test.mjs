import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs, miniReact, fakeClock, fakeSupabase, fakeSentry, flush, quietConsole } from './helpers/harness.mjs';

// Posture check-in ("Quick check") notification: saving answers, the 10-minute
// notification queue, tap routing, the scheduler component and the check-in
// screen. Native notifications/UI are faked; delivery timing on a real phone
// (Android battery limits, swiping the app away) stays in the device checklist.

const START = new Date(2026, 10, 18, 10, 0, 0).getTime();
const INTERVAL_MS = 10 * 60 * 1000; // must match POSTURE_CHECKIN_INTERVAL_SECONDS
const POSTURES = ['upright', 'forward_lean', 'slouched', 'severe', 'tilted_left', 'tilted_right'];

/** In-memory expo-notifications: scheduled queue, tray, listeners, launch response. */
function fakeNotifications({ granted = true } = {}) {
  const scheduled = new Map();
  const state = { granted, presented: [], dismissed: [], listeners: {}, last: null, cleared: 0, requests: [] };
  const module = {
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
    AndroidImportance: { DEFAULT: 3, HIGH: 4 },
    AndroidNotificationVisibility: { PUBLIC: 1 },
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    setNotificationHandler() {},
    getPermissionsAsync: async () => ({ status: state.granted ? 'granted' : 'denied' }),
    requestPermissionsAsync: async () => ({ status: state.granted ? 'granted' : 'denied', canAskAgain: true }),
    setNotificationChannelAsync: async () => {},
    setNotificationCategoryAsync: async () => {},
    scheduleNotificationAsync: async (request) => {
      state.requests.push(request);
      const id = request.identifier ?? `auto-${scheduled.size}`;
      scheduled.set(id, { ...request, identifier: id });
      return id;
    },
    cancelScheduledNotificationAsync: async (id) => { scheduled.delete(id); },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    getPresentedNotificationsAsync: async () => state.presented,
    dismissNotificationAsync: async (id) => { state.dismissed.push(id); },
    addNotificationResponseReceivedListener: (fn) => { state.listeners.response = fn; return { remove() {} }; },
    addNotificationReceivedListener: () => ({ remove() {} }),
    getLastNotificationResponseAsync: async () => state.last,
    clearLastNotificationResponseAsync: async () => { state.last = null; state.cleared++; },
  };
  return { module, scheduled, state };
}

const response = (type, { id = 'posture-checkin-0', date = START, action } = {}) => ({
  actionIdentifier: action ?? 'expo.modules.notifications.actions.DEFAULT',
  notification: { date, request: { identifier: id, content: { data: type ? { type } : {} } } },
});

// ─── Saving a check-in (postureCheckinService) ────────────────────────────────

function checkinService({ user = { id: 'user-1' }, error = null } = {}) {
  const db = fakeSupabase(() => ({ data: null, error }), { user });
  const sentry = fakeSentry();
  const mod = loadTs('src/services/posture/postureCheckinService.ts', {
    globals: fakeClock(START),
    mocks: { '@/src/lib/supabase': db.module, '@/src/lib/sentry': sentry.module },
  });
  const inserts = () => db.queries.filter((q) => q.table === 'posture_checkins').map((q) => q.ops.find(([m]) => m === 'insert')?.[1]);
  return { ...mod, db, sentry, inserts };
}

test('a check-in saves posture, back rating, "now" and the notification time for the signed-in user', async () => {
  const s = checkinService();
  const result = await s.savePostureCheckin({ posture: 'slouched', backFeel: 2, notificationSentAt: '2026-11-18T01:58:00.000Z' });
  assert.deepEqual(result, { success: true });
  assert.deepEqual(s.inserts(), [{
    user_id: 'user-1', posture: 'slouched', back_feel: 2,
    logged_at: new Date(START).toISOString(),
    notification_sent_at: '2026-11-18T01:58:00.000Z', source: 'notification',
  }]);
});

test('a check-in opened from inside the app is saved as in_app with no notification time', async () => {
  const s = checkinService();
  await s.savePostureCheckin({ posture: 'upright', backFeel: 5, source: 'in_app' });
  assert.equal(s.inserts()[0].source, 'in_app');
  assert.equal(s.inserts()[0].notification_sent_at, null);
});

test('signed-out users cannot save and nothing is written', async () => {
  const s = checkinService({ user: null });
  const result = await s.savePostureCheckin({ posture: 'upright', backFeel: 3 });
  assert.equal(result.success, false);
  assert.match(result.error, /Sign in/);
  assert.equal(s.inserts().length, 0);
});

test('a database error returns a friendly message and is reported to Sentry', async () => {
  const s = checkinService({ error: { message: 'new row violates row-level security policy' } });
  const result = await s.savePostureCheckin({ posture: 'severe', backFeel: 1 });
  assert.equal(result.success, false);
  assert.match(result.error, /Couldn't save/);
  assert.equal(s.sentry.errors[0].context, 'posture-checkin-save');
});

test('the notification repeats every 10 minutes', () => {
  assert.equal(checkinService().POSTURE_CHECKIN_INTERVAL_SECONDS * 1000, INTERVAL_MS);
});

// ─── Notification queue and tap routing (pushNotificationService) ─────────────

function notifService({ os = 'android', granted = true, db = fakeSupabase() } = {}) {
  const notif = fakeNotifications({ granted });
  const navigated = [];
  const mod = loadTs('src/services/reminder/pushNotificationService.ts', {
    globals: { ...fakeClock(START), console: quietConsole },
    mocks: {
      'expo-notifications': notif.module,
      'react-native': { Platform: { OS: os }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
      'expo-router': { router: { navigate: (to) => navigated.push(to) } },
      '@/src/lib/supabase': db.module,
      '@/src/lib/sentry': fakeSentry().module,
      './reminderEngineService': { getReminderForUser: async () => null, getReEngagementReminder: async () => null },
    },
  });
  return { ...mod, notif, navigated, db };
}

test('a check-in is shown immediately on Android, on the high-priority channel, with nothing queued for later', async () => {
  const n = notifService();
  await n.sendPostureCheckinNotification();
  assert.equal(n.notif.state.requests.length, 1);
  const [sent] = n.notif.state.requests;
  assert.deepEqual(sent.trigger, { channelId: 'reminders_high' }, 'no date/interval → delivered now, not by the OS later');
  assert.equal(sent.content.title, 'Quick check');
  assert.match(sent.content.body, /Catching your posture during the day is how habits change/);
  assert.equal(sent.content.data.type, 'posture_checkin');
});

test('on iOS a check-in is shown immediately (null trigger)', async () => {
  const n = notifService({ os: 'ios' });
  await n.sendPostureCheckinNotification();
  assert.equal(n.notif.state.requests[0].trigger, null);
});

test('each check-in replaces the previous one in the tray instead of piling up', async () => {
  const n = notifService();
  await n.sendPostureCheckinNotification();
  await n.sendPostureCheckinNotification();
  const ids = n.notif.state.requests.map((r) => r.identifier);
  assert.equal(new Set(ids).size, 1);
  assert.match(ids[0], /^posture-checkin-/);
});

test('without notification permission nothing is sent', async () => {
  const n = notifService({ granted: false });
  await n.sendPostureCheckinNotification();
  assert.equal(n.notif.state.requests.length, 0);
});

test('cleanup removes check-ins earlier builds queued with the OS, but leaves other reminders alone', async () => {
  const n = notifService();
  for (const id of ['posture-checkin-0', 'posture-checkin-59', 'posture-checkin-repeating', 're-engagement']) {
    n.notif.scheduled.set(id, { identifier: id, content: { data: {} } });
  }
  await n.cancelPostureCheckinNotifications();
  assert.deepEqual([...n.notif.scheduled.keys()], ['re-engagement']);
});

test('tapping a check-in opens the check-in screen with when it was sent, and clears others from the tray', async () => {
  const n = notifService();
  n.notif.state.presented = [response('posture_checkin', { id: 'posture-checkin-3' }).notification, response('session_alert', { id: 'alert' }).notification];
  assert.equal(n.handlePostureCheckinResponse(response('posture_checkin')), true);
  await flush();
  assert.deepEqual(n.navigated, [{ pathname: '/(modals)/posture-checkin', params: { sentAt: new Date(START).toISOString(), source: 'notification' } }]);
  assert.deepEqual(n.notif.state.dismissed, ['posture-checkin-3']);
});

test('the same tap arriving twice (listener + launch response) opens the screen once', () => {
  const n = notifService();
  n.handlePostureCheckinResponse(response('posture_checkin'));
  n.handlePostureCheckinResponse(response('posture_checkin'));
  assert.equal(n.navigated.length, 1);
  n.handlePostureCheckinResponse(response('posture_checkin', { id: 'posture-checkin-1', date: START + INTERVAL_MS }));
  assert.equal(n.navigated.length, 2);
});

test('other notifications are not treated as check-ins', () => {
  const n = notifService();
  assert.equal(n.handlePostureCheckinResponse(response('re_engagement')), false);
  assert.equal(n.handlePostureCheckinResponse(response(undefined)), false);
  assert.equal(n.navigated.length, 0);
});

test('a check-in tap does not count as a reminder interaction in behaviour_state', async () => {
  const n = notifService();
  n.setupNotificationListeners();
  await n.notif.state.listeners.response(response('posture_checkin'));
  assert.equal(n.navigated.length, 1);
  assert.equal(n.db.queries.filter((q) => q.table === 'behaviour_state' || q.table === 'reminder_log').length, 0);
  // Sanity check that a real reminder tap would have touched behaviour_state.
  await n.notif.state.listeners.response({ ...response(undefined, { id: 'r1', action: 'DONE' }), notification: { date: START, request: { identifier: 'r1', content: { data: { actionLabel: 'View' } } } } });
  assert.ok(n.db.queries.some((q) => q.table === 'behaviour_state'));
});

// ─── PostureCheckinScheduler (in-app timer, cleanup, open on launch) ─────────

function scheduler({ userId = 'user-1', pathname = '/home', last = null } = {}) {
  const hooks = miniReact();
  const notif = fakeNotifications();
  notif.state.last = last;
  const clock = fakeClock(START);
  const state = { userId, pathname };
  const calls = [];
  const opened = [];
  const mod = loadTs('src/components/posture/PostureCheckinScheduler.tsx', {
    globals: { ...clock, console: quietConsole },
    mocks: {
      react: hooks.react,
      'expo-router': { usePathname: () => state.pathname },
      'expo-notifications': notif.module,
      '@/src/contexts/AuthContext': { useAuth: () => ({ userId: state.userId }) },
      '@/src/services/reminder/pushNotificationService': {
        setupNotifications: async () => {},
        sendPostureCheckinNotification: async () => { calls.push('send'); },
        cancelPostureCheckinNotifications: async () => { calls.push('cleanup'); },
        handlePostureCheckinResponse: (r) => { opened.push(r); return true; },
      },
      '@/src/lib/supabase': fakeSupabase().module,
      '@/src/lib/sentry': fakeSentry().module,
    },
  });
  const mounted = hooks.mount(() => mod.default());
  const render = async () => { mounted.render(); await flush(); };
  const sends = () => calls.filter((c) => c === 'send').length;
  return { state, calls, sends, opened, notif, clock, render, unmount: mounted.unmount };
}

test('signed in → a check-in every 10 minutes from the app’s own timer, none before', async () => {
  const s = scheduler();
  await s.render();
  s.clock.advance(INTERVAL_MS - 60_000);
  assert.equal(s.sends(), 0, 'nothing in the first 10 minutes');
  s.clock.advance(60_000);
  assert.equal(s.sends(), 1);
  s.clock.advance(INTERVAL_MS);
  assert.equal(s.sends(), 2);
});

test('signing out stops check-ins, and guests never get any', async () => {
  const s = scheduler();
  await s.render();
  s.clock.advance(INTERVAL_MS);
  s.state.userId = null; await s.render();
  s.clock.advance(5 * INTERVAL_MS);
  assert.equal(s.sends(), 1);
  const guest = scheduler({ userId: null });
  await guest.render();
  guest.clock.advance(5 * INTERVAL_MS);
  assert.equal(guest.sends(), 0);
});

test('once the app is closed (timer gone) no more check-ins are sent', async () => {
  const s = scheduler();
  await s.render();
  s.unmount();
  s.clock.advance(5 * INTERVAL_MS);
  assert.equal(s.sends(), 0);
  assert.equal(s.clock.timers.size, 0, 'interval cleared');
});

test('a timer paused for a long time (app suspended) sends one check-in on resume, not a burst', async () => {
  const s = scheduler();
  await s.render();
  // An hour passes with no timer callbacks (suspended), then the timer fires
  // a couple of times in quick succession on resume.
  const [timer] = s.clock.timers.values();
  s.clock.set(START + 6 * INTERVAL_MS);
  timer.fn(); timer.fn();
  assert.equal(s.sends(), 1);
  s.clock.set(START + 7 * INTERVAL_MS - 60_000); timer.fn();
  assert.equal(s.sends(), 1, 'next one is a full interval after the resume send');
  s.clock.set(START + 7 * INTERVAL_MS); timer.fn();
  assert.equal(s.sends(), 2);
});

test('on launch, check-ins earlier builds queued with the OS are cleared once', async () => {
  const s = scheduler();
  await s.render();
  s.state.userId = null; await s.render();
  s.state.userId = 'user-1'; await s.render();
  assert.equal(s.calls.filter((c) => c === 'cleanup').length, 1);
});

test('launched by tapping a check-in → waits for startup routing, then opens the screen once', async () => {
  const s = scheduler({ pathname: '/', last: response('posture_checkin', { date: START - 60_000 }) });
  await s.render();
  assert.equal(s.opened.length, 0, 'not while app/index.tsx is still redirecting');
  assert.equal(s.notif.state.cleared, 1);
  s.state.pathname = '/home'; await s.render();
  assert.equal(s.opened.length, 1);
  s.state.pathname = '/stats'; await s.render();
  assert.equal(s.opened.length, 1);
});

test('launch response arriving after routing has settled still opens the screen', async () => {
  const s = scheduler({ pathname: '/home', last: response('posture_checkin', { date: START - 60_000 }) });
  await s.render();
  assert.equal(s.opened.length, 1);
});

test('a stale or non-check-in launch response is ignored', async () => {
  const stale = scheduler({ last: response('posture_checkin', { date: START - 20 * 60_000 }) });
  await stale.render();
  const other = scheduler({ last: response('re_engagement', { date: START }) });
  await other.render();
  assert.equal(stale.opened.length + other.opened.length, 0);
});

// ─── Check-in screen (app/(modals)/posture-checkin.tsx) ───────────────────────

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

function screen({ params = { sentAt: '2026-11-18T01:58:00.000Z', source: 'notification' }, save = async () => ({ success: true }) } = {}) {
  const hooks = miniReact();
  const saved = []; const toasts = []; let backs = 0;
  const mod = loadTs('app/(modals)/posture-checkin.tsx', {
    globals: fakeClock(START),
    mocks: {
      react: hooks.react,
      'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (v) => v } },
      'expo-router': { router: { back: () => backs++ }, useLocalSearchParams: () => params },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
      '@/src/components/ui/PressFeedback': { __esModule: true, default: 'Pressable' },
      '@/src/components/posture/PostureOptionFigure': { __esModule: true, default: 'Figure' },
      '@/src/contexts/ToastContext': { useToast: () => ({ showToast: (message, tone) => toasts.push([message, tone]) }) },
      '@/src/services/posture/postureCheckinService': { savePostureCheckin: async (input) => { saved.push(input); return save(input); } },
    },
  });
  const mounted = hooks.mount(() => mod.default());
  let tree;
  const render = () => (tree = mounted.render());
  render();
  const control = (label) => {
    const found = nodes(tree).find((n) => n.type === 'Pressable' && (n.props.accessibilityLabel === label || text(n) === label));
    assert.ok(found, `Missing control: ${label}`);
    return found;
  };
  return {
    saved, toasts, backs: () => backs, render, control, text: () => text(tree), nodes: () => nodes(tree),
    async press(label) { const n = control(label); assert.ok(!n.props.disabled, `${label} is disabled`); await n.props.onPress(); render(); },
  };
}

test('screen shows the six postures, a 1–5 back rating and the time as Now', () => {
  const s = screen();
  for (const label of ['Upright', 'Forward lean', 'Slouched', 'Severe', 'Tilted L', 'Tilted R']) s.control(label);
  for (let n = 1; n <= 5; n++) s.control(`${n} of 5`);
  const figures = s.nodes().filter((n) => n.type === 'Figure').map((n) => n.props.posture);
  assert.deepEqual(figures, POSTURES);
  assert.match(s.text(), /Now · /);
  assert.match(s.text(), /Stiff.*Great/);
});

test('Log it stays disabled until both a posture and a back rating are chosen', () => {
  const s = screen();
  assert.equal(s.control('Log it').props.disabled, true);
  s.control('Slouched').props.onPress(); s.render();
  assert.equal(s.control('Log it').props.disabled, true);
  s.control('2 of 5').props.onPress(); s.render();
  assert.equal(s.control('Log it').props.disabled, false);
  assert.equal(s.control('Slouched').props.accessibilityState.selected, true);
});

test('logging saves the answers with the notification time, shows "Posture logged!" and closes', async () => {
  const s = screen();
  await s.press('Tilted L'); await s.press('4 of 5'); await s.press('Log it');
  assert.deepEqual(s.saved, [{ posture: 'tilted_left', backFeel: 4, notificationSentAt: '2026-11-18T01:58:00.000Z', source: 'notification' }]);
  assert.deepEqual(s.toasts, [['Posture logged!', 'success']]);
  assert.equal(s.backs(), 1);
});

test('a failed save keeps the screen open with the error, and retry sends the same answers', async () => {
  let attempt = 0;
  const s = screen({ save: async () => (++attempt === 1 ? { success: false, error: "Couldn't save your check-in. Try again." } : { success: true }) });
  await s.press('Upright'); await s.press('5 of 5'); await s.press('Log it');
  assert.match(s.text(), /Couldn't save/);
  assert.equal(s.backs(), 0);
  assert.equal(s.toasts.length, 0);
  await s.press('Log it');
  assert.deepEqual(s.saved[0], s.saved[1]);
  assert.equal(s.backs(), 1);
});

test('Not now closes without saving', async () => {
  const s = screen();
  await s.press('Upright'); await s.press('Not now');
  assert.equal(s.saved.length, 0);
  assert.equal(s.backs(), 1);
});

test('opened without a notification (no params) saves with no notification time', async () => {
  const s = screen({ params: {} });
  await s.press('Severe'); await s.press('1 of 5'); await s.press('Log it');
  assert.equal(s.saved[0].notificationSentAt, null);
  assert.equal(s.saved[0].source, 'notification');
});

// ─── Stick figures ────────────────────────────────────────────────────────────

test('each posture draws a different figure; only the tilts are front-on and leaning opposite ways', () => {
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment' };
  react.default = react;
  const svg = { __esModule: true, default: 'Svg', Circle: 'Circle', G: 'G', Path: 'Path' };
  const native = { View: 'View', StyleSheet: { create: (v) => v }, Animated: { Value: class {}, timing() {} }, Easing: { out: (f) => f, cubic() {} } };
  const { default: Figure } = loadTs('src/components/posture/PostureOptionFigure.tsx', {
    mocks: { react, 'react-native-svg': svg, 'react-native': native },
  });
  // Render nested function components (SideFigure / FrontFigure) all the way down.
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const draw = (posture) => expand(Figure({ posture, color: '#000' }));
  const drawings = POSTURES.map((p) => JSON.stringify(draw(p)));
  assert.equal(new Set(drawings).size, 6, 'all six figures differ');
  const rotation = (p) => nodes(draw(p)).find((n) => n.type === 'G')?.props.rotation;
  assert.ok(rotation('tilted_left') < 0);
  assert.ok(rotation('tilted_right') > 0);
  for (const p of ['upright', 'forward_lean', 'slouched', 'severe']) assert.equal(rotation(p), undefined, p);
});

// ─── Reading check-ins back for the exercise log ─────────────────────────────

test('fetching check-ins is account-scoped, newest first, and pages past 500 rows', async () => {
  const pages = [Array.from({ length: 500 }, (_, i) => ({ id: `c${i}` })), [{ id: 'c500' }]];
  const db = fakeSupabase(() => ({ data: pages.shift(), error: null }));
  const mod = loadTs('src/services/posture/postureCheckinService.ts', { mocks: { '@/src/lib/supabase': db.module, '@/src/lib/sentry': fakeSentry().module } });
  const rows = await mod.fetchPostureCheckins('user-a');
  assert.equal(rows.length, 501);
  for (const q of db.queries) {
    assert.equal(q.table, 'posture_checkins');
    assert.deepEqual(q.ops.find(([m]) => m === 'eq'), ['eq', 'user_id', 'user-a']);
    assert.deepEqual(q.ops.find(([m]) => m === 'order'), ['order', 'logged_at', { ascending: false }]);
  }
  assert.deepEqual(db.queries.map((q) => q.ops.find(([m]) => m === 'range')), [['range', 0, 499], ['range', 500, 999]]);
});

test('a fetch error is thrown so the page can show it', async () => {
  const db = fakeSupabase(() => ({ data: null, error: { message: 'offline' } }));
  const mod = loadTs('src/services/posture/postureCheckinService.ts', { mocks: { '@/src/lib/supabase': db.module, '@/src/lib/sentry': fakeSentry().module } });
  await assert.rejects(mod.fetchPostureCheckins('user-a'), { message: 'offline' });
});

function checkinsCard(checkins) {
  const hooks = miniReact();
  const mod = loadTs('src/features/exercise/PostureCheckinsCard.tsx', {
    globals: fakeClock(START),
    mocks: {
      react: hooks.react,
      'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (v) => v } },
      '@expo/vector-icons': { Ionicons: 'Icon' },
      '@/src/lib/supabase': fakeSupabase().module, '@/src/lib/sentry': fakeSentry().module,
    },
  });
  const mounted = hooks.mount(() => mod.PostureCheckinsCard({ checkins, dayLabel: 'Today' }));
  let tree; const render = () => (tree = mounted.render()); render();
  return { mod, render, text: () => text(tree), nodes: () => nodes(tree) };
}
const saved = (id, minute, posture = 'upright', back_feel = 4) =>
  ({ id, posture, back_feel, logged_at: new Date(2026, 10, 18, 10, minute).toISOString(), notification_sent_at: null, source: 'notification' });

test('day card summarises count, most common posture and average back rating', () => {
  const c = checkinsCard([saved('a', 8, 'slouched', 2), saved('b', 6, 'upright', 4), saved('c', 4, 'slouched', 3), saved('d', 2, 'severe', 3), saved('e', 0, 'slouched', 3)]);
  assert.match(c.text(), /5 check-ins · mostly Slouched · back 3\.0\/5/);
  assert.match(c.text(), /Slouched2\/5 · A little stiff/);
});

test('day card shows the newest 5, then Show all / Show less', () => {
  const c = checkinsCard([saved('a', 10), saved('b', 8), saved('c', 6), saved('d', 4), saved('e', 2), saved('f', 0, 'tilted_right')]);
  assert.ok(!c.text().includes('Tilted R'));
  assert.equal(c.text().match(/Upright/g).length, 6, 'summary + 5 entries');
  const toggle = () => c.nodes().find((n) => n.type === 'Pressable');
  assert.equal(text(toggle()), 'Show all 6');
  toggle().props.onPress(); c.render();
  assert.ok(c.text().includes('Tilted R'));
  assert.equal(text(toggle()), 'Show less');
});

test('a single check-in reads naturally and has no Show all button', () => {
  const c = checkinsCard([saved('a', 8, 'tilted_left', 5)]);
  assert.equal(checkinsCard([saved('a', 8), saved('b', 6), saved('c', 4), saved('d', 2), saved('e', 0)]).nodes().filter((n) => n.type === 'Pressable').length, 0, 'exactly 5 → no button');
  assert.match(c.text(), /1 check-in · mostly Tilted L · back 5\.0\/5/);
  assert.ok(c.text().includes('5/5 · Great'));
  assert.equal(c.nodes().filter((n) => n.type === 'Pressable').length, 0);
});

test('summary ties go to the most recent posture, and check-ins are dated by the phone’s local day', () => {
  const c = checkinsCard([]);
  assert.equal(c.mod.summarizeCheckins([saved('a', 8, 'severe'), saved('b', 6, 'upright')]).top, 'severe');
  assert.deepEqual(c.mod.summarizeCheckins([]), { count: 0, top: null, avgBack: null });
  // Just after and just before local midnight: whichever way the phone's
  // timezone is offset from UTC, one of these falls on a different UTC date.
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(c.mod.checkinDay({ logged_at: new Date(2026, 10, 18, 0, 30).toISOString() }, key), '2026-11-18');
  assert.equal(c.mod.checkinDay({ logged_at: new Date(2026, 10, 18, 23, 30).toISOString() }, key), '2026-11-18');
});
