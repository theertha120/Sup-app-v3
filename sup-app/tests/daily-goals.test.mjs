// Daily goals: the hardcoded bank, daily offer picks, auto-completion rules,
// and daily_goals / goal-data queries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, fakeSupabase, eqs, opArg } from './helpers/harness.mjs';

const { GOAL_BANK } = loadTs('src/lib/goals/goalBank.ts');
const { dailyOffers, goalSetFor, sectionsFor, groupByDate } = loadTs('src/lib/goals/dailyGoals.ts');
const { evaluateRule, ruleFeasible, ruleSources, dayPartOf } = loadTs('src/lib/goals/goalRules.ts');

const ON = { notificationsAllowed: true, yesterdaySupScore: null, yesterdayDeskMs: null };
const ALL_ON = { ...ON, frequency: 'active', presets: ['morning', 'afternoon', 'evening', 'late_night'] };
const at = (h, m = 0) => new Date(2026, 10, 20, h, m).getTime();
const MIN = 60_000;
const emptyDay = () => ({ checkIns: [], sessions: [], workouts: [], supScore: null, yesterdaySupScore: null, yesterdayDeskMs: null });
const day = (patch) => ({ ...emptyDay(), ...patch });
const evalRule = (rule, patch) => evaluateRule(rule, day(patch));

test('bank has 50 unique, evaluable goals per difficulty per section, with the right sections per set', () => {
  assert.deepEqual(Object.keys(GOAL_BANK.hardware), ['posture', 'exercise', 'sitting']);
  assert.deepEqual(Object.keys(GOAL_BANK.no_hardware), ['posture', 'exercise']);
  for (const [set, sections] of Object.entries(GOAL_BANK)) {
    for (const [section, tiers] of Object.entries(sections)) {
      assert.deepEqual(Object.keys(tiers), ['easy', 'medium', 'hard']);
      const rules = [];
      for (const [difficulty, goals] of Object.entries(tiers)) {
        assert.equal(goals.length, 50, `${set}.${section}.${difficulty}`);
        for (const g of goals) {
          assert.ok(g.text.trim() && g.text.length <= 200 && g.rule.length <= 64, g.rule);
          const result = evaluateRule(g.rule, emptyDay());
          assert.notEqual(result.blocked, 'unknown goal', g.rule);
          assert.equal(result.done, false, `${g.rule} is done with no data`);
        }
        rules.push(...goals.map((g) => g.rule));
      }
      assert.deepEqual(rules.filter((r, i) => rules.indexOf(r) !== i), [], `${set}.${section} duplicates`);
    }
  }
});

test('sections draw on the right data: no-hardware posture is check-ins only; sitting is desk mode', () => {
  const sources = (set, section) => new Set(Object.values(GOAL_BANK[set][section]).flat().flatMap((g) => ruleSources(g.rule)));
  assert.deepEqual([...sources('no_hardware', 'posture')], ['checkIns']);
  assert.deepEqual([...sources('no_hardware', 'exercise')], ['workouts']);
  assert.ok(sources('hardware', 'posture').has('checkIns') && sources('hardware', 'posture').has('sessions'));
  assert.ok([...sources('hardware', 'sitting')].every((s) => s === 'sessions' || s === 'daily'));
});

test('goal set follows hardware; sitting only for hardware users', () => {
  assert.equal(goalSetFor(true), 'hardware');
  assert.equal(goalSetFor(false), 'no_hardware');
  assert.deepEqual(sectionsFor('hardware'), ['posture', 'exercise', 'sitting']);
  assert.deepEqual(sectionsFor('no_hardware'), ['posture', 'exercise']);
});

test('offers are one easy/medium/hard per section, stable within a day, and vary across days', () => {
  const offers = dailyOffers('user-1', '2026-11-20', 'hardware', ALL_ON);
  assert.deepEqual(offers.map((s) => s.section), ['posture', 'exercise', 'sitting']);
  for (const { section, offers: list } of offers) {
    assert.deepEqual(list.map((o) => o.difficulty), ['easy', 'medium', 'hard']);
    for (const o of list) {
      const def = GOAL_BANK.hardware[section][o.difficulty].find((g) => g.rule === o.goalId);
      assert.equal(o.text, def.text);
    }
  }
  assert.deepEqual(dailyOffers('user-1', '2026-11-20', 'hardware', ALL_ON), offers);
  const ids = (userId, date) => dailyOffers(userId, date, 'no_hardware', ALL_ON).flatMap((s) => s.offers.map((o) => o.goalId)).join();
  const days = new Set(Array.from({ length: 30 }, (_, i) => ids('user-1', `2026-11-${String(i + 1).padStart(2, '0')}`)));
  assert.ok(days.size >= 28, `only ${days.size} distinct days of offers`);
  assert.notEqual(ids('user-1', '2026-11-20'), ids('user-2', '2026-11-20'));
});

test('check-in goals respect the daily cap and active presets', () => {
  const light = { ...ON, frequency: 'light', presets: ['morning'] };
  assert.equal(ruleFeasible('ci_done:3', light), true);
  assert.equal(ruleFeasible('ci_done:4', light), false);
  assert.equal(ruleFeasible('ci_part:morning:2', light), true);
  assert.equal(ruleFeasible('ci_part:evening:1', light), false);
  assert.equal(ruleFeasible('ci_parts:2', light), false);
  assert.equal(ruleFeasible('ci_rate:100:6', { ...ON, frequency: 'medium', presets: ['morning'] }), true);
  assert.equal(ruleFeasible('ci_done:1', { ...ON, frequency: null, presets: [] }), false);
  assert.equal(ruleFeasible('dk_total:30', { ...ON, frequency: null, presets: [] }), true);

  for (const settings of [light, { ...ON, frequency: 'light', presets: ['late_night'] }]) {
    for (const { section, offers } of dailyOffers('user-1', '2026-11-20', 'no_hardware', settings)) {
      if (section === 'posture') assert.equal(offers.length, 3, 'a light-reminder user still gets every tier');
      for (const o of offers) assert.ok(ruleFeasible(o.goalId, settings), o.goalId);
    }
  }
  const off = dailyOffers('user-1', '2026-11-20', 'hardware', { ...ON, frequency: null, presets: [] });
  assert.equal(off.find((s) => s.section === 'posture').offers.length, 3, 'hardware users keep posture-quality goals');
  assert.equal(dailyOffers('user-1', '2026-11-20', 'no_hardware', { ...ON, frequency: null, presets: [] })[0].offers.length, 0);
});

test('check-in rules count responses, speed, parts of the day and runs; dismissals never count', () => {
  const ci = (sentH, sentM, delayMin, action) => ({
    sentAt: at(sentH, sentM),
    interactedAt: delayMin == null ? null : at(sentH, sentM) + delayMin * MIN,
    action: action ?? null,
  });
  const checkIns = [ci(9, 0, 5, 'DONE'), ci(10, 0, 40, 'expo.modules.notifications.actions.DEFAULT'),
    ci(13, 0, null), ci(14, 0, 2, 'DISMISS'), ci(18, 0, 8, 'DONE')];
  assert.equal(evalRule('ci_done:2', { checkIns }).done, true);
  assert.equal(evalRule('ci_done:3', { checkIns }).current, 2);
  assert.equal(evalRule('ci_resp:3', { checkIns }).done, true);
  assert.equal(evalRule('ci_resp:4', { checkIns }).done, false);
  assert.equal(evalRule('ci_fast:2:10', { checkIns }).done, true);
  assert.equal(evalRule('ci_fast:3:10', { checkIns }).done, false);
  assert.equal(evalRule('ci_dfast:2:10', { checkIns }).done, true);
  assert.equal(evalRule('ci_first:5', { checkIns }).done, true);
  assert.equal(evalRule('ci_first:4', { checkIns }).blocked, "today's first check-in was missed");
  assert.equal(evalRule('ci_part:morning:2', { checkIns }).done, true);
  assert.equal(evalRule('ci_part:afternoon:1', { checkIns }).done, false);
  assert.equal(evalRule('ci_parts:2', { checkIns }).done, true);
  assert.equal(evalRule('ci_parts:3', { checkIns }).done, false);
  assert.equal(evalRule('ci_run:2', { checkIns }).done, true);
  assert.equal(evalRule('ci_run:3', { checkIns }).done, false);
  assert.equal(evalRule('ci_rate:60:5', { checkIns }).done, true); // 3 of 5
  assert.equal(evalRule('ci_rate:75:5', { checkIns }).done, false);
  const clean = evalRule('ci_clean:2', { checkIns });
  assert.equal(clean.done, false);
  assert.match(clean.blocked, /dismissed/);
  assert.equal(evalRule('ci_clean:2', { checkIns: [checkIns[0], checkIns[4]] }).done, true);
  assert.equal(dayPartOf(at(0, 30)), 'late_night');
  assert.equal(dayPartOf(at(4, 0)), null);
});

test('posture-quality rules use completed sessions and the s\'core, with a minimum tracked time', () => {
  const session = (startH, mins, totals) => ({ startedAt: at(startH), endedAt: at(startH) + mins * MIN, durationMs: mins * MIN, stateTotals: totals });
  const sessions = [
    session(9, 40, { upright: 24 * MIN, slouched: 10 * MIN, severe: 2 * MIN, forward_lean: 4 * MIN, transition: 9 * MIN }),
    session(14, 20, { upright: 6 * MIN, slouched: 10 * MIN, severe: 4 * MIN }),
  ];
  assert.equal(evalRule('up_min:30', { sessions }).done, true);
  assert.equal(evalRule('up_pct:50:45', { sessions }).done, true); // 30 of 60 states, transition excluded
  assert.equal(evalRule('up_pct:55:45', { sessions }).done, false);
  assert.equal(evalRule('up_sess:60:30', { sessions }).done, true);
  assert.equal(evalRule('up_sess:60:45', { sessions }).done, false);
  assert.equal(evalRule('sev_max:12:45', { sessions }).done, true); // 6 of 60 = 10%
  const sev = evalRule('sev_max:8:45', { sessions });
  assert.equal(sev.done, false);
  assert.ok(sev.blocked);
  assert.equal(evalRule('sev_max:12:90', { sessions }).done, false, 'needs the minimum tracked time');
  assert.equal(evalRule('sc_score:60', { supScore: 61 }).done, true);
  assert.equal(evalRule('sc_score:55', {}).done, false, 'no tracking stays at the daily 50 start');
  assert.equal(evalRule('sc_beat:3', { supScore: 64, yesterdaySupScore: 62 }).done, false);
  assert.equal(evalRule('sc_beat:3', { supScore: 65, yesterdaySupScore: 62 }).done, true);
});

test('desk rules use session time, counts, parts of the day and yesterday', () => {
  const session = (startH, mins) => ({ startedAt: at(startH), endedAt: at(startH) + mins * MIN, durationMs: mins * MIN, stateTotals: null });
  const sessions = [session(8, 50), session(13, 25), session(18, 10)];
  assert.equal(evalRule('dk_total:85', { sessions }).done, true);
  assert.equal(evalRule('dk_total:90', { sessions }).current, 85);
  assert.equal(evalRule('dk_count:2:20', { sessions }).done, true);
  assert.equal(evalRule('dk_count:3:20', { sessions }).done, false);
  assert.equal(evalRule('dk_long:50', { sessions }).done, true);
  assert.equal(evalRule('dk_part:afternoon:20', { sessions }).done, true);
  assert.equal(evalRule('dk_part:evening:20', { sessions }).done, false);
  assert.equal(evalRule('dk_parts:3:10', { sessions }).done, true);
  assert.equal(evalRule('dk_ptotal:morning:45', { sessions }).done, true);
  assert.equal(evalRule('dk_beat:20', { sessions, yesterdayDeskMs: 60 * MIN }).done, true);
  assert.equal(evalRule('dk_beat:30', { sessions, yesterdayDeskMs: 60 * MIN }).done, false);
});

test('exercise rules read logged sets, reps, holds, minutes, names, ratings and desk timing', () => {
  const workouts = [
    { id: 'w1', performed_on: '2026-11-20', back_feeling: 4, created_at: new Date(at(12)).toISOString(), exercises: [
      { name: 'Plank', category: 'strength', unit: 'seconds', values: [30, 30] },
      { name: 'Glute bridge', category: 'strength', unit: 'reps', values: [12, 12, 12] },
      { name: 'Yoga', category: 'other', unit: 'minutes', values: [20] },
    ] },
    { id: 'w2', performed_on: '2026-11-20', back_feeling: 2, created_at: new Date(at(8)).toISOString(), exercises: [
      { name: 'Wall sit', category: 'strength', unit: 'seconds', values: [45] },
    ] },
  ];
  const sessions = [{ startedAt: at(9), endedAt: at(10), durationMs: 60 * MIN, stateTotals: null }];
  assert.equal(evalRule('ex_log:2', { workouts }).done, true);
  assert.equal(evalRule('ex_kinds:4', { workouts }).done, true);
  assert.equal(evalRule('ex_one:3', { workouts }).done, true);
  assert.equal(evalRule('ex_one:4', { workouts }).done, false);
  assert.equal(evalRule('ex_sets:6', { workouts }).done, true);
  assert.equal(evalRule('ex_reps:36', { workouts }).done, true);
  assert.equal(evalRule('ex_hold:105', { workouts }).done, true);
  assert.equal(evalRule('ex_named:plank:60', { workouts }).done, true);
  assert.equal(evalRule('ex_named:plank:61', { workouts }).done, false);
  assert.equal(evalRule('ex_named:glute:36', { workouts }).done, true);
  assert.equal(evalRule('ex_named:yoga:20', { workouts }).done, true);
  assert.equal(evalRule('ex_min:25', { workouts }).done, false);
  assert.equal(evalRule('ex_mix', { workouts }).done, true);
  assert.equal(evalRule('ex_feel:4', { workouts }).done, true);
  assert.equal(evalRule('ex_feel:5', { workouts }).done, false);
  assert.equal(evalRule('ex_custom:1', { workouts }).done, true); // "Wall sit"
  assert.equal(evalRule('ex_acts:1', { workouts }).done, true);
  assert.equal(evalRule('ex_desk:1', { workouts, sessions }).done, true); // w1 saved after the 10am session ended
  assert.equal(evalRule('ex_desk:2', { workouts, sessions }).done, false);
  assert.equal(evalRule('ex_dmin:20', { workouts, sessions }).done, true);
  assert.equal(evalRule('ex_desk:1', { workouts }).done, false, 'no desk session, nothing counts');
});

test('groupByDate puts newest day first and keeps order within a day', () => {
  const g = (id, goal_date) => ({ id, goal_date });
  const grouped = groupByDate([g('a', '2026-11-18'), g('b', '2026-11-20'), g('c', '2026-11-18'), g('d', '2026-11-19')]);
  assert.deepEqual(grouped.map((d) => [d.date, d.goals.map((x) => x.id)]),
    [['2026-11-20', ['b']], ['2026-11-19', ['d']], ['2026-11-18', ['a', 'c']]]);
});

function loadService(respond) {
  const sb = fakeSupabase(respond);
  const service = loadTs('src/services/goals/dailyGoalsService.ts', { mocks: { '@/src/lib/supabase': sb.module } });
  return { ...sb, service };
}

test('hardware check looks for any posture session of this user only', async () => {
  const { service, queries } = loadService(() => ({ data: [{ id: 's1' }], error: null }));
  assert.equal(await service.hasLoggedPostureSession('user-1'), true);
  assert.equal(queries[0].table, 'posture_sessions');
  assert.deepEqual(eqs(queries[0]), { user_id: 'user-1' });
  assert.equal(opArg(queries[0], 'limit'), 1);
  const none = loadService(() => ({ data: [], error: null }));
  assert.equal(await none.service.hasLoggedPostureSession('user-1'), false);
});

test('picking stores the rule as goal_id with the text, set and local day', async () => {
  const { service, queries } = loadService(() => ({ data: { id: 'g1' }, error: null }));
  const offer = { goalId: 'ci_done:2', set: 'no_hardware', section: 'posture', difficulty: 'easy', text: 'x' };
  await service.pickGoal('user-1', '2026-11-20', offer);
  assert.equal(queries[0].table, 'daily_goals');
  assert.deepEqual(opArg(queries[0], 'insert'), {
    user_id: 'user-1', goal_date: '2026-11-20', goal_set: 'no_hardware', section: 'posture',
    difficulty: 'easy', goal_id: 'ci_done:2', goal_text: 'x',
  });
});

test('un-picking never deletes a completed goal; completing never overwrites an earlier completion', async () => {
  const { service, queries } = loadService(() => ({ data: [{ id: 'g1' }], error: null }));
  await service.unpickGoal('user-1', 'g1');
  assert.deepEqual(eqs(queries[0]), { id: 'g1', user_id: 'user-1' });
  assert.deepEqual(queries[0].ops.find(([m]) => m === 'is'), ['is', 'completed_at', null]);

  assert.deepEqual(await service.markGoalsCompleted('user-1', []), []);
  assert.equal(queries.length, 1, 'no write when nothing completed');
  await service.markGoalsCompleted('user-1', ['g1', 'g2']);
  assert.deepEqual(eqs(queries[1]), { user_id: 'user-1' });
  assert.deepEqual(queries[1].ops.find(([m]) => m === 'in'), ['in', 'id', ['g1', 'g2']]);
  assert.deepEqual(queries[1].ops.find(([m]) => m === 'is'), ['is', 'completed_at', null]);
  assert.equal(typeof opArg(queries[1], 'update').completed_at, 'string');
});

test('goal data queries are scoped to the user and the local day', async () => {
  const { service, queries } = loadService((q) => {
    if (q.table === 'reminder_log') return { data: [
      { sent_at: '2026-11-20T01:00:00Z', interaction_at: '2026-11-20T01:05:00Z', interaction_action: 'DONE', user_interacted: true },
      { sent_at: '2026-11-20T02:00:00Z', interaction_at: null, interaction_action: null, user_interacted: false },
    ], error: null };
    if (q.table === 'user_profile') return { data: { reminder_frequency: 'light', active_time_presets: ['morning'] }, error: null };
    return { data: [], error: null };
  });
  const checkIns = await service.fetchCheckInsForDay('user-1', '2026-11-20');
  assert.deepEqual(checkIns.map((c) => [c.interactedAt != null, c.action]), [[true, 'DONE'], [false, null]]);
  assert.deepEqual(eqs(queries[0]), { user_id: 'user-1' });
  assert.deepEqual(queries[0].ops.find(([m]) => m === 'neq'), ['neq', 'reminder_type', 're_engagement']);
  assert.equal(opArg(queries[0], 'gte'), 'sent_at');

  await service.fetchCompletedSessionsForDay('user-1', '2026-11-20');
  assert.deepEqual(eqs(queries[1]), { user_id: 'user-1', is_completed_session: true });
  await service.fetchWorkoutsForDay('user-1', '2026-11-20');
  assert.deepEqual(eqs(queries[2]), { user_id: 'user-1', performed_on: '2026-11-20' });
  assert.deepEqual(await service.fetchCheckInSettings('user-1'), { frequency: 'light', presets: ['morning'] });
});

test('completed history pages past the row limit and surfaces errors', async () => {
  const pages = [Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` })), [{ id: 'b0' }]];
  const { service, queries } = loadService(() => ({ data: pages.shift(), error: null }));
  const rows = await service.fetchCompletedGoals('user-1');
  assert.equal(rows.length, 501);
  assert.deepEqual(queries.map((q) => q.ops.find(([m]) => m === 'range').slice(1)), [[0, 499], [500, 999]]);
  assert.deepEqual(queries[0].ops.find(([m]) => m === 'not'), ['not', 'completed_at', 'is', null]);
  const failing = loadService(() => ({ data: null, error: new Error('boom') }));
  await assert.rejects(failing.service.fetchCompletedGoals('user-1'), /boom/);
});
