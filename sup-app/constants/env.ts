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
  weeklyAvgScore: number; // Calculated from last 7 days
}

// Leaderboard entry
export interface LeaderboardEntry {
  user: User;
  rank: number;
  weeklyAvgScore: number;
  currentStreak: number;
}

// Temporary current user identifier for mock data.
// In a real backend integration this should come from auth.
export const CURRENT_USER_ID = "user-4";


// Supabase configuration – values should be set via Expo env:
// EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";