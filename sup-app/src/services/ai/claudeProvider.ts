import { AIProvider, PostureData } from "./aiProvider";

function buildPrompt(data: PostureData): string {
  return `
You are a friendly posture coach. Based on today's tracking data, write a short, encouraging 2-3 sentence insight for the user.
Today's data:
- Upright: ${data.uprightMinutes} minutes
- Slouched: ${data.slouchedMinutes} minutes
- Leaned left: ${data.leanedLeftMinutes} minutes
- Leaned right: ${data.leanedRightMinutes} minutes
- Total tracked time: ${data.totalTrackedMinutes} minutes
Keep the tone warm and motivating, not clinical. Highlight one positive thing and one gentle suggestion for improvement. Do not use bullet points, just flowing sentences. Your response should only use lowercase letters reasonably with the exception of proper nouns and abbreviations.
  `.trim();
}

// To update if changing AI provider
const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? "";

export const claudeProvider: AIProvider = {
  async getPostureInsight(data: PostureData): Promise<string> {
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
        messages: [{ role: "user", content: buildPrompt(data) }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const json = await response.json();
    return json.content?.[0]?.text ?? "";
  },
};