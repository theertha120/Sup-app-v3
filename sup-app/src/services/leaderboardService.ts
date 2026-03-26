import { supabase } from "@/src/lib/supabase";
import type { User } from "../../constants/env";
import { CURRENT_USER_ID } from "../../constants/env";
import { getLocalSupsona } from "./profileService";
import { MOCK_USERS } from "../data/mockUsers";

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
      .select(
        "id, name, avatar_url, current_streak, last_activity_date, weekly_total_points"
      )
      .order("current_streak", { ascending: false });

    if (error) {
      console.warn(
        "[leaderboard] Supabase fetch failed, falling back to mock users",
        error
      );
      // Fall through to mock data below
    } else if (data) {
      const rows = data as ProfileRow[];
      const users: User[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        avatar: row.avatar_url ?? undefined,
        currentStreak: row.current_streak,
        lastActivityDate: row.last_activity_date ?? "",
        weeklyTotalPoints: row.weekly_total_points,
      }));
      const local = await getLocalSupsona(CURRENT_USER_ID);
      const testUser = users.find((u) => u.id === CURRENT_USER_ID);
      if (testUser && local != null) testUser.avatar = local;
      return users;
    }
  } catch (err) {
    console.warn(
      "[leaderboard] Supabase fetch threw, falling back to mock users",
      err
    );
  }

  // Fallback: use static mock users so UI still works
  const users = [...MOCK_USERS].sort(
    (a, b) => b.currentStreak - a.currentStreak
  );
  const local = await getLocalSupsona(CURRENT_USER_ID);
  const testUser = users.find((u) => u.id === CURRENT_USER_ID);
  if (testUser && local != null) testUser.avatar = local;
  return users;
}

// Fetch leaderboard ordered by weekly total points (descending)
export async function fetchLeaderboardByWeeklyPoints(): Promise<User[]> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, name, avatar_url, current_streak, last_activity_date, weekly_total_points"
      )
      .order("weekly_total_points", { ascending: false });

    if (error) {
      console.warn(
        "[leaderboard] Supabase fetch failed, falling back to mock users",
        error
      );
      // Fall through to mock data below
    } else if (data) {
      const rows = data as ProfileRow[];
      const users: User[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        avatar: row.avatar_url ?? undefined,
        currentStreak: row.current_streak,
        lastActivityDate: row.last_activity_date ?? "",
        weeklyTotalPoints: row.weekly_total_points,
      }));
      const local = await getLocalSupsona(CURRENT_USER_ID);
      const testUser = users.find((u) => u.id === CURRENT_USER_ID);
      if (testUser && local != null) testUser.avatar = local;
      return users;
    }
  } catch (err) {
    console.warn(
      "[leaderboard] Supabase fetch threw, falling back to mock users",
      err
    );
  }

  // Fallback: use static mock users so UI still works
  const users = [...MOCK_USERS].sort(
    (a, b) => b.weeklyTotalPoints - a.weeklyTotalPoints
  );
  const local = await getLocalSupsona(CURRENT_USER_ID);
  const testUser = users.find((u) => u.id === CURRENT_USER_ID);
  if (testUser && local != null) testUser.avatar = local;
  return users;
}

