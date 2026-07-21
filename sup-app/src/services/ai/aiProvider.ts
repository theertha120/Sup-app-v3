export type PromptType = "daily" | "home";

export interface PostureData {
  uprightMinutesDaily: number;
  forwardLeanMinutesDaily: number;
  slouchedMinutesDaily: number;
  severeMinutesDaily: number;
  tiltedLeftMinutesDaily: number;
  tiltedRightMinutesDaily: number;
  supScoreDaily: number;
  totalTrackedMinutesDaily: number;
}

export interface SessionInsightData {
  sessionDurationMs: number;
  currentState: string;
  timeInCurrentStateMs: number;
  cpl: number;
  sessionStats: Partial<Record<string, number>>; // posture state → ms
}

export type InsightColor = "green" | "yellow" | "red";

export interface SessionInsightResult {
  message: string;
  color: InsightColor;
}

export interface AIProvider {
  getPostureInsight(data: PostureData, promptType: PromptType): Promise<string>;
  getSessionInsight(data: SessionInsightData): Promise<SessionInsightResult>;
}