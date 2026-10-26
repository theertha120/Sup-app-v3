import { supabase } from "@/src/lib/supabase";
import { addDaysToDateKey } from "../../lib/dateKey";
import { rankLeaderboard } from "./leaderboardPeriodService";
import type { PosturePageRow } from "../posture/postureSyncService";
import type { User } from "@/constants/env";
import type { LeaderboardSource } from "./leaderboardStore";
import type { LeaderboardPage } from "./leaderboardData";

type Profile = { id: string; name: string; username: string | null; avatar_url: string | null };
type Daily = { user_id: string; date: string; state_totals: PosturePageRow["stateTotals"] };
type Friend = { from_user_id: string | null; to_user_id: string | null };
type Ranked = Profile & { score: number; rank: number; days_counted: number };
type Result<T> = { data: T[] | null; error: unknown };

/** Do not assume the server returned our requested page size. */
export async function readLeaderboardPages<T>(fetch: (offset: number, size: number) => PromiseLike<Result<T>>, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await fetch(rows.length, 200);
    if (signal?.aborted) throw new Error("Leaderboard request cancelled");
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}
const userFrom = (row: Profile): User => ({ id: row.id, name: row.name, username: row.username ?? undefined, avatar: row.avatar_url ?? undefined,
  currentStreak: 0, weeklyAvgPoints: 0, lastActivityDate: "" });
const entryFrom = (row: Ranked) => ({ user: userFrom(row), avgSupScore: Number(row.score), rank: Number(row.rank), sessionsCounted: Number(row.days_counted) });

/** Server ranking and compatibility reads both preserve main's time-weighted score. */
export function createLeaderboardSource(userId: string): LeaderboardSource {
  let rpcMissingAt: number | null = null;
  type Snapshot = { pending: boolean; signal: AbortSignal; request: Promise<[Profile[], Daily[], Friend[]]>; views: Partial<Record<"everyone" | "friends", LeaderboardPage>> };
  const snapshots = new Map<string, Snapshot>();
  return async (query, offset, limit, force, signal) => {
    const cancel = <T extends { abortSignal: (signal: AbortSignal) => T }>(request: T) => request.abortSignal(signal);
    const start = query.period === "day" ? query.dateKey : addDaysToDateKey(query.dateKey, -6);
    if (rpcMissingAt === null || Date.now() - rpcMissingAt >= 60_000) {
      const { data, error } = await cancel(supabase.rpc("community_leaderboard_page", {
        p_start: start, p_end: query.dateKey, p_scope: query.scope, p_offset: offset, p_limit: limit,
      }));
      if (signal.aborted) throw new Error("Leaderboard request cancelled");
      if (!error) {
        const response = data as { entries: Ranked[]; own: Ranked | null; total: number; friends: number };
        if (!response || !Array.isArray(response.entries) || !Number.isFinite(Number(response.total))) throw new Error("Invalid leaderboard response");
        return { entries: response.entries.map(entryFrom), ownEntry: response.own ? entryFrom(response.own) : null,
          total: Number(response.total), friendCount: Number(response.friends) };
      }
      // Only an absent function enables compatibility reads. Real failures stay visible.
      if (error.code !== "PGRST202" && error.code !== "42883") throw error;
      rpcMissingAt = Date.now();
    }
    const key = `${start}:${query.dateKey}`;
    let snapshot = snapshots.get(key);
    if (!snapshot || snapshot.signal.aborted || force && !snapshot.pending) {
      const request = Promise.all([
        readLeaderboardPages<Profile>((offset, size) => cancel(supabase.from("profiles").select("id, name, username, avatar_url").order("id").range(offset, offset + size - 1)), signal),
        readLeaderboardPages<Daily>((offset, size) => cancel(supabase.from("posture_daily").select("user_id, date, state_totals")
          .gte("date", start).lte("date", query.dateKey).order("user_id").order("date").range(offset, offset + size - 1)), signal),
        readLeaderboardPages<Friend>((offset, size) => cancel(supabase.from("friend_requests").select("from_user_id, to_user_id")
          .eq("status", "accepted").or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`).order("id").range(offset, offset + size - 1)), signal),
      ]);
      snapshot = { pending: true, request, signal, views: {} };
      snapshots.set(key, snapshot);
      if (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value!);
      const current = snapshot;
      void request.then(() => { current.pending = false; }, () => { if (snapshots.get(key) === current) snapshots.delete(key); });
    }
    if (!snapshot.views[query.scope]) {
      const [profiles, daily, friends] = await snapshot.request;
      const ids = new Set(friends.map((row) => row.from_user_id === userId ? row.to_user_id : row.from_user_id)
        .filter((id): id is string => typeof id === "string" && id !== userId));
      const roster = profiles.filter((profile) => query.scope === "everyone" || profile.id === userId || ids.has(profile.id)).map(userFrom);
      const rows = new Map<string, PosturePageRow[]>();
      for (const row of daily) {
        const list = rows.get(row.user_id) ?? [];
        list.push({ date: row.date, stateTotals: row.state_totals, avgScore: null, goodPostureMinutes: null, badPostureMinutes: null,
          totalMinutes: null, totalDeskMs: null, sessionCount: null, interventionCount: null, avgShs: null, minShs: null, maxCpl: null, supScore: null });
        rows.set(row.user_id, list);
      }
      const entries = rankLeaderboard(roster, rows, query.period, new Date(`${query.dateKey}T12:00:00`));
      snapshot.views[query.scope] = { entries, total: entries.length, ownEntry: entries.find((entry) => entry.user.id === userId) ?? null, friendCount: ids.size };
    }
    const page = snapshot.views[query.scope]!;
    return { ...page, entries: page.entries.slice(offset, offset + limit) };
  };
}
