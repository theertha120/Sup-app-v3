import { fetchPosturePageRows } from "../posture/postureSyncService";
import type { User } from "../../../constants/env";

export type LeaderboardPeriod = "day" | "week";

export interface LeaderboardEntry {
  user: User;
  avgSupScore: number; // rounded to 1 decimal place
  sessionsCounted: number;
  rank: number; // 1-based, ties share the same rank (standard competition ranking)
}

function toDateKey(d: Date): string {
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
 * Given a roster of users, fetches each user's posture_daily rows for the period
 * and returns their average supScore (2dp), sorted highest first, with ranks
 * that correctly account for ties.
 */
export async function fetchLeaderboardForPeriod(
  users: User[],
  period: LeaderboardPeriod
): Promise<LeaderboardEntry[]> {
  const { startDateKey, endDateKey } = getDateRangeForPeriod(period);

  const entries = await Promise.all(
    users.map(async (user): Promise<Omit<LeaderboardEntry, "rank">> => {
      try {
        const rows = await fetchPosturePageRows(user.id, startDateKey, endDateKey);
        if (!rows.length) {
          return { user, avgSupScore: 0, sessionsCounted: 0 };
        }
        const total = rows.reduce((sum, row: any) => sum + (row.supScore ?? 0), 0);
        return {
          user,
          avgSupScore: round1(total / rows.length),
          sessionsCounted: rows.length,
        };
      } catch (err) {
        console.warn("[leaderboardPeriodService] failed to load rows for user", user.id, err);
        return { user, avgSupScore: 0, sessionsCounted: 0 };
      }
    })
  );

  const sorted = entries.sort((a, b) => {
    if (b.avgSupScore !== a.avgSupScore) {
      return b.avgSupScore - a.avgSupScore;
    }
    return getDisplayName(a.user).localeCompare(getDisplayName(b.user));
  });
  return assignRanks(sorted);
}