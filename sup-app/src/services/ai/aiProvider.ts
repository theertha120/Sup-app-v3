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

export interface AIProvider {
  getPostureInsight(data: PostureData, promptType: PromptType): Promise<string>;
}