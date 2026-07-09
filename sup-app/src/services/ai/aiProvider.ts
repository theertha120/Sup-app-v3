export interface PostureData {
  uprightMinutes: number;
  slouchedMinutes: number;
  leanedLeftMinutes: number;
  leanedRightMinutes: number;
  totalTrackedMinutes: number;
}

export interface AIProvider {
  getPostureInsight(data: PostureData): Promise<string>;
}