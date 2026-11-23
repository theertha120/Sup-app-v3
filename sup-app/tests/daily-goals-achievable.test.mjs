// Every goal in the bank can be completed by every user it can be offered to.
// For each goal and each user setup that ruleFeasible() allows, this builds a
// day of data the app could really produce, then checks the goal completes:
//   check-ins  — within the user's daily cap, cooldown and active presets
//                (reminderEngineService.ts), answered with "Yuh" (DONE)
//   workouts   — pass the Exercise form's own validateWorkout()
//   sessions   — fit inside the day without overlapping; the s'core is the
//                real formula (docs/score-methodology.md) over those sessions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/harness.mjs';

const { GOAL_BANK } = loadTs('src/lib/goals/goalBank.ts');
const { evaluateRule, ruleFeasible, parseRule, DAY_PARTS, CHECK_IN_LIMITS, MAX_REACHABLE_SCORE } = loadTs('src/lib/goals/goalRules.ts');
const { validateWorkout, EXERCISES } = loadTs('src/features/exercise/model.ts');

const DATE = '2026-11-20';
const MIN = 60_000;
const at = (minutes) => new Date(2026, 10, 20, 0, minutes).getTime(); // minutes since local midnight
const PARTS = ['morning', 'afternoon', 'evening', 'late_night'];
const FREQUENCIES = Object.keys(CHECK_IN_LIMITS);
const PRESET_SETS = Array.from({ length: 15 }, (_, mask) => PARTS.filter((_, i) => (mask + 1) & (1 << i)));
const NAMED = { plank: 'Plank', glute: 'Glute bridge', deadlift: 'Deadlift', yoga: 'Yoga', pilates: 'Pilates', cycling: 'Cycling', swimming: 'Swimming', sport: 'Sport' };

/** Minutes of the calendar day a part covers (late night = 21:00–24:00 plus 00:00–01:00). */
function partMinutes(part) {
  const { start, end } = DAY_PARTS[part];
  const out = [];
  for (let m = start; m < end; m++) out.push(m >= 24 * 60 ? m - 24 * 60 : m);
  return out;
}

/** Earliest send times the engine could produce: in active presets, cooldown apart, under the cap. */
function checkInTimes(settings, count, choose) {
  const { maxPerDay, cooldownMinutes } = CHECK_IN_LIMITS[settings.frequency];
  assert.ok(count <= maxPerDay, 'witness exceeds the daily cap');
  const allowed = new Set(settings.presets.flatMap(partMinutes));
  const times = [];
  for (const part of choose) {
    for (const m of partMinutes(part).sort((a, b) => a - b)) {
      if (!allowed.has(m)) continue;
      if (times.every((t) => Math.abs(t - m) >= cooldownMinutes)) { times.push(m); break; }
    }
    if (times.length === count) break;
  }
  return times.sort((a, b) => a - b);
}

function checkInWitness(kind, args, settings) {
  const n = Number(args[0]);
  const presets = settings.presets;
  let count; let choose;
  switch (kind) {
    case 'ci_first': count = 1; choose = [presets[0]]; break;
    case 'ci_parts': count = n; choose = presets.slice(0, n); break;
    case 'ci_part': count = Number(args[1]); choose = Array(count).fill(args[0]); break;
    case 'ci_rate': count = Number(args[1]); break;
    default: count = n;
  }
  // Fill any part when the rule doesn't care where check-ins land.
  choose ??= Array.from({ length: count }, (_, i) => presets[i % presets.length]);
  let times = checkInTimes(settings, count, choose);
  if (times.length < count && kind !== 'ci_part' && kind !== 'ci_parts') {
    times = checkInTimes(settings, count, Array.from({ length: count * presets.length }, (_, i) => presets[i % presets.length]));
  }
  assert.equal(times.length, count, `no room for ${count} check-ins`);
  return { checkIns: times.map((m) => ({ sentAt: at(m), interactedAt: at(m) + 0.5 * MIN, action: 'DONE' })) };
}

const score = (uprightMinutes) => Math.round((100 * uprightMinutes + 50 * 10) / (uprightMinutes + 10));
/** Shortest all-upright tracking that rounds to at least `target`. */
function minutesForScore(target) {
  let t = 0;
  while (score(t) < target) { t++; assert.ok(t <= 24 * 60, `a s'core of ${target} isn't reachable in a day`); }
  return t;
}
const upright = (startMin, minutes) => ({
  startedAt: at(startMin), endedAt: at(startMin + minutes), durationMs: minutes * MIN, stateTotals: { upright: minutes * MIN },
});
function withScore(sessions, extra = {}) {
  const uprightMin = sessions.reduce((s, x) => s + (x.stateTotals?.upright ?? 0), 0) / MIN;
  return { sessions, supScore: sessions.length ? score(uprightMin) : null, ...extra };
}

function sessionWitness(kind, args, ctx) {
  const a = args.map(Number);
  const startOf = (part) => DAY_PARTS[part].start;
  switch (kind) {
    case 'sc_score': return withScore([upright(9 * 60, minutesForScore(a[0]))]);
    case 'sc_beat': return withScore([upright(9 * 60, minutesForScore((ctx.yesterdaySupScore ?? 50) + a[0]))], { yesterdaySupScore: ctx.yesterdaySupScore });
    case 'up_min': return withScore([upright(9 * 60, a[0])]);
    case 'up_pct': case 'sev_max': case 'slo_max': case 'fwd_max': case 'tilt_max': case 'up_sess':
      return withScore([upright(9 * 60, a[1])]);
    case 'dk_total': case 'dk_long': return withScore([upright(6 * 60, a[0])]);
    case 'dk_count': return withScore(Array.from({ length: a[0] }, (_, i) => upright(6 * 60 + i * (a[1] + 5), a[1])));
    case 'dk_part': return withScore([upright(startOf(args[0]), a[1])]);
    case 'dk_ptotal': return withScore([upright(startOf(args[0]), a[1])]);
    case 'dk_parts': return withScore(PARTS.slice(0, a[0]).map((p) => upright(startOf(p), a[1])));
    case 'dk_beat': {
      const minutes = Math.round((ctx.yesterdayDeskMs ?? 0) / MIN) + a[0];
      return withScore([upright(0, minutes)], { yesterdayDeskMs: ctx.yesterdayDeskMs });
    }
  }
  return null;
}

const strength = (name, unit, values) => ({ name, category: 'strength', unit, values });
const activity = (name, minutes) => ({ name, category: 'other', unit: 'minutes', values: [minutes] });
const ACTIVITIES = EXERCISES.filter((e) => e.category === 'other').map((e) => e.name);
const workout = (exercises, extra = {}) => ({
  id: `w${Math.random()}`, performed_on: DATE, back_feeling: 3, created_at: new Date(at(18 * 60)).toISOString(), exercises, ...extra,
});

function exerciseWitness(kind, args) {
  const a = args.map(Number);
  const sets = (total, cap = 1000) => { const out = []; for (let left = total; left > 0; left -= cap) out.push(Math.min(cap, left)); return out; };
  switch (kind) {
    case 'ex_log': return { workouts: Array.from({ length: a[0] }, () => workout([activity('Yoga', 10)])) };
    case 'ex_kinds': case 'ex_one':
      return { workouts: [workout(Array.from({ length: a[0] }, (_, i) => strength(`Move ${i + 1}`, 'reps', [10])))] };
    case 'ex_sets': return { workouts: [workout([strength('Glute bridge', 'reps', Array(a[0]).fill(10))])] };
    case 'ex_reps': return { workouts: [workout([strength('Glute bridge', 'reps', sets(a[0], 100))])] };
    case 'ex_hold': return { workouts: [workout([strength('Plank', 'seconds', sets(a[0], 120))])] };
    case 'ex_named': {
      const name = NAMED[args[0]];
      const def = EXERCISES.find((e) => e.name === name);
      return { workouts: [workout([def.unit === 'minutes' ? activity(name, a[1]) : strength(name, def.unit, sets(a[1], 100))])] };
    }
    case 'ex_min': return { workouts: [workout([activity('Cycling', a[0])])] };
    case 'ex_mix': return { workouts: [workout([strength('Plank', 'seconds', [30]), activity('Yoga', 10)])] };
    case 'ex_feel': return { workouts: [workout([activity('Yoga', 10)], { back_feeling: a[0] })] };
    case 'ex_custom': return { workouts: [workout(Array.from({ length: a[0] }, (_, i) => strength(`My move ${i + 1}`, 'reps', [10])))] };
    case 'ex_acts': return { workouts: [workout(ACTIVITIES.slice(0, a[0]).map((n) => activity(n, 10)))] };
    // A desk session ending at 10:00, then workouts saved at 18:00.
    case 'ex_desk': return { workouts: Array.from({ length: a[0] }, () => workout([activity('Yoga', 10)])), sessions: [upright(9 * 60, 60)] };
    case 'ex_dmin': return { workouts: [workout([activity('Yoga', a[0])])], sessions: [upright(9 * 60, 60)] };
    case 'ex_dreps': return { workouts: [workout([strength('Deadlift', 'reps', sets(a[0], 100))])], sessions: [upright(9 * 60, 60)] };
  }
  return null;
}

function assertRealistic(data) {
  for (const w of data.workouts ?? []) {
    assert.equal(validateWorkout(w, DATE), null, `workout fails the Exercise form: ${JSON.stringify(w.exercises)}`);
  }
  const sessions = [...(data.sessions ?? [])].sort((x, y) => x.startedAt - y.startedAt);
  for (let i = 0; i < sessions.length; i++) {
    assert.ok(sessions[i].startedAt >= at(0) && sessions[i].startedAt < at(24 * 60), 'session starts outside the day');
    if (i > 0) assert.ok(sessions[i].startedAt >= sessions[i - 1].endedAt, 'sessions overlap');
  }
}

function contextsFor(rule) {
  const { kind } = parseRule(rule);
  const base = { frequency: 'medium', presets: PARTS, notificationsAllowed: true, yesterdaySupScore: null, yesterdayDeskMs: null };
  if (kind.startsWith('ci_')) {
    return FREQUENCIES.flatMap((frequency) => PRESET_SETS.map((presets) => ({ ...base, frequency, presets })));
  }
  if (kind === 'sc_beat') return [null, 40, 70, 85, 92, 99].map((y) => ({ ...base, yesterdaySupScore: y }));
  if (kind === 'dk_beat') return [null, 0, 600, 20 * 60, 23.5 * 60].map((m) => ({ ...base, yesterdayDeskMs: m == null ? null : m * MIN }));
  return [base];
}

const blank = { checkIns: [], sessions: [], workouts: [], supScore: null, yesterdaySupScore: null, yesterdayDeskMs: null };

test('every goal can be completed with real app data by every user it can be offered to', () => {
  let checked = 0;
  for (const [set, sections] of Object.entries(GOAL_BANK)) {
    for (const [section, tiers] of Object.entries(sections)) {
      for (const [difficulty, goals] of Object.entries(tiers)) {
        for (const { rule } of goals) {
          const { kind, args } = parseRule(rule);
          for (const ctx of contextsFor(rule)) {
            if (!ruleFeasible(rule, ctx)) continue;
            const patch = kind.startsWith('ci_') ? checkInWitness(kind, args, ctx)
              : kind.startsWith('ex_') ? exerciseWitness(kind, args) : sessionWitness(kind, args, ctx);
            assert.ok(patch, `no witness for ${rule}`);
            const data = { ...blank, ...patch };
            assertRealistic(data);
            const result = evaluateRule(rule, data);
            assert.equal(result.done, true, `${set}.${section}.${difficulty} ${rule} not completed for ${JSON.stringify(ctx)}: ${JSON.stringify(result)}`);
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked > 8_000, `only ${checked} goal/user combinations checked`); // 8,853 today
});

test('goals that can never be done for a user are not offered to them', () => {
  const ctx = { frequency: 'active', presets: PARTS, notificationsAllowed: true, yesterdaySupScore: null, yesterdayDeskMs: null };
  assert.equal(ruleFeasible('ci_done:1', { ...ctx, notificationsAllowed: false }), false, 'blocked notifications');
  assert.equal(ruleFeasible('ci_done:1', { ...ctx, frequency: null }), false, 'no reminder profile');
  assert.equal(ruleFeasible('ci_done:1', { ...ctx, presets: [] }), false, 'no active hours');
  assert.equal(ruleFeasible('ci_done:4', { ...ctx, frequency: 'light' }), false, 'over the daily cap');
  assert.equal(ruleFeasible('ci_part:evening:1', { ...ctx, presets: ['morning'] }), false, 'outside active hours');
  assert.equal(ruleFeasible('sc_beat:10', { ...ctx, yesterdaySupScore: MAX_REACHABLE_SCORE - 9 }), false, 'unreachable s\'core');
  assert.equal(ruleFeasible('sc_beat:10', { ...ctx, yesterdaySupScore: MAX_REACHABLE_SCORE - 10 }), true);
  assert.equal(ruleFeasible('dk_beat:60', { ...ctx, yesterdayDeskMs: 23.5 * 60 * MIN }), false, 'more than a day of tracking');
});

test('every tier still has goals for every reminder setup, so no section goes empty', () => {
  const { dailyOffers } = loadTs('src/lib/goals/dailyGoals.ts');
  for (const frequency of FREQUENCIES) {
    for (const presets of PRESET_SETS) {
      const ctx = { frequency, presets, notificationsAllowed: true, yesterdaySupScore: 99, yesterdayDeskMs: 23.9 * 60 * MIN };
      for (const set of ['hardware', 'no_hardware']) {
        for (const { section, offers } of dailyOffers('user-1', DATE, set, ctx)) {
          assert.equal(offers.length, 3, `${set}.${section} for ${frequency} ${presets.join('+')}`);
        }
      }
    }
  }
});
