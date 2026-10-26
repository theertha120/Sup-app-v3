import { fetchLeaderboardByStreak } from "./leaderboardService";
import { getFriendsForUser } from "./friendService";
import { fetchPostureRowsForLeaderboard, rankLeaderboard } from "./leaderboardPeriodService";
import type { LeaderboardSource } from "./leaderboardStore";
import type { LeaderboardPage } from "./leaderboardData";

/** Per-view compatibility source; server-side paging can replace this without changing screens. */
export function createLeaderboardSource(userId: string): LeaderboardSource {
  const snapshots = new Map<string, Promise<{ everyone: LeaderboardPage; friends: LeaderboardPage }>>();
  return async (query, offset, limit, force) => {
    const key = `${query.dateKey}:${query.period}`;
    if (force) snapshots.delete(key);
    let snapshot = snapshots.get(key);
    if (!snapshot) {
      snapshot = (async () => {
        const [roster, friendIds] = await Promise.all([fetchLeaderboardByStreak(), getFriendsForUser(userId)]);
        const anchor = new Date(`${query.dateKey}T12:00:00`);
        const rows = await fetchPostureRowsForLeaderboard(roster, query.period, anchor);
        const allowed = new Set([userId, ...friendIds]);
        const page = (friends: boolean): LeaderboardPage => {
          const entries = rankLeaderboard(friends ? roster.filter((user) => allowed.has(user.id)) : roster, rows, query.period, anchor);
          return { entries, total: entries.length, ownEntry: entries.find((entry) => entry.user.id === userId) ?? null, friendCount: friendIds.length };
        };
        return { everyone: page(false), friends: page(true) };
      })();
      snapshots.set(key, snapshot);
      const request = snapshot;
      void request.catch(() => { if (snapshots.get(key) === request) snapshots.delete(key); });
    }
    const page = (await snapshot)[query.scope];
    return { ...page, entries: page.entries.slice(offset, offset + limit) };
  };
}
