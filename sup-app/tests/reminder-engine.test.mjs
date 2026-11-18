// Reminder engine rules (active hours, cooldown, daily cap, re-engagement,
// encouragement spacing, no-repeat content) against a fake Supabase.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eqs, fakeClock, fakeSentry, fakeSupabase, loadTs, opArg, quietConsole } from './helpers/harness.mjs';

const MIN = 60_000;
const HOUR = 60 * MIN;

function engine({
  at = new Date(2026, 10, 13, 14, 0), profile = {}, lastSentAgoMin = null, sentToday = 0,
  recentTypes = [], recentContentIds = [], content = [{ id: 1, title: 'sit tall', body: 'b', action_label: 'done', sort_order: 1 }],
  random = 0.5, user = { id: 'user-1' },
} = {}) {
  const clock = fakeClock(at.getTime());
  const fullProfile = {
    id: 'user-1', primary_goals: ['desk_posture'], preferred_tones: ['gentle'], reminder_frequency: 'medium',
    active_time_presets: ['afternoon'], weekly_goals: ['awareness_only'],
    last_app_interaction_at: new Date(at.getTime() - HOUR).toISOString(), ...profile,
  };
  const db = fakeSupabase((q) => {
    const sel = opArg(q, 'select');
    if (q.table === 'user_profile') return { data: fullProfile, error: null };
    if (q.table === 'reminder_content') {
      return { data: content.map((c) => ({ reminder_type: eqs(q).reminder_type, tone: eqs(q).tone ?? 'gentle', active: true, ...c })), error: null };
    }
    if (q.table === 'reminder_log') {
      if (opArg(q, 'insert')) return { data: { id: 'log-1' }, error: null };
      if (sel === 'sent_at') return { data: lastSentAgoMin == null ? [] : [{ sent_at: new Date(at.getTime() - lastSentAgoMin * MIN).toISOString() }], error: null };
      if (sel === 'id') return { data: Array.from({ length: sentToday }, (_, i) => ({ id: i })), error: null };
      if (sel === 'reminder_type') return { data: recentTypes.map((t) => ({ reminder_type: t })), error: null };
      if (sel === 'reminder_content_id') return { data: recentContentIds.map((id) => ({ reminder_content_id: id })), error: null };
    }
    return { data: null, error: null };
  }, { user });
  const math = Object.create(Math);
  math.random = typeof random === 'function' ? random : () => random;
  const mod = loadTs('src/services/reminder/reminderEngineService.ts', {
    mocks: { '@/src/lib/supabase': db.module },
    globals: { Date: clock.Date, console: quietConsole, Math: math },
  });
  const logged = () => db.queries.filter((q) => q.table === 'reminder_log' && opArg(q, 'insert')).map((q) => opArg(q, 'insert'));
  return { get: () => mod.getReminderForUser(), logged, db, mod, clock, math };
}

test('a reminder is sent and logged when every rule passes', async () => {
  const e = engine();
  const r = await e.get();
  assert.equal(r.title, 'sit tall');
  assert.equal(e.logged().length, 1);
  assert.equal(e.logged()[0].reminder_content_id, 1);
});

test('signed-out users never get reminders', async () => {
  const e = engine({ user: null });
  assert.equal(await e.get(), null);
  assert.equal(e.db.queries.length, 0);
});

test('active-hour presets use the phone\'s local clock, inclusive at both ends', async () => {
  const cases = [
    ['morning', 7, 0, true], ['morning', 11, 59, true], ['morning', 12, 0, false], ['morning', 6, 59, false],
    ['afternoon', 12, 0, true], ['afternoon', 16, 59, true], ['afternoon', 17, 0, false],
    ['evening', 17, 0, true], ['evening', 20, 59, true], ['evening', 21, 0, false],
    ['late_night', 21, 0, true], ['late_night', 23, 59, true], ['late_night', 0, 30, true], ['late_night', 1, 0, true],
    ['late_night', 1, 1, false], ['late_night', 6, 0, false],
  ];
  for (const [preset, h, m, sends] of cases) {
    const e = engine({ at: new Date(2026, 10, 13, h, m), profile: { active_time_presets: [preset] } });
    assert.equal((await e.get()) !== null, sends, `${preset} at ${h}:${String(m).padStart(2, '0')}`);
  }
  assert.equal(await engine({ profile: { active_time_presets: [] } }).get(), null, 'no presets → never');
});

test('cooldown per frequency: light 45, medium 30, active 15 minutes', async () => {
  for (const [frequency, cooldown] of [['light', 45], ['medium', 30], ['active', 15]]) {
    assert.equal(await engine({ profile: { reminder_frequency: frequency }, lastSentAgoMin: cooldown - 1 }).get(), null, `${frequency} blocked`);
    assert.notEqual(await engine({ profile: { reminder_frequency: frequency }, lastSentAgoMin: cooldown }).get(), null, `${frequency} allowed`);
  }
});

test('daily cap per frequency: light 3, medium 6, active 10', async () => {
  for (const [frequency, cap] of [['light', 3], ['medium', 6], ['active', 10]]) {
    assert.notEqual(await engine({ profile: { reminder_frequency: frequency }, sentToday: cap - 1 }).get(), null);
    assert.equal(await engine({ profile: { reminder_frequency: frequency }, sentToday: cap }).get(), null, `${frequency} capped`);
  }
});

test('48h without opening the app forces a re-engagement reminder', async () => {
  const at = new Date(2026, 10, 13, 14, 0);
  const e = engine({ at, profile: { last_app_interaction_at: new Date(at.getTime() - 48 * HOUR).toISOString() } });
  await e.get();
  assert.equal(e.logged()[0].reminder_type, 're_engagement');
  const fresh = engine({ at, profile: { last_app_interaction_at: new Date(at.getTime() - 47 * HOUR).toISOString() } });
  await fresh.get();
  assert.notEqual(fresh.logged()[0].reminder_type, 're_engagement');
});

test('encouragement is never sent twice in a row', async () => {
  // general_posture_awareness has encouragement 0.1; random 0.01 would pick it.
  const e = engine({ profile: { primary_goals: ['general_posture_awareness'] }, recentTypes: ['encouragement'], random: 0.01 });
  await e.get();
  assert.notEqual(e.logged()[0].reminder_type, 'encouragement');
});

test('reminder type follows the goal distribution (desk_posture: check 0.6, reset 0.3, break 0.1)', async () => {
  for (const [roll, type] of [[0.05, 'posture_check'], [0.65, 'posture_reset'], [0.95, 'movement_break']]) {
    const e = engine({ random: roll });
    await e.get();
    assert.equal(e.logged()[0].reminder_type, type, `roll ${roll}`);
  }
});

test('content shown in the last 5 reminders is not repeated', async () => {
  let n = 0;
  // First fetch returns the recent id 1; retries return id 2.
  const e = engine({ recentContentIds: [1], content: [{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }], random: () => (n++ < 4 ? 0.1 : 0.99) });
  const r = await e.get();
  assert.notEqual(r?.id, 1);
});

// ── Re-engagement (scheduled with the OS, since the in-app check only runs while the app is open) ──

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m);

test('next active moment: inside a window stays put, otherwise waits for the next preset start', () => {
  const { mod } = engine();
  const next = (from, presets) => mod.nextActiveMoment(from, presets)?.getTime();
  assert.equal(next(at(15, 14), ['afternoon']), at(15, 14).getTime());
  assert.equal(next(at(15, 18), ['afternoon']), at(16, 12).getTime(), 'after the window → tomorrow');
  assert.equal(next(at(15, 8), ['afternoon']), at(15, 12).getTime(), 'before the window → today');
  assert.equal(next(at(15, 18), ['morning', 'late_night']), at(15, 21).getTime(), 'earliest of several presets');
  assert.equal(next(at(15, 0, 30), ['late_night']), at(15, 0, 30).getTime(), 'late night runs past midnight');
  assert.equal(next(at(15, 1, 30), ['late_night']), at(15, 21).getTime());
  assert.equal(mod.nextActiveMoment(at(15, 9), []), null);
});

test('re-engagement is due 48h after leaving, shifted into active hours', async () => {
  const leftAt = at(13, 14);
  const e = engine({ at: leftAt, content: [{ id: 9, title: 'we miss you', body: 'b', action_label: 'open', sort_order: 1 }] });
  const r = await e.mod.getReEngagementReminder(leftAt);
  assert.equal(r.fireAt.getTime(), at(15, 14).getTime());
  assert.equal(r.content.id, 9);
  const contentQuery = e.db.queries.find((q) => q.table === 'reminder_content');
  assert.equal(eqs(contentQuery).reminder_type, 're_engagement');
  assert.equal(e.logged().length, 0, 'not logged until it is actually delivered and tapped');
  // Left at 18:00 with afternoon hours → 48h later is 18:00, outside → next day 12:00.
  const late = engine({ at: at(13, 18) });
  assert.equal((await late.mod.getReEngagementReminder(at(13, 18))).fireAt.getTime(), at(16, 12).getTime());
});

test('no re-engagement for guests, users without active hours, or with no content', async () => {
  assert.equal(await engine({ user: null }).mod.getReEngagementReminder(), null);
  assert.equal(await engine({ profile: { active_time_presets: [] } }).mod.getReEngagementReminder(), null);
  assert.equal(await engine({ content: [] }).mod.getReEngagementReminder(), null);
});

function notificationService(options) {
  const e = engine(options);
  const calls = [];
  const Notifications = {
    setNotificationHandler() {},
    SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
    cancelScheduledNotificationAsync: async (id) => calls.push(['cancel', id]),
    scheduleNotificationAsync: async (req) => calls.push(['schedule', req]),
    dismissNotificationAsync: async () => {},
    addNotificationResponseReceivedListener: (cb) => { calls.onResponse = cb; return { remove() {} }; },
    addNotificationReceivedListener: () => ({ remove() {} }),
    DEFAULT_ACTION_IDENTIFIER: 'default',
  };
  const svc = loadTs('src/services/reminder/pushNotificationService.ts', {
    mocks: {
      'expo-notifications': Notifications,
      'react-native': { AppState: { currentState: 'background' }, Platform: { OS: 'android' } },
      'expo-router': { router: { navigate() {} } },
      '@/src/lib/supabase': e.db.module,
      // via the posture check-in service, which reports save errors to Sentry
      '@/src/lib/sentry': fakeSentry().module,
    },
    globals: { Date: e.clock.Date, console: quietConsole, Math: e.math },
  });
  return { ...e, svc, calls };
}

test('leaving the app replaces the pending re-engagement reminder with one 48h out', async () => {
  const n = notificationService({ at: at(13, 14) });
  await n.svc.scheduleReEngagementReminder();
  assert.deepEqual(n.calls[0], ['cancel', 're-engagement']);
  const [, req] = n.calls[1];
  assert.equal(req.identifier, 're-engagement', 'fixed id, so the next schedule replaces it');
  assert.equal(req.trigger.type, 'date');
  assert.equal(req.trigger.date.getTime(), at(15, 14).getTime());
  assert.equal(req.content.data.type, 're_engagement');
});

test('signed out: the pending re-engagement reminder is cancelled and nothing new is scheduled', async () => {
  const n = notificationService({ user: null });
  await n.svc.scheduleReEngagementReminder();
  assert.deepEqual(n.calls.map(([kind]) => kind), ['cancel']);
});

test('tapping a re-engagement reminder logs its own reminder_log row', async () => {
  const n = notificationService({ at: at(15, 14) });
  n.svc.setupNotificationListeners();
  await n.calls.onResponse({
    actionIdentifier: 'DONE',
    notification: { request: { identifier: 're-engagement', content: { data: {
      type: 're_engagement', actionLabel: 'open', reminderContentId: 9, fireAt: at(15, 14).toISOString(),
    } } } },
  });
  const rows = n.logged();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].reminder_type, rows[0].reminder_content_id, rows[0].user_interacted, rows[0].interaction_action],
    ['re_engagement', 9, true, 'DONE']);
  const updates = n.db.queries.filter((q) => q.table === 'reminder_log' && opArg(q, 'update'));
  assert.equal(updates.length, 0, 'does not mark an older reminder as tapped');
});
