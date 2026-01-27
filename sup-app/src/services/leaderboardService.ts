import { supabase } from "@/src/lib/supabase";
import type { User } from "../../constants/env";

type ProfileRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  current_streak: number;
  last_activity_date: string | null;
  weekly_avg_score: number;
};

// Fetch leaderboard ordered by current streak (descending)
export async function fetchLeaderboardByStreak(): Promise<User[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, name, avatar_url, current_streak, last_activity_date, weekly_avg_score"
    )
    .order("current_streak", { ascending: false });

  if (error) {
    console.error("[leaderboard] Failed to fetch leaderboard", error);
    throw error;
  }

  const rows = (data ?? []) as ProfileRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    avatar: row.avatar_url ?? undefined,
    currentStreak: row.current_streak,
    lastActivityDate: row.last_activity_date ?? "",
    weeklyAvgScore: row.weekly_avg_score,
  }));
}

// Fetch leaderboard ordered by weekly average score (descending)
export async function fetchLeaderboardByWeeklyAverage(): Promise<User[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, name, avatar_url, current_streak, last_activity_date, weekly_avg_score"
    )
    .order("weekly_avg_score", { ascending: false });

  if (error) {
    console.error("[leaderboard] Failed to fetch leaderboard", error);
    throw error;
  }

  const rows = (data ?? []) as ProfileRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    avatar: row.avatar_url ?? undefined,
    currentStreak: row.current_streak,
    lastActivityDate: row.last_activity_date ?? "",
    weeklyAvgScore: row.weekly_avg_score,
  }));
}

