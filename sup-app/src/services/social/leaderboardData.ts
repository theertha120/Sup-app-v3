import type { LeaderboardEntry, LeaderboardPeriod } from "./leaderboardPeriodService";

export type LeaderboardScope = "everyone" | "friends";
export type LeaderboardQuery = { scope: LeaderboardScope; period: LeaderboardPeriod; dateKey: string };
export type LeaderboardPage = { entries: LeaderboardEntry[]; ownEntry: LeaderboardEntry | null; total: number; friendCount: number };
export const LEADERBOARD_PAGE_SIZE = 50;
export const leaderboardKey = (query: LeaderboardQuery) => `${query.dateKey}:${query.scope}:${query.period}`;
