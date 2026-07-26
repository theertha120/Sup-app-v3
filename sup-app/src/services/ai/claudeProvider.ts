import { AIProvider, PostureData, PromptType } from "./aiProvider";

// New prompt for the daily 8am scheduled generation
function buildPromptScheduled(rows: PostureData[]): string {
  const summary = rows.map((r) => {
    return `Date: ${r.date}
  - Upright: ${Math.round((r.uprightMinutesDaily ?? 0) / 60000)} min
  - Slouched: ${Math.round((r.slouchedMinutesDaily ?? 0) / 60000)} min
  - Severe: ${Math.round((r.severeMinutesDaily ?? 0) / 60000)} min
  - Forward lean: ${Math.round((r.forwardLeanMinutesDaily ?? 0) / 60000)} min
  - Tilted left: ${Math.round((r.tiltedLeftMinutesDaily ?? 0) / 60000)} min
  - Tilted right: ${Math.round((r.tiltedRightMinutesDaily ?? 0) / 60000)} min
  - Sup score: ${r.supScoreDaily ?? 0}
  - Total tracked: ${Math.round((r.totalTrackedMinutesDaily ?? 0) / 60000)} min`;
  }).join("\n\n");

  return `
You are a friendly posture coach reviewing a user's last 7 days of posture tracking data.

${summary}

Respond in EXACTLY this format with no other text:
Answer 1: <A 2-3 sentence personalised daily target based on trends across the 7 days. Warm, motivating tone. No bullet points. Lowercase except proper nouns.>
Answer 2: <A single concise sentence summarising the user's posture status over the past 7 days.>
  `.trim();
}

// Parser
export function parseScheduledInsight(raw: string): {
  insight: string;
  concisedSummary: string;
} {
  const answer1Match = raw.match(/Answer 1:\s*(.+?)(?=Answer 2:|$)/s);
  const answer2Match = raw.match(/Answer 2:\s*(.+?)$/s);

  return {
    insight: answer1Match?.[1]?.trim() ?? raw.trim(),
    concisedSummary: answer2Match?.[1]?.trim() ?? "",
  };
}


// To update if changing AI provider
const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? "";

export const claudeProvider: AIProvider = {
  async getScheduledDailyInsight(rows: PostureData[], promptType: PromptType): Promise<{
    insight: string;
    concisedSummary: string;
  }> {
    let prompt: string;

    if (promptType === "home") {
      prompt = buildPromptScheduled(rows);
    } else {
      throw new Error("Unsupported prompt type");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Claude API error: ${response.status}`);

    const json = await response.json();
    const raw = json.content?.[0]?.text ?? "";
    return parseScheduledInsight(raw);
  },
};