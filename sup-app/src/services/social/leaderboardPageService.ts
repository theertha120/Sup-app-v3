import { supabase } from "@/src/lib/supabase";
import { addDaysToDateKey } from "../../lib/dateKey";
import { displayName } from "../../utils/displayName";
import type { LeaderboardEntry, LeaderboardPeriod } from "./leaderboardPeriodService";

export type LeaderboardScope = "everyone" | "friends";
export type LeaderboardQuery = { scope: LeaderboardScope; period: LeaderboardPeriod; dateKey: string };
export type LeaderboardPage = { entries: LeaderboardEntry[]; ownEntry: LeaderboardEntry | null; total: number; friendCount: number };
export const LEADERBOARD_PAGE_SIZE = 50;
export const LEADERBOARD_STALE_MS = 60_000;
export const leaderboardQueryKey = (query: LeaderboardQuery) => `${query.dateKey}:${query.scope}:${query.period}`;

type Profile = { id: string; name: string; username: string | null; avatar_url: string | null };
type Score = { user_id: string; date: string; sup_score: number | null };
type Friendship = { from_user_id: string | null; to_user_id: string | null };
type RankedRow = Profile & { avg_sup_score: number; sessions_counted: number; rank: number };

type QueryResult<T> = { data: T[] | null; error: unknown };
/** Continue to an empty page, including when the server caps responses below our page size. */
export async function readLeaderboardPages<T>(fetch: (offset: number, size: number) => PromiseLike<QueryResult<T>>, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await fetch(rows.length, 200);
    if (signal?.aborted) throw new Error("Leaderboard request cancelled");
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

function toEntry(row: RankedRow): LeaderboardEntry {
  return { user: { id: row.id, name: row.name, username: row.username ?? undefined, avatar: row.avatar_url ?? undefined,
    currentStreak: 0, lastActivityDate: "", weeklyAvgPoints: 0 },
    avgSupScore: Number(row.avg_sup_score), sessionsCounted: Number(row.sessions_counted), rank: Number(row.rank) };
}

/** Compatibility path until the ranking migration is applied. Only compact scores cross the network. */
export function rankCompactLeaderboard(profiles: Profile[], scores: Score[], friendships: Friendship[], userId: string, scope: LeaderboardScope): LeaderboardPage {
  const friends = new Set(friendships.map((row) => row.from_user_id === userId ? row.to_user_id : row.from_user_id).filter((id): id is string => typeof id === "string" && id !== userId));
  const totals = new Map<string, { sum: number; count: number }>();
  for (const score of scores) {
    const total = totals.get(score.user_id) ?? { sum: 0, count: 0 };
    total.sum += Number(score.sup_score ?? 0);
    total.count++;
    totals.set(score.user_id, total);
  }
  const entries = profiles.filter((profile) => scope === "everyone" || profile.id === userId || friends.has(profile.id)).map((profile) => {
    const total = totals.get(profile.id);
    return toEntry({ ...profile, avg_sup_score: total ? Math.round(total.sum / total.count * 10) / 10 : 0, sessions_counted: total?.count ?? 0, rank: 0 });
  }).sort((a, b) => b.avgSupScore - a.avgSupScore || displayName(a.user).localeCompare(displayName(b.user)) || a.user.id.localeCompare(b.user.id));
  entries.forEach((entry, index) => { entry.rank = index && entry.avgSupScore === entries[index - 1].avgSupScore ? entries[index - 1].rank : index + 1; });
  return { entries, ownEntry: entries.find((entry) => entry.user.id === userId) ?? null, total: entries.length, friendCount: friends.size };
}

/** The signed-in id is supplied by AuthContext; no extra auth request or avatar lookup. */
export function createLeaderboardSource(userId: string) {
  let rpcMissingAt: number | null = null;
  // Coalesce everyone/friends fallback reads for the same date window.
  const fallback = new Map<string, { at: number; pending: boolean; request: Promise<[Profile[], Score[], Friendship[]]>; signal?: AbortSignal; ranked: Partial<Record<LeaderboardScope, LeaderboardPage>> }>();
  return async (query: LeaderboardQuery, offset: number, limit: number, force = false, signal?: AbortSignal): Promise<LeaderboardPage> => {
    const cancel = <T extends { abortSignal: (signal: AbortSignal) => T }>(request: T) => signal ? request.abortSignal(signal) : request;
    const start = query.period === "day" ? query.dateKey : addDaysToDateKey(query.dateKey, -6);
    if (rpcMissingAt === null || Date.now() - rpcMissingAt >= LEADERBOARD_STALE_MS) {
      const request = supabase.rpc("get_leaderboard_page", {
        p_start_date: start, p_end_date: query.dateKey, p_scope: query.scope,
        p_offset: offset, p_limit: Math.min(limit, LEADERBOARD_PAGE_SIZE),
      });
      const { data, error } = await cancel(request);
      if (signal?.aborted) throw new Error("Leaderboard request cancelled");
      if (!error) {
        const result = data as { entries: RankedRow[]; own_entry: RankedRow | null; total: number; friend_count: number };
        if (!result || !Array.isArray(result.entries)) throw new Error("Invalid leaderboard response");
        return { entries: result.entries.map(toEntry), ownEntry: result.own_entry ? toEntry(result.own_entry) : null,
          total: Number(result.total), friendCount: Number(result.friend_count) };
      }
      // Missing function only: permission, transport and database failures must be visible.
      if (error.code !== "PGRST202" && error.code !== "42883") throw error;
      rpcMissingAt = Date.now();
    }
    const key = `${start}:${query.dateKey}`;
    let cached = fallback.get(key);
    if (!cached || cached.signal?.aborted || (!cached.pending && (Date.now() - cached.at >= LEADERBOARD_STALE_MS || force))) {
      const request = Promise.all([
        readLeaderboardPages<Profile>((offset, size) => cancel(supabase.from("profiles").select("id, name, username, avatar_url")
          .order("id").range(offset, offset + size - 1)), signal),
        readLeaderboardPages<Score>((offset, size) => cancel(supabase.from("posture_daily").select("user_id, date, sup_score")
          .gte("date", start).lte("date", query.dateKey).order("user_id").order("date").range(offset, offset + size - 1)), signal),
        readLeaderboardPages<Friendship>((offset, size) => cancel(supabase.from("friend_requests").select("from_user_id, to_user_id")
          .eq("status", "accepted").or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`).order("id").range(offset, offset + size - 1)), signal),
      ]);
      cached = { at: Date.now(), pending: true, request, signal, ranked: {} };
      if (fallback.size >= 4) fallback.delete(fallback.keys().next().value!);
      fallback.set(key, cached);
      const next = cached;
      void request.then(() => { next.at = Date.now(); next.pending = false; }, () => {
        if (fallback.get(key)?.request === request) fallback.delete(key);
      });
    }
    const [profiles, scores, friends] = await cached.request;
    const ranked = cached.ranked[query.scope] ??= rankCompactLeaderboard(profiles, scores, friends, userId, query.scope);
    return { ...ranked, entries: ranked.entries.slice(offset, offset + limit) };
  };
}
