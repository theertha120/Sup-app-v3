// Daily goals: the hardcoded bank, daily offer picks, and daily_goals queries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, fakeSupabase, eqs, opArg } from './helpers/harness.mjs';

const { GOAL_BANK } = loadTs('src/lib/goals/goalBank.ts');
const { dailyOffers, goalSetFor, sectionsFor, groupByDate } = loadTs('src/lib/goals/dailyGoals.ts');

test('bank has 50 unique goals per difficulty per section, with the right sections per set', () => {
  assert.deepEqual(Object.keys(GOAL_BANK.hardware), ['posture', 'exercise', 'sitting']);
  assert.deepEqual(Object.keys(GOAL_BANK.no_hardware), ['posture', 'exercise']);
  for (const [set, sections] of Object.entries(GOAL_BANK)) {
    for (const [section, tiers] of Object.entries(sections)) {
      assert.deepEqual(Object.keys(tiers), ['easy', 'medium', 'hard']);
      const all = [];
      for (const [difficulty, goals] of Object.entries(tiers)) {
        assert.equal(goals.length, 50, `${set}.${section}.${difficulty}`);
        for (const g of goals) assert.ok(g.trim().length > 0 && g.length <= 200, g);
        all.push(...goals);
      }
      const dupes = all.filter((g, i) => all.indexOf(g) !== i);
      assert.deepEqual(dupes, [], `${set}.${section} duplicates`);
    }
  }
});

test('goal set follows hardware; sitting only for hardware users', () => {
  assert.equal(goalSetFor(true), 'hardware');
  assert.equal(goalSetFor(false), 'no_hardware');
  assert.deepEqual(sectionsFor('hardware'), ['posture', 'exercise', 'sitting']);
  assert.deepEqual(sectionsFor('no_hardware'), ['posture', 'exercise']);
});

test('offers are one easy/medium/hard per section, stable within a day, and vary across days', () => {
  const day = dailyOffers('user-1', '2026-11-20', 'hardware');
  assert.deepEqual(day.map((s) => s.section), ['posture', 'exercise', 'sitting']);
  for (const { section, offers } of day) {
    assert.deepEqual(offers.map((o) => o.difficulty), ['easy', 'medium', 'hard']);
    for (const o of offers) {
      const index = Number(o.goalId.split(':')[3]);
      assert.equal(o.goalId, `hardware:${section}:${o.difficulty}:${index}`);
      assert.equal(o.text, GOAL_BANK.hardware[section][o.difficulty][index]);
    }
  }
  assert.deepEqual(dailyOffers('user-1', '2026-11-20', 'hardware'), day);

  const ids = (userId, date) => dailyOffers(userId, date, 'no_hardware').flatMap((s) => s.offers.map((o) => o.goalId)).join();
  const days = new Set(Array.from({ length: 30 }, (_, i) => ids('user-1', `2026-11-${String(i + 1).padStart(2, '0')}`)));
  assert.ok(days.size >= 28, `only ${days.size} distinct days of offers`);
  assert.notEqual(ids('user-1', '2026-11-20'), ids('user-2', '2026-11-20'));
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

test('picking stores the offer text, set and local day for the user', async () => {
  const { service, queries } = loadService(() => ({ data: { id: 'g1' }, error: null }));
  const offer = { goalId: 'no_hardware:posture:easy:3', set: 'no_hardware', section: 'posture', difficulty: 'easy', text: 'x' };
  await service.pickGoal('user-1', '2026-11-20', offer);
  assert.equal(queries[0].table, 'daily_goals');
  assert.deepEqual(opArg(queries[0], 'insert'), {
    user_id: 'user-1', goal_date: '2026-11-20', goal_set: 'no_hardware', section: 'posture',
    difficulty: 'easy', goal_id: offer.goalId, goal_text: 'x',
  });
});

test('un-picking never deletes a completed goal; completing is scoped to the owner', async () => {
  const { service, queries } = loadService(() => ({ data: { id: 'g1' }, error: null }));
  await service.unpickGoal('user-1', 'g1');
  assert.deepEqual(eqs(queries[0]), { id: 'g1', user_id: 'user-1' });
  assert.deepEqual(queries[0].ops.find(([m]) => m === 'is'), ['is', 'completed_at', null]);

  await service.setGoalCompleted('user-1', 'g1', true);
  assert.deepEqual(eqs(queries[1]), { id: 'g1', user_id: 'user-1' });
  assert.equal(typeof opArg(queries[1], 'update').completed_at, 'string');
  await service.setGoalCompleted('user-1', 'g1', false);
  assert.equal(opArg(queries[2], 'update').completed_at, null);
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
