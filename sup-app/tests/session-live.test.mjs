// Live "s'ession in progress" status on Android, shown in the foreground
// service's pinned notification (modules/sup-foreground-service): text, update
// pacing, start/stop with the session, and cleanup of the old separate channel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs, miniReact, fakeClock, fakeSupabase, fakeSentry, flush, quietConsole } from './helpers/harness.mjs';
import { setupImu } from './helpers/imuProvider.mjs';

const MIN = 60_000;
const START = new Date(2026, 10, 19, 10, 0).getTime();

function component({ os = 'android', failNative = false } = {}) {
  const hooks = miniReact();
  const clock = fakeClock(START);
  const imu = { sessionStartTimeMs: null, sessionDurationMs: 0, posture: null, bothConnected: true,
    registerLiveStatus: (fn) => { imu.live = fn; } };
  const updates = [];
  const starts = [];
  const sentry = fakeSentry();
  const mod = loadTs('src/components/desk/SessionLiveNotification.tsx', {
    globals: { ...clock, console: quietConsole },
    mocks: {
      react: hooks.react,
      'react-native': { Platform: { OS: os } },
      '@/src/contexts/IMUContext': { useIMUContext: () => imu },
      '@/src/lib/sentry': sentry.module,
      '@/modules/sup-foreground-service': {
        startTrackingService: (title, body, startedAtMs) => { if (failNative) throw Error('native'); updates.push({ title, body }); starts.push(startedAtMs); },
      },
    },
  });
  const mounted = hooks.mount(() => mod.default());
  // A s'pot packet as IMUContext reports it (works in the background too).
  const packet = (state) => imu.live?.({ state, sessionStartTimeMs: imu.sessionStartTimeMs });
  return { mod, imu, clock, updates, starts, sentry, packet, render: () => mounted.render(), unmount: mounted.unmount };
}
const start = (c) => { c.imu.sessionStartTimeMs = START; c.imu.posture = { state: 'upright' }; c.render(); c.clock.advance(0); };

// ─── Text ─────────────────────────────────────────────────────────────────────

test('text shows session time, the posture with a coloured dot, and XP so far', () => {
  const { mod } = component();
  assert.deepEqual(mod.buildSessionLiveContent({ durationMs: 24 * MIN + 59_000, state: 'upright', bothConnected: true }),
    { title: "s'ession in progress · 24min", body: '🟢 good alignment · 10 xp so far' });
  assert.deepEqual(mod.buildSessionLiveContent({ durationMs: 65 * MIN, state: 'severe', bothConnected: true }),
    { title: "s'ession in progress · 1h 5min", body: "🔴 high s'train · 30 xp so far" });
  assert.equal(mod.buildSessionLiveContent({ durationMs: 0, state: null, bothConnected: true }).body, 'reading your posture… · 0 xp so far');
});

test('a dropped s’pot replaces the posture line with a reconnect warning', () => {
  const { mod } = component();
  assert.equal(mod.buildSessionLiveContent({ durationMs: 5 * MIN, state: 'upright', bothConnected: false }).body,
    "⚠️ a s'pot disconnected — open s'up to reconnect");
});

// ─── Updating the foreground service's notification ──────────────────────────

test('a running session puts its live status into the foreground service notification', () => {
  const c = component();
  c.render();
  assert.equal(c.updates.length, 0, 'nothing before a session starts');
  start(c);
  assert.deepEqual(c.updates, [{ title: "s'ession in progress · 0min", body: '🟢 good alignment · 0 xp so far' }]);
});

test('a confirmed posture change updates the notification immediately', () => {
  const c = component();
  c.render(); start(c);
  // Confirmed postures are at least ~0.4 s apart (STATE_CONFIRM_MS).
  c.clock.advance(400); c.packet('slouched');
  assert.equal(c.updates.length, 2, 'no waiting');
  assert.match(c.updates[1].body, /spine rounding/);
  c.clock.advance(400); c.packet('upright');
  assert.equal(c.updates.length, 3);
});

test('a burst inside 250 ms is combined into one update showing the latest', () => {
  const c = component();
  c.render(); start(c);
  c.clock.advance(100); c.packet('slouched');
  c.clock.advance(100); c.packet('severe');
  assert.equal(c.updates.length, 1, 'nothing extra inside 250 ms');
  c.clock.advance(50);
  assert.equal(c.updates.length, 2);
  assert.match(c.updates[1].body, /high s'train/, 'the newest state, not the first change');
});

test('keeps updating in the background, where the screen state (posture) doesn’t change', () => {
  const c = component();
  c.render(); start(c);
  // Backgrounded: IMUContext stops updating `posture`, but packets still arrive.
  c.clock.advance(2000); c.packet('tilted_left');
  assert.match(c.updates.at(-1).body, /shifting left/);
  c.clock.set(START + 10 * MIN); c.packet('tilted_left');
  assert.equal(c.updates.at(-1).title, "s'ession in progress · 10min", 'minutes tick from packets');
  assert.match(c.updates.at(-1).body, /5 xp so far/);
});

test('nothing is re-sent when the text hasn’t changed, and the minutes tick up', () => {
  const c = component();
  c.render(); start(c);
  c.clock.set(START + 30_000); c.packet('upright'); c.packet('upright');
  assert.equal(c.updates.length, 1, 'same minute, same text: nothing sent on each packet');
  c.clock.set(START + MIN); c.packet('upright');
  assert.equal(c.updates.length, 2);
  assert.equal(c.updates[1].title, "s'ession in progress · 1min");
});

test('ending the session cancels a queued update, so it can’t restart the service', () => {
  const c = component();
  c.render(); start(c);
  c.packet('slouched'); // queued (inside 1 s)
  c.imu.sessionStartTimeMs = null; c.render();
  c.clock.advance(10_000);
  c.packet('severe'); // late packets after the end
  assert.equal(c.updates.length, 1);
  c.unmount();
  assert.equal(c.imu.live, null, 'stops listening when removed');
});

test('iOS gets the same live status (its Live Activity), with the session start for the seconds timer', () => {
  const c = component({ os: 'ios' });
  c.render(); start(c);
  assert.deepEqual(c.updates, [{ title: "s'ession in progress · 0min", body: '🟢 good alignment · 0 xp so far' }]);
  assert.deepEqual(c.starts, [START]);
  c.clock.advance(400); c.packet('tilted_right');
  assert.match(c.updates.at(-1).body, /shifting right/, 'fed by packets in the background too');
});

test('other platforms (web) send nothing and don’t listen to packets', () => {
  const c = component({ os: 'web' });
  c.render(); start(c);
  assert.deepEqual(c.updates, []);
  assert.equal(c.imu.live, undefined);
});

// ─── modules/sup-foreground-service JS wrapper ───────────────────────────────

function wrapper(os, { installed = true } = {}) {
  const calls = []; const tasks = [];
  const mod = loadTs('modules/sup-foreground-service/index.ts', { mocks: {
    'react-native': { Platform: { OS: os }, AppRegistry: { registerHeadlessTask: (name) => tasks.push(name) } },
    'expo-modules-core': { requireOptionalNativeModule: (name) => (installed ? {
      start: (...args) => calls.push(['start', name, ...args]), stop: () => calls.push(['stop']),
    } : null) },
  } });
  return { mod, calls, tasks };
}

test('Android keeps v2’s exact native call (title, body) and its keep-alive task', () => {
  const w = wrapper('android');
  w.mod.startTrackingService('t', 'b', 123);
  w.mod.stopTrackingService();
  assert.deepEqual(w.calls, [['start', 'SupForegroundService', 't', 'b'], ['stop']]);
  assert.deepEqual(w.tasks, ['SupTrackingKeepAlive']);
});

test('iOS passes the session start to the Live Activity and registers no Android task', () => {
  const w = wrapper('ios');
  w.mod.startTrackingService('t', 'b', 123);
  w.mod.startTrackingService('placeholder', 'b');
  assert.deepEqual(w.calls, [['start', 'SupForegroundService', 't', 'b', 123], ['start', 'SupForegroundService', 'placeholder', 'b', null]]);
  assert.deepEqual(w.tasks, []);
});

test('a build without the native module (old dev build) quietly does nothing', () => {
  for (const os of ['android', 'ios']) {
    const w = wrapper(os, { installed: false });
    w.mod.startTrackingService('t', 'b', 1); w.mod.stopTrackingService();
    assert.deepEqual([w.calls, w.tasks], [[], []]);
  }
});

test('iOS native pieces are wired: module registered for Apple, Live Activities enabled, widget target configured', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const moduleConfig = JSON.parse(read('../modules/sup-foreground-service/expo-module.config.json'));
  assert.deepEqual(moduleConfig.apple.modules, ['SupForegroundServiceModule']);
  const app = JSON.parse(read('../app.json')).expo;
  assert.equal(app.ios.infoPlist.NSSupportsLiveActivities, true);
  assert.ok(app.plugins.includes('@bacons/apple-targets'));
  // The attributes type must be identical in the app module and the widget (ActivityKit matches by it).
  const body = (s) => s.slice(s.indexOf('@available'));
  assert.equal(body(read('../modules/sup-foreground-service/ios/SupSessionAttributes.swift')), body(read('../targets/sup-live-activity/SupSessionAttributes.swift')));
  assert.ok(read('../modules/sup-foreground-service/ios/SupForegroundService.podspec').includes("s.weak_frameworks = 'ActivityKit'"));
  const swift = read('../modules/sup-foreground-service/ios/SupForegroundServiceModule.swift');
  assert.ok(swift.includes('Name("SupForegroundService")'), 'same module name as Android, so the JS wrapper finds it');
  assert.ok(swift.includes('Function("start") { (title: String, body: String, startedAtMs: Double?)'));
  assert.ok(swift.includes('Function("stop")'));
});

test('a native update failure is reported and doesn’t break the session', () => {
  const c = component({ failNative: true });
  c.render(); start(c);
  assert.equal(c.sentry.errors.at(-1).context, 'tracking-service-update');
});

// ─── Starting / stopping the service (IMUContext, ported from v2) ────────────

test('connecting both s’pots starts the service with a placeholder (not “s’up is tracking your posture”); ending stops it', async () => {
  const s = setupImu();
  await flush();
  s.connected('top'); s.connected('bottom');
  s.packets(); await flush(); s.rerender();
  const starts = s.calls.tracking.filter(([kind]) => kind === 'start');
  assert.deepEqual(starts[0], ['start', "s'pots connected", "starting your s'ession…"]);
  assert.ok(!s.calls.tracking.some(([, title]) => /tracking your posture/.test(title ?? '')));
  await s.ctx().disconnectAll(); s.rerender();
  assert.deepEqual(s.calls.tracking.at(-1), ['stop'], 'session end stops the service, which removes the notification');
});

test('IMUContext feeds every packet’s confirmed posture to the live status, also in the background', async () => {
  const s = setupImu();
  const seen = [];
  s.ctx().registerLiveStatus((update) => seen.push(update));
  await flush();
  s.connected('top'); s.connected('bottom');
  s.packets(); await flush(); s.rerender();
  s.stream(1000, 60);
  assert.ok(seen.length > 5, 'per packet');
  assert.equal(seen.at(-1).state, 'severe');
  assert.equal(typeof seen.at(-1).sessionStartTimeMs, 'number');
  s.background();
  const before = seen.length;
  s.stream(1000, 0);
  assert.ok(seen.length > before, 'still fed while backgrounded');
  assert.equal(seen.at(-1).state, 'upright');
});

// ─── Old separate channel cleanup ─────────────────────────────────────────────

test('the earlier separate "Live s’ession" channel is deleted on Android', async () => {
  const deleted = [];
  const Notifications = {
    SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
    AndroidImportance: { LOW: 2, DEFAULT: 3, HIGH: 4 },
    AndroidNotificationVisibility: { PUBLIC: 1 },
    DEFAULT_ACTION_IDENTIFIER: 'default',
    setNotificationHandler() {},
    requestPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }),
    setNotificationChannelAsync: async () => {},
    deleteNotificationChannelAsync: async (id) => { deleted.push(id); },
    setNotificationCategoryAsync: async () => {},
  };
  const mod = loadTs('src/services/reminder/pushNotificationService.ts', {
    globals: { console: quietConsole },
    mocks: {
      'expo-notifications': Notifications,
      'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
      'expo-router': { router: { navigate() {} } },
      '@/src/lib/supabase': fakeSupabase().module,
      '@/src/lib/sentry': fakeSentry().module,
      './reminderEngineService': { getReminderForUser: async () => null, getReEngagementReminder: async () => null },
    },
  });
  await mod.setupNotifications();
  assert.deepEqual(deleted, ['session_live']);
});

// ─── Native: swiping the notification away (source checks; needs a device to run) ─

test('the Android service re-posts its notification when swiped away, but never restarts after stopping', async () => {
  const { readFileSync } = await import('node:fs');
  const kt = readFileSync(new URL('../modules/sup-foreground-service/android/src/main/java/expo/modules/supforegroundservice/PostureTrackingService.kt', import.meta.url), 'utf8');
  assert.match(kt, /\.setDeleteIntent\(repostIntent\(\)\)/, 'dismissal sends the repost intent');
  assert.match(kt, /setAction\(ACTION_REPOST\)/);
  assert.match(kt, /if \(lastTitle == null\) \{\s*stopSelf\(startId\)\s*return START_NOT_STICKY/, 'a late dismissal after stop() does not start the service');
  assert.match(kt, /if \(repost\) getSystemService\(NotificationManager::class\.java\)\.notify\(NOTIFICATION_ID, notification\)/);
  assert.match(kt, /return START_NOT_STICKY\s*\}\s*\n\s*override fun onDestroy/, 'still not restarted by Android after a process kill');
});
