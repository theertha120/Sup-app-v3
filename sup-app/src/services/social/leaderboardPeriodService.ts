import {
  fetchPosturePageRowsForUsers,
  type PosturePageRow,
} from "../posture/postureSyncService";
import type { User } from "../../../constants/env";

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

export function toDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns the [startDateKey, endDateKey] (inclusive, YYYY-MM-DD) window for a given period,
 * anchored on today.
 */
export function getDateRangeForPeriod(period: LeaderboardPeriod): {
  startDateKey: string;
  endDateKey: string;
} {
  const today = new Date();
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
 * Returns the display name used for a user, for sorting/tie-breaking purposes.
 * Adjust this if `User` uses a different field (e.g. `displayName`, `username`).
 */
function getDisplayName(user: User): string {
  return (user as any).name ?? (user as any).displayName ?? (user as any).username ?? "";
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
  period: LeaderboardPeriod = WIDEST_LEADERBOARD_PERIOD
): Promise<LeaderboardRowsByUser> {
  const { startDateKey, endDateKey } = getDateRangeForPeriod(period);
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
  period: LeaderboardPeriod
): LeaderboardEntry[] {
  const { startDateKey, endDateKey } = getDateRangeForPeriod(period);

  const entries = users.map((user): Omit<LeaderboardEntry, "rank"> => {
    const rows = (rowsByUser.get(user.id) ?? []).filter(
      (row) => row.date >= startDateKey && row.date <= endDateKey
    );
    if (!rows.length) {
      return { user, avgSupScore: 0, sessionsCounted: 0 };
    }
    const total = rows.reduce((sum, row) => sum + (row.supScore ?? 0), 0);
    return {
      user,
      avgSupScore: round1(total / rows.length),
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
 * Given a roster of users, fetches their posture_daily rows for the period and
 * returns each user's average supScore (1dp), sorted highest first, with ranks
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
