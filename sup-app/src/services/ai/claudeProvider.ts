import { AIProvider, PostureData, PromptType } from "./aiProvider";

function buildPromptDaily(data: PostureData): string {
  return `
You are a friendly posture coach. Based on today's tracking data, write a short 2-3 sentence tip for the user.
Today's data:
- Upright: ${data.uprightMinutesDaily} minutes
- Forward lean: ${data.forwardLeanMinutesDaily} minutes
- Slouched: ${data.slouchedMinutesDaily} minutes
- Tilted left: ${data.tiltedLeftMinutesDaily} minutes
- Tilted right: ${data.tiltedRightMinutesDaily} minutes
Keep the tone warm and motivating, not clinical. Be creative and highlight a gentle suggestion for improvement. Do not use bullet points, just flowing sentences. Your response should only use lowercase letters reasonably with the exception of proper nouns and abbreviations.
  `.trim();
}

function buildPromptHome(data: PostureData): string {
  return `
You are a friendly posture coach. Based on today's tracking data, write a short 2-3 sentence daily target for the user.
Today's data:
- Upright: ${data.uprightMinutesDaily} minutes
- Forward lean: ${data.forwardLeanMinutesDaily} minutes
- Slouched: ${data.slouchedMinutesDaily} minutes
- Tilted left: ${data.tiltedLeftMinutesDaily} minutes
- Tilted right: ${data.tiltedRightMinutesDaily} minutes
- Sup score: ${data.supScoreDaily} (Sup score is a measure of your posture quality. This score is composed of 50% spine health score, 30% using the posture tracker score and 20% using the app score.)
- Total tracked minutes: ${data.totalTrackedMinutesDaily}
Keep the tone warm and motivating, not clinical. Be creative and highlight a reasonable target for the user to work towards. Do not use bullet points, just flowing sentences. Your response should only use lowercase letters reasonably with the exception of proper nouns and abbreviations.
  `.trim();
}

// To update if changing AI provider
const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? "";

export const claudeProvider: AIProvider = {
  async getPostureInsight(data: PostureData, promptType: PromptType): Promise<string> {
    const buildPrompt = promptType === "daily" ? buildPromptDaily(data) : buildPromptHome(data);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 200,
        messages: [{ role: "user", content: buildPrompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const json = await response.json();
    return json.content?.[0]?.text ?? "";
  },
};