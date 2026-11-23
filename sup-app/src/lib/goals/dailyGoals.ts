// Picks each day's goal offers from the hardcoded bank. The pick is a hash of
// user + day, so offers stay the same all day (and across devices) without
// storing them, and change each new local day. Goals the user can't
// complete today (see ruleFeasible) are left out before picking.
import { ruleFeasible, type OfferContext } from "./goalRules";
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
  /** The goal's rule (see goalRules.ts), also stored as daily_goals.goal_id. */
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
  settings: OfferContext,
): { section: GoalSection; offers: GoalOffer[] }[] {
  return sectionsFor(set).map((section) => {
    const tiers = tiersFor(set, section)!;
    return {
      section,
      offers: DIFFICULTIES.flatMap((difficulty) => {
        const list = tiers[difficulty].filter((g) => ruleFeasible(g.rule, settings));
        if (list.length === 0) return [];
        const goal = list[hash(`${userId}|${dateKey}|${set}|${section}|${difficulty}`) % list.length];
        return [{ goalId: goal.rule, set, section, difficulty, text: goal.text }];
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
