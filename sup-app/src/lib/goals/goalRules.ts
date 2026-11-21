// Auto-completion for daily goals. A goal's rule ("kind:arg:arg", from
// goalBank.ts) is checked against one local day of the app's own data:
//   ci_*            check-ins (reminder_log), excluding re-engagement reminders
//   sc_*, up_*, *_max  posture quality: s'up s'core (posture_daily) and posture
//                   time from completed desk sessions (posture_sessions)
//   dk_*            completed desk sessions (posture_sessions)
//   ex_*            exercise logs dated that day (exercise_workouts)
// Pure, React-free; the hook fetches GoalDayData and saves completions.
import { EXERCISES, type Workout } from "../../features/exercise/model";

export type DayPart = "morning" | "afternoon" | "evening" | "late_night";

/** Same windows as the reminder engine's active-time presets (reminderEngineService.ts). */
export const DAY_PARTS: Record<DayPart, { start: number; end: number }> = {
  morning: { start: 7 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 21 * 60 },
  late_night: { start: 21 * 60, end: 25 * 60 }, // 9pm–1am
};

/** Reminder frequency caps — mirrors FREQUENCY_CONFIG in reminderEngineService.ts. */
export const CHECK_IN_LIMITS: Record<string, { maxPerDay: number; cooldownMinutes: number }> = {
  light: { maxPerDay: 3, cooldownMinutes: 45 },
  medium: { maxPerDay: 6, cooldownMinutes: 30 },
  active: { maxPerDay: 10, cooldownMinutes: 15 },
};

export interface CheckIn {
  sentAt: number;
  interactedAt: number | null;
  action: string | null;
}
export interface DeskSession {
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  stateTotals: Record<string, number> | null;
}
export interface GoalDayData {
  checkIns: CheckIn[];
  sessions: DeskSession[];
  workouts: Workout[];
  supScore: number | null;
  yesterdaySupScore: number | null;
  yesterdayDeskMs: number | null;
}
/** What the user's reminder settings can deliver (null = no reminder profile). */
export interface CheckInSettings {
  frequency: string | null;
  presets: string[];
}
/** Everything that decides whether a goal can still be completed for this user. */
export interface OfferContext extends CheckInSettings {
  /** The engine logs check-ins even when the OS blocks them, so they could never be answered. */
  notificationsAllowed: boolean;
  yesterdaySupScore: number | null;
  yesterdayDeskMs: number | null;
}

/**
 * Highest s'core a "beat yesterday" goal may ask for. The s'core is
 * round((Σ credit × minutes + 50 × 10) / (minutes + 10)) — docs/score-methodology.md —
 * so it only nears 100: 95 takes ~1.5 hours of perfect upright posture, 99 over 5 hours.
 */
export const MAX_REACHABLE_SCORE = 95;

export interface GoalProgress {
  current: number;
  target: number;
  unit: string;
  done: boolean;
  /** Set when the goal can no longer be completed today (e.g. a check-in was dismissed). */
  blocked?: string;
}

const MIN = 60_000;
const NEGATIVE_ACTIONS = new Set(["DISMISS", "TOO_ANNOYING"]);
const POSTURE_STATES = ["upright", "forward_lean", "slouched", "severe", "tilted_left", "tilted_right"];
const NAMED: Record<string, { name: string; unit: string }> = {
  plank: { name: "plank", unit: "seconds" },
  glute: { name: "glute bridge", unit: "reps" },
  deadlift: { name: "deadlift", unit: "reps" },
  yoga: { name: "yoga", unit: "minutes" },
  pilates: { name: "pilates", unit: "minutes" },
  cycling: { name: "cycling", unit: "minutes" },
  swimming: { name: "swimming", unit: "minutes" },
  sport: { name: "sport", unit: "minutes" },
};
const BUILT_IN_NAMES = new Set(EXERCISES.map((e) => e.name.toLowerCase()));

export function parseRule(rule: string): { kind: string; args: string[] } {
  const [kind, ...args] = rule.split(":");
  return { kind, args };
}

/** Local minutes since midnight; times between midnight and 1am count as late night (24:00–25:00). */
function localMinutes(ms: number): number {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes();
  return m < 60 ? m + 24 * 60 : m;
}
export function dayPartOf(ms: number): DayPart | null {
  const m = localMinutes(ms);
  for (const [part, w] of Object.entries(DAY_PARTS) as [DayPart, { start: number; end: number }][]) {
    if (m >= w.start && m < w.end) return part;
  }
  return null;
}

/**
 * Whether a goal can be completed today for this user. Check-in goals need
 * notifications allowed and reminder settings that can deliver enough
 * check-ins in the right part of the day; "beat yesterday" goals need a
 * target that's still reachable. Everything else is always feasible.
 */
export function ruleFeasible(rule: string, settings: OfferContext): boolean {
  const { kind, args } = parseRule(rule);
  if (kind === "sc_beat") return (settings.yesterdaySupScore ?? 50) + Number(args[0]) <= MAX_REACHABLE_SCORE;
  if (kind === "dk_beat") return (settings.yesterdayDeskMs ?? 0) / MIN + Number(args[0]) <= 24 * 60;
  if (!kind.startsWith("ci_")) return true;
  if (!settings.notificationsAllowed) return false;
  const limits = settings.frequency ? CHECK_IN_LIMITS[settings.frequency] : undefined;
  if (!limits) return false;
  const presets = settings.presets.filter((p): p is DayPart => p in DAY_PARTS);
  if (presets.length === 0) return false;
  const n = Number(args[0]);
  switch (kind) {
    case "ci_first":
      return true;
    case "ci_parts":
      return presets.length >= n && limits.maxPerDay >= n;
    case "ci_part": {
      const part = args[0] as DayPart;
      const count = Number(args[1]);
      if (!presets.includes(part)) return false;
      const w = DAY_PARTS[part];
      const fitInWindow = Math.floor((w.end - w.start) / limits.cooldownMinutes) + 1;
      return count <= Math.min(limits.maxPerDay, fitInWindow);
    }
    case "ci_rate":
      return Number(args[1]) <= limits.maxPerDay;
    default:
      return n <= limits.maxPerDay;
  }
}

// ── data helpers ───────────────────────────────────────────────────────────
const responded = (c: CheckIn) => c.interactedAt != null && !NEGATIVE_ACTIONS.has(c.action ?? "");
const respondedWithin = (c: CheckIn, minutes: number) =>
  responded(c) && (c.interactedAt as number) - c.sentAt <= minutes * MIN;
const tappedDone = (c: CheckIn) => c.action === "DONE";

function postureTotals(sessions: DeskSession[]): Record<string, number> & { all: number } {
  const totals: Record<string, number> = {};
  for (const s of sessions) {
    for (const k of POSTURE_STATES) totals[k] = (totals[k] ?? 0) + (s.stateTotals?.[k] ?? 0);
  }
  const all = POSTURE_STATES.reduce((sum, k) => sum + (totals[k] ?? 0), 0);
  return Object.assign(totals, { all });
}
const pctOf = (part: number, all: number) => (all > 0 ? (part / all) * 100 : 0);

function entries(workouts: Workout[]) {
  return workouts.flatMap((w) => w.exercises);
}
const sumValues = (list: { values: number[] }[]) => list.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0);
const distinctNames = (list: { name: string }[]) => new Set(list.map((e) => e.name.trim().toLowerCase()));

/** Workouts saved after the day's first finished desk session. */
function workoutsAfterDesk(data: GoalDayData): Workout[] {
  const ends = data.sessions.map((s) => s.endedAt).filter((t): t is number => t != null);
  if (ends.length === 0) return [];
  const firstEnd = Math.min(...ends);
  return data.workouts.filter((w) => Date.parse(w.created_at) > firstEnd);
}

const count = (current: number, target: number, unit: string): GoalProgress =>
  ({ current: Math.floor(current), target, unit, done: current >= target });
const flag = (met: boolean, unit = "done"): GoalProgress => ({ current: met ? 1 : 0, target: 1, unit, done: met });
const minutes = (ms: number) => ms / MIN;

/** Minimum tracked time plus a posture-share condition (e.g. "under 10% severe"). */
function shareRule(data: GoalDayData, states: string[], maxPct: number, minMinutes: number): GoalProgress {
  const t = postureTotals(data.sessions);
  const pct = pctOf(states.reduce((s, k) => s + (t[k] ?? 0), 0), t.all);
  const tracked = minutes(t.all);
  const ok = pct < maxPct;
  return {
    current: Math.floor(tracked),
    target: minMinutes,
    unit: "min tracked",
    done: tracked >= minMinutes && ok,
    ...(tracked > 0 && !ok && { blocked: `${Math.round(pct)}% so far — needs under ${maxPct}%` }),
  };
}

export function evaluateRule(rule: string, data: GoalDayData): GoalProgress {
  const { kind, args } = parseRule(rule);
  const a = args.map(Number);
  const checkIns = [...data.checkIns].sort((x, y) => x.sentAt - y.sentAt);
  switch (kind) {
    // ── check-ins ────────────────────────────────────────────────────────
    case "ci_done": return count(checkIns.filter(tappedDone).length, a[0], "check-ins");
    case "ci_resp": return count(checkIns.filter(responded).length, a[0], "check-ins");
    case "ci_fast": return count(checkIns.filter((c) => respondedWithin(c, a[1])).length, a[0], "check-ins");
    case "ci_dfast":
      return count(checkIns.filter((c) => tappedDone(c) && respondedWithin(c, a[1])).length, a[0], "check-ins");
    case "ci_first": {
      const first = checkIns[0];
      if (!first) return flag(false);
      const met = respondedWithin(first, a[0]);
      const missed = !met && (first.interactedAt != null || Date.now() - first.sentAt > a[0] * MIN);
      return { ...flag(met), ...(missed && { blocked: "today's first check-in was missed" }) };
    }
    case "ci_part": {
      const part = args[0] as DayPart;
      return count(checkIns.filter((c) => responded(c) && dayPartOf(c.sentAt) === part).length, a[1], "check-ins");
    }
    case "ci_parts": {
      const parts = new Set(checkIns.filter(responded).map((c) => dayPartOf(c.sentAt)).filter(Boolean));
      return count(parts.size, a[0], "parts of the day");
    }
    case "ci_run": {
      let best = 0;
      let run = 0;
      for (const c of checkIns) {
        run = responded(c) ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return count(best, a[0], "in a row");
    }
    case "ci_rate": {
      const sent = checkIns.length;
      const got = checkIns.filter(responded).length;
      const target = Math.max(a[1], Math.ceil((sent * a[0]) / 100));
      return { current: got, target, unit: "check-ins", done: sent >= a[1] && got * 100 >= sent * a[0] };
    }
    case "ci_clean": {
      const dismissed = checkIns.some((c) => NEGATIVE_ACTIONS.has(c.action ?? ""));
      return {
        ...count(checkIns.filter(tappedDone).length, a[0], "check-ins"),
        ...(dismissed && { done: false, blocked: "a check-in was dismissed today" }),
      };
    }

    // ── posture quality ──────────────────────────────────────────────────
    // The s'core starts at 50 each day (docs/score-methodology.md).
    case "sc_score": return count(data.supScore ?? 50, a[0], "pts");
    case "sc_beat": return count(data.supScore ?? 50, (data.yesterdaySupScore ?? 50) + a[0], "pts");
    case "up_min": return count(minutes(postureTotals(data.sessions).upright ?? 0), a[0], "min upright");
    case "up_pct": {
      const t = postureTotals(data.sessions);
      const pct = pctOf(t.upright ?? 0, t.all);
      return { current: Math.floor(minutes(t.all)), target: a[1], unit: "min tracked", done: minutes(t.all) >= a[1] && pct >= a[0] };
    }
    case "up_sess": {
      const best = data.sessions
        .filter((s) => minutes(s.durationMs) >= a[1])
        .map((s) => { const t = postureTotals([s]); return pctOf(t.upright ?? 0, t.all); })
        .reduce((m, p) => Math.max(m, p), 0);
      return count(best, a[0], "% upright");
    }
    case "sev_max": return shareRule(data, ["severe"], a[0], a[1]);
    case "slo_max": return shareRule(data, ["slouched", "severe"], a[0], a[1]);
    case "fwd_max": return shareRule(data, ["forward_lean"], a[0], a[1]);
    case "tilt_max": return shareRule(data, ["tilted_left", "tilted_right"], a[0], a[1]);

    // ── desk mode ────────────────────────────────────────────────────────
    case "dk_total": return count(minutes(data.sessions.reduce((s, x) => s + x.durationMs, 0)), a[0], "min");
    case "dk_count": return count(data.sessions.filter((s) => minutes(s.durationMs) >= a[1]).length, a[0], "sessions");
    case "dk_long": return count(minutes(Math.max(0, ...data.sessions.map((s) => s.durationMs))), a[0], "min");
    case "dk_part": {
      const part = args[0] as DayPart;
      const best = Math.max(0, ...data.sessions.filter((s) => dayPartOf(s.startedAt) === part).map((s) => s.durationMs));
      return count(minutes(best), a[1], "min");
    }
    case "dk_parts": {
      const parts = new Set(data.sessions.filter((s) => minutes(s.durationMs) >= a[1]).map((s) => dayPartOf(s.startedAt)).filter(Boolean));
      return count(parts.size, a[0], "parts of the day");
    }
    case "dk_beat": {
      const total = data.sessions.reduce((s, x) => s + x.durationMs, 0);
      return count(minutes(total), Math.round(minutes(data.yesterdayDeskMs ?? 0)) + a[0], "min");
    }
    case "dk_ptotal": {
      const part = args[0] as DayPart;
      const total = data.sessions.filter((s) => dayPartOf(s.startedAt) === part).reduce((s, x) => s + x.durationMs, 0);
      return count(minutes(total), a[1], "min");
    }

    // ── exercise ─────────────────────────────────────────────────────────
    case "ex_log": return count(data.workouts.length, a[0], "workouts");
    case "ex_kinds": return count(distinctNames(entries(data.workouts)).size, a[0], "exercises");
    case "ex_one":
      return count(Math.max(0, ...data.workouts.map((w) => distinctNames(w.exercises).size)), a[0], "exercises");
    case "ex_sets":
      return count(entries(data.workouts).filter((e) => e.category === "strength").reduce((s, e) => s + e.values.length, 0), a[0], "sets");
    case "ex_reps": return count(sumValues(entries(data.workouts).filter((e) => e.unit === "reps")), a[0], "reps");
    case "ex_hold": return count(sumValues(entries(data.workouts).filter((e) => e.unit === "seconds")), a[0], "sec");
    case "ex_named": {
      const spec = NAMED[args[0]];
      const list = entries(data.workouts).filter((e) => e.name.trim().toLowerCase() === spec?.name && e.unit === spec.unit);
      return count(sumValues(list), a[1], { seconds: "sec", reps: "reps", minutes: "min" }[spec?.unit ?? "reps"] ?? "");
    }
    case "ex_min": return count(sumValues(entries(data.workouts).filter((e) => e.unit === "minutes")), a[0], "min");
    case "ex_mix": {
      const list = entries(data.workouts);
      return count(Number(list.some((e) => e.category === "strength")) + Number(list.some((e) => e.category === "other")), 2, "of 2 types");
    }
    case "ex_feel": return flag(data.workouts.some((w) => w.back_feeling >= a[0]));
    case "ex_custom":
      return count([...distinctNames(entries(data.workouts))].filter((n) => !BUILT_IN_NAMES.has(n)).length, a[0], "exercises");
    case "ex_acts":
      return count(distinctNames(entries(data.workouts).filter((e) => e.category === "other")).size, a[0], "activities");
    case "ex_desk": return count(workoutsAfterDesk(data).length, a[0], "workouts");
    case "ex_dmin": return count(sumValues(entries(workoutsAfterDesk(data)).filter((e) => e.unit === "minutes")), a[0], "min");
    case "ex_dreps": return count(sumValues(entries(workoutsAfterDesk(data)).filter((e) => e.unit === "reps")), a[0], "reps");
  }
  return { current: 0, target: 1, unit: "", done: false, blocked: "unknown goal" };
}

/** Which data a rule needs, so the hook only fetches what today's goals use. */
export function ruleSources(rule: string): ("checkIns" | "sessions" | "daily" | "workouts")[] {
  const { kind } = parseRule(rule);
  if (kind.startsWith("ci_")) return ["checkIns"];
  if (kind.startsWith("sc_")) return ["daily"];
  if (kind === "dk_beat") return ["sessions", "daily"];
  if (kind.startsWith("ex_d")) return ["workouts", "sessions"];
  if (kind.startsWith("ex_")) return ["workouts"];
  return ["sessions"];
}
