export type PromptType = "daily" | "home";

export interface PostureData {
  date: Date;
  uprightMinutesDaily: number;
  forwardLeanMinutesDaily: number;
  slouchedMinutesDaily: number;
  severeMinutesDaily: number;
  tiltedLeftMinutesDaily: number;
  tiltedRightMinutesDaily: number;
  supScoreDaily: number;
  totalTrackedMinutesDaily: number;
}

export interface AIProvider {
  getScheduledDailyInsight(rows: PostureData[], promptType: PromptType): Promise<{
    insight: string;
    concisedSummary: string;
  }>;
}