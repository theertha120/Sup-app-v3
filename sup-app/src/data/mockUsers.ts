import type { User } from "../../constants/env";
import leaderboardData from "./leaderboard.json";

// Strongly-typed view of the mock users backing the leaderboard.
export const MOCK_USERS = leaderboardData.users as User[];

