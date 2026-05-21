import { supabase } from "@/src/lib/supabase";
import type { User } from "@/constants/env";
import { getLocalSupsona } from "../user/profileService";

type ProfileRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  current_streak: number;
  last_activity_date: string | null;
  weekly_total_points: number;
};

// Fetch leaderboard ordered by current streak (descending)
export async function fetchLeaderboardByStreak(): Promise<User[]> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, avatar_url, current_streak, last_activity_date, weekly_total_points")
      .order("current_streak", { ascending: false });

    if (error) {
      console.error("[leaderboard] Failed to fetch by streak:", error);
      return [];
    }

    if (!data) {
      return [];
    }

    const rows = data as ProfileRow[];
    const users: User[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatar: row.avatar_url ?? undefined,
      currentStreak: row.current_streak,
      lastActivityDate: row.last_activity_date ?? "",
      weeklyTotalPoints: row.weekly_total_points,
    }));

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const currentId = user?.id ?? null;
      if (currentId) {
        const local = await getLocalSupsona(currentId);
        const testUser = users.find((u) => u.id === currentId);
        if (testUser && local != null) testUser.avatar = local;
      }
    } catch {
      // ignore — no authenticated user
    }

    return users;
  } catch (err) {
    console.error("[leaderboard] Exception while fetching by streak:", err);
    return [];
  }
}

// Fetch leaderboard ordered by weekly total points (descending)
export async function fetchLeaderboardByWeeklyPoints(): Promise<User[]> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, avatar_url, current_streak, last_activity_date, weekly_total_points")
      .order("weekly_total_points", { ascending: false });

    if (error) {
      console.error("[leaderboard] Failed to fetch by weekly points:", error);
      return [];
    }

    if (!data) {
      return [];
    }

    const rows = data as ProfileRow[];
    const users: User[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatar: row.avatar_url ?? undefined,
      currentStreak: row.current_streak,
      lastActivityDate: row.last_activity_date ?? "",
      weeklyTotalPoints: row.weekly_total_points,
    }));

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const currentId = user?.id ?? null;
      if (currentId) {
        const local = await getLocalSupsona(currentId);
        const testUser = users.find((u) => u.id === currentId);
        if (testUser && local != null) testUser.avatar = local;
      }
    } catch {
      // ignore — no authenticated user
    }

    return users;
  } catch (err) {
    console.error("[leaderboard] Exception while fetching by weekly points:", err);
    return [];
  }
}

