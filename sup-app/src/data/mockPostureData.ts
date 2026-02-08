import type { PostureData } from "../../constants/env";
import { CURRENT_USER_ID } from "../../constants/env";

// Minimal 7-day mock dataset for the current user.
// Additional users can be added later following the same shape.
export const MOCK_POSTURE_DATA: PostureData[] = [
  {
    userId: CURRENT_USER_ID,
    date: "2026-02-08",
    avgScore: 68,
    goodPostureMinutes: 150,
    badPostureMinutes: 60,
    totalMinutes: 210
  },
  {
    userId: CURRENT_USER_ID,
    date: "2026-02-07",
    avgScore: 72,
    goodPostureMinutes: 180,
    badPostureMinutes: 45,
    totalMinutes: 225
  },
  {
    userId: CURRENT_USER_ID,
    date: "2026-02-06",
    avgScore: 75,
    goodPostureMinutes: 190,
    badPostureMinutes: 40,
    totalMinutes: 230
  },
  {
    userId: CURRENT_USER_ID,
    date: "2026-02-05",
    avgScore: 80,
    goodPostureMinutes: 210,
    badPostureMinutes: 30,
    totalMinutes: 240
  },
  {
    userId: CURRENT_USER_ID,
    date: "2026-02-04",
    avgScore: 78,
    goodPostureMinutes: 200,
    badPostureMinutes: 35,
    totalMinutes: 235
  },
  {
    userId: CURRENT_USER_ID,
    date: "2026-02-03",
    avgScore: 82,
    goodPostureMinutes: 220,
    badPostureMinutes: 25,
    totalMinutes: 245
  },
  {
    userId: CURRENT_USER_ID,
    date: "2026-02-02",
    avgScore: 85,
    goodPostureMinutes: 230,
    badPostureMinutes: 20,
    totalMinutes: 250
  }
];

