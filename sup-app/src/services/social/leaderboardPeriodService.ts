import {
  fetchPosturePageRowsForUsers,
  supScoreForRows,
  type PosturePageRow,
} from "../posture/postureSyncService";
import type { User } from "../../../constants/env";
import { displayName } from "../../utils/displayName";
import { toLocalDateKey } from "../../lib/dateKey";

export type LeaderboardPeriod = "day" | "week";

export interface LeaderboardEntry {
  user: User;
  avgSupScore: number; // rounded to 1 decimal place
  sessionsCounted: number;
  rank: number; // 1-based, ties share the same rank (standard competition ranking)
}

/** posture_daily rows for a leaderboard roster, keyed by user id. */
export type LeaderboardRowsByUser = Map<string, PosturePageRow[]>;

/**
 * The longest window any leaderboard view asks for. Fetching this once covers
 * every shorter period too, so the UI can switch periods without a network hit.
 */
export const WIDEST_LEADERBOARD_PERIOD: LeaderboardPeriod = "week";

/** Kept as a named export for existing callers; same as toLocalDateKey. */
export const toDateKey = (d: Date): string => toLocalDateKey(d);

/**
 * Returns the [startDateKey, endDateKey] (inclusive, YYYY-MM-DD) window for a given period,
 * anchored on today.
 */
export function getDateRangeForPeriod(period: LeaderboardPeriod, today = new Date()): {
  startDateKey: string;
  endDateKey: string;
} {
  const endDateKey = toDateKey(today);

  switch (period) {
    case "day": {
      return { startDateKey: endDateKey, endDateKey };
    }
    case "week": {
      const start = new Date(today);
      start.setDate(start.getDate() - 6); // last 7 days incl. today
      return { startDateKey: toDateKey(start), endDateKey };
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Ties are broken by the name the viewer actually sees, so equal scores read as
 * alphabetical on screen rather than ordered by a hidden field.
 */
function getDisplayName(user: User): string {
  return displayName(user);
}

/**
 * Assigns standard competition ranks (1, 2, 2, 4, ...) to a list already
 * sorted by avgSupScore descending. Users with identical scores share a rank.
 */
function assignRanks(sorted: Omit<LeaderboardEntry, "rank">[]): LeaderboardEntry[] {
  let currentRank = 0;
  let prevScore: number | null = null;

  return sorted.map((entry, idx) => {
    if (prevScore === null || entry.avgSupScore !== prevScore) {
      currentRank = idx + 1;
    }
    prevScore = entry.avgSupScore;
    return { ...entry, rank: currentRank };
  });
}

/**
 * Fetches the posture_daily rows a leaderboard needs, in a single batched query.
 * Pass the widest period you might display and narrow it later with
 * `rankLeaderboard` — date keys sort lexicographically, so a wider fetch is a
 * superset of every narrower one.
 */
export async function fetchPostureRowsForLeaderboard(
  users: User[],
  period: LeaderboardPeriod = WIDEST_LEADERBOARD_PERIOD,
  today = new Date()
): Promise<LeaderboardRowsByUser> {
  const { startDateKey, endDateKey } = getDateRangeForPeriod(period, today);
  return fetchPosturePageRowsForUsers(
    users.map((u) => u.id),
    startDateKey,
    endDateKey
  );
}

/**
 * Ranks a roster from already-fetched rows — pure, no network. Rows outside the
 * period's window are ignored, so one fetch of the widest window can serve every
 * period toggle.
 */
export function rankLeaderboard(
  users: User[],
  rowsByUser: LeaderboardRowsByUser,
  period: LeaderboardPeriod,
  today = new Date()
): LeaderboardEntry[] {
  const { startDateKey, endDateKey } = getDateRangeForPeriod(period, today);

  const entries = users.map((user): Omit<LeaderboardEntry, "rank"> => {
    const rows = (rowsByUser.get(user.id) ?? []).filter(
      (row) => row.date >= startDateKey && row.date <= endDateKey
    );
    if (!rows.length) {
      return { user, avgSupScore: 0, sessionsCounted: 0 };
    }
    // Time-weighted across the period, not a mean of daily scores (docs/score-methodology.md §2).
    return {
      user,
      avgSupScore: round1(supScoreForRows(rows) ?? 0),
      sessionsCounted: rows.length,
    };
  });

  const sorted = entries.sort((a, b) => {
    if (b.avgSupScore !== a.avgSupScore) {
      return b.avgSupScore - a.avgSupScore;
    }
    return getDisplayName(a.user).localeCompare(getDisplayName(b.user));
  });
  return assignRanks(sorted);
}

/**
 * A user's time-weighted s'core over the last 7 days incl. today, rounded; 0 if
 * nothing tracked. Shown as "weekly points" in the profile dropdown and modal
 * (replaces the never-updated profiles.weekly_avg_points column).
 */
export async function fetchWeeklySupScore(userId: string): Promise<number> {
  const { startDateKey, endDateKey } = getDateRangeForPeriod("week");
  const rowsByUser = await fetchPosturePageRowsForUsers([userId], startDateKey, endDateKey);
  return Math.round(supScoreForRows(rowsByUser.get(userId) ?? []) ?? 0);
}

/**
 * Given a roster of users, fetches their posture_daily rows for the period and
 * returns each user's time-weighted period supScore (1dp), sorted highest first, with ranks
 * that correctly account for ties.
 *
 * Prefer `fetchPostureRowsForLeaderboard` + `rankLeaderboard` when you render
 * more than one period from the same roster — that pair fetches only once.
 */
export async function fetchLeaderboardForPeriod(
  users: User[],
  period: LeaderboardPeriod
): Promise<LeaderboardEntry[]> {
  const rowsByUser = await fetchPostureRowsForLeaderboard(users, period);
  return rankLeaderboard(users, rowsByUser, period);
}
