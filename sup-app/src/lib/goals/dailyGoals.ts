// Picks each day's goal offers from the hardcoded bank. The pick is a hash of
// user + day, so offers stay the same all day (and across devices) without
// storing them, and change each new local day.
import {
  GOAL_BANK,
  type GoalDifficulty,
  type GoalSection,
  type GoalSet,
  type GoalTiers,
} from "./goalBank";

export type { GoalDifficulty, GoalSection, GoalSet } from "./goalBank";

export const DIFFICULTIES: readonly GoalDifficulty[] = ["easy", "medium", "hard"];

export interface GoalOffer {
  /** `${set}:${section}:${difficulty}:${index}` — stable while the bank isn't reordered. */
  goalId: string;
  set: GoalSet;
  section: GoalSection;
  difficulty: GoalDifficulty;
  text: string;
}

/** A goal the user picked for a day (one daily_goals row). */
export interface DailyGoal {
  id: string;
  goal_date: string;
  goal_set: GoalSet;
  section: GoalSection;
  difficulty: GoalDifficulty;
  goal_id: string;
  goal_text: string;
  completed_at: string | null;
  created_at: string;
}

/** Hardware users (have logged a posture session) also get the sitting section. */
export function goalSetFor(hasHardware: boolean): GoalSet {
  return hasHardware ? "hardware" : "no_hardware";
}

export function sectionsFor(set: GoalSet): GoalSection[] {
  return Object.keys(GOAL_BANK[set]) as GoalSection[];
}

function tiersFor(set: GoalSet, section: GoalSection): GoalTiers | undefined {
  return (GOAL_BANK[set] as Partial<Record<GoalSection, GoalTiers>>)[section];
}

/** FNV-1a 32-bit — small, deterministic, good enough to spread picks. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One easy, one medium and one hard offer for each section of `set` on `dateKey`. */
export function dailyOffers(
  userId: string,
  dateKey: string,
  set: GoalSet,
): { section: GoalSection; offers: GoalOffer[] }[] {
  return sectionsFor(set).map((section) => {
    const tiers = tiersFor(set, section)!;
    return {
      section,
      offers: DIFFICULTIES.map((difficulty) => {
        const list = tiers[difficulty];
        const index = hash(`${userId}|${dateKey}|${set}|${section}|${difficulty}`) % list.length;
        return { goalId: `${set}:${section}:${difficulty}:${index}`, set, section, difficulty, text: list[index] };
      }),
    };
  });
}

/** Completed goals grouped by day, newest day first, keeping each day's input order. */
export function groupByDate(goals: DailyGoal[]): { date: string; goals: DailyGoal[] }[] {
  const groups = new Map<string, DailyGoal[]>();
  for (const goal of goals) {
    const list = groups.get(goal.goal_date);
    if (list) list.push(goal);
    else groups.set(goal.goal_date, [goal]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, goals: list }));
}
