// User posture data model
export interface PostureData {
  userId: string;
  date: string; // ISO 8601 format: "2026-01-24"
  avgScore: number; // 0-100
  goodPostureMinutes: number;
  badPostureMinutes: number;
  totalMinutes: number;
}

// User profile with streak tracking
export interface User {
  id: string;
  name: string;
  avatar?: string;
  currentStreak: number;
  lastActivityDate: string; // ISO 8601 format
  weeklyAvgPoints: number; // Sum of daily avg scores from last 7 days
  previousWeekStreakRank?: number; // Last week's streak rank
  previousWeekWeeklyRank?: number; // Last week's weekly-points rank
}

// Leaderboard entry
export interface LeaderboardEntry {
  user: User;
  rank: number;
  weeklyAvgPoints: number;
  currentStreak: number;
}

// Temporary current user identifier for mock data.
// In a real backend integration this should come from auth.
// Supabase configuration – values should be set via Expo env:
// EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";