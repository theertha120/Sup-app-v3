import type { PostureData, User } from "../../constants/env";

export const GOOD_POSTURE_SCORE_THRESHOLD = 70;

export function hasGoodPosture(todayData: PostureData): boolean {
  return todayData.avgScore >= GOOD_POSTURE_SCORE_THRESHOLD;
}

export function updateStreak(user: User, todayData: PostureData): User {
  const lastDate = new Date(user.lastActivityDate);
  const today = new Date(todayData.date);
  const daysDiff = Math.floor(
    (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysDiff === 0) {
    // Same day, no change
    return user;
  }

  if (daysDiff === 1 && hasGoodPosture(todayData)) {
    // Consecutive day with good score - increment
    return {
      ...user,
      currentStreak: user.currentStreak + 1,
      lastActivityDate: todayData.date
    };
  }

  // Streak broken - reset (or start new if today is good)
  return {
    ...user,
    currentStreak: hasGoodPosture(todayData) ? 1 : 0,
    lastActivityDate: todayData.date
  };
}