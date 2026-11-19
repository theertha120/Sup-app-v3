/**
 * XP RULES — pure functions, no data access (see docs/xp.md).
 *
 * XP replaces the s'up s'core. It's earned per phone-local day from what the
 * user did that day, then summed over all days into a total that never goes
 * down. The total decides the level. Every number here is a product setting;
 * change them in one place.
 */

// ─── How XP is earned ──────────────────────────────────────────────────────

export const XP_RULES = {
  /** At least one posture check-in logged that day. */
  postureCheckin: 10,
  /** At least one manual exercise workout logged for that day. */
  exerciseLog: 10,
  /** Hardware sessions: XP per full block of tracked time, all session kinds combined. */
  sessionXpPerBlock: 5,
  sessionBlockMinutes: 10,
  /** Most session XP a single day can earn (150 XP = 5 hours tracked). */
  sessionDailyCap: 150,
  /** Each completed daily goal, by difficulty. */
  goal: { easy: 10, medium: 20, hard: 40 },
} as const;

/** s'it = posture sessions (live today). s'quat / s'tep: add once their sessions exist. */
export type SessionKind = "sit" | "squat" | "step";
export type GoalDifficulty = keyof typeof XP_RULES.goal;

/** Everything that counts towards XP on one phone-local day. */
export interface DayActivity {
  date: string; // YYYY-MM-DD, phone-local
  postureCheckins: number;
  exerciseLogs: number;
  /** Tracked milliseconds per session kind. */
  sessionMs: Partial<Record<SessionKind, number>>;
  /** One entry per goal completed that day (goals don't exist yet). */
  goalsCompleted: GoalDifficulty[];
}

export interface DayXp {
  date: string;
  total: number;
  breakdown: { postureCheckin: number; exerciseLog: number; sessions: number; goals: number };
}

export function emptyDay(date: string): DayActivity {
  return { date, postureCheckins: 0, exerciseLogs: 0, sessionMs: {}, goalsCompleted: [] };
}

const safe = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** XP from tracked session time: 5 per full 10 minutes (all kinds added up), capped at 150 a day. */
export function sessionXp(sessionMs: DayActivity["sessionMs"]): number {
  const totalMs = Object.values(sessionMs).reduce<number>((sum, ms) => sum + safe(ms), 0);
  const blocks = Math.floor(totalMs / (XP_RULES.sessionBlockMinutes * 60_000));
  return Math.min(blocks * XP_RULES.sessionXpPerBlock, XP_RULES.sessionDailyCap);
}

export function xpForDay(day: DayActivity): DayXp {
  const breakdown = {
    postureCheckin: safe(day.postureCheckins) >= 1 ? XP_RULES.postureCheckin : 0,
    exerciseLog: safe(day.exerciseLogs) >= 1 ? XP_RULES.exerciseLog : 0,
    sessions: sessionXp(day.sessionMs),
    goals: day.goalsCompleted.reduce((sum, d) => sum + (XP_RULES.goal[d] ?? 0), 0),
  };
  const total = breakdown.postureCheckin + breakdown.exerciseLog + breakdown.sessions + breakdown.goals;
  return { date: day.date, total, breakdown };
}

// ─── Levels ────────────────────────────────────────────────────────────────
//
// XP needed for each level: 100, 200, then each step is the two before it
// added together: 300, 500, 800, 1300, 2100, …
//
//   Level 1 at 100 total · Level 2 at 300 · Level 3 at 600 · Level 4 at 1100
//   Level 5 at 1900 · Level 6 at 3200 · …    (below 100 total = level 0)

const FIRST_STEPS = [100, 200];

/** XP needed to go from level n-1 to level n (n ≥ 1). */
export function levelStep(n: number): number {
  if (n <= FIRST_STEPS.length) return FIRST_STEPS[Math.max(1, n) - 1];
  let [a, b] = FIRST_STEPS;
  for (let i = FIRST_STEPS.length + 1; i <= n; i++) [a, b] = [b, a + b];
  return b;
}

export interface LevelProgress {
  totalXp: number;
  level: number;
  /** Total XP at which the current level started. */
  levelStartXp: number;
  /** XP earned since reaching the current level. */
  xpIntoLevel: number;
  /** XP the next level needs in total from the current one (e.g. 500 for level 3 → 4). */
  xpForNextLevel: number;
}

export function levelFor(totalXp: number): LevelProgress {
  const total = Math.floor(safe(totalXp));
  let level = 0;
  let start = 0;
  // Bounded: steps grow quickly, so this ends after a few dozen levels at most.
  while (level < 1000 && total >= start + levelStep(level + 1)) {
    start += levelStep(level + 1);
    level++;
  }
  return { totalXp: total, level, levelStartXp: start, xpIntoLevel: total - start, xpForNextLevel: levelStep(level + 1) };
}

/** e.g. "Level 3 - 21/500": the level, then progress towards the next one. */
export function formatLevel(progress: LevelProgress): string {
  return `Level ${progress.level} - ${progress.xpIntoLevel}/${progress.xpForNextLevel}`;
}

// ─── Totals ────────────────────────────────────────────────────────────────

export interface XpSummary extends LevelProgress {
  /** XP earned today so far (adds up through the day; not an average). */
  todayXp: number;
  /** Per-day XP, newest first, only days that earned something. */
  days: DayXp[];
}

export function summarizeXp(activity: DayActivity[], today: string): XpSummary {
  const days = activity.map(xpForDay).filter((d) => d.total > 0).sort((a, b) => b.date.localeCompare(a.date));
  const totalXp = days.reduce((sum, d) => sum + d.total, 0);
  const todayXp = days.find((d) => d.date === today)?.total ?? 0;
  return { ...levelFor(totalXp), todayXp, days };
}
