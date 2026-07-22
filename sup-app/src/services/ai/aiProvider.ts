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
  previousUpdates: string[];       // prior s'update messages this session
  dailySummary: string | null;     // today's goal from daily-ai-summary table
}

export type InsightColor = "green" | "yellow" | "red";

export interface SessionInsightResult {
  message: string;
  color: InsightColor;
}

export interface SessionSummaryData {
  sessionDurationMs: number;
  cpl: number;
  sessionStats: Partial<Record<string, number>>;
  previousUpdates: string[];
}

export interface SessionSummaryResult {
  message: string;
  color: InsightColor;
}

export interface AIProvider {
  getPostureInsight(data: PostureData, promptType: PromptType): Promise<string>;
  getSessionInsight(data: SessionInsightData): Promise<SessionInsightResult>;
  getSessionSummary(data: SessionSummaryData): Promise<SessionSummaryResult>;
}