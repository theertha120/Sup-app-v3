import { AIProvider, InsightColor, SessionInsightData, SessionInsightResult, SessionSummaryData, SessionSummaryResult } from "./aiProvider";

function buildPromptSupdate(data: SessionInsightData): string {
  const toMin = (ms: number) => Math.round((ms ?? 0) / 60000);
  const cplLabel = data.cpl < 600 ? "low" : data.cpl < 1000 ? "building up" : "high";
  const stateLabel: Record<string, string> = {
    upright:      "good alignment",
    transition:   "slight forward shift",
    forward_lean: "forward lean",
    slouched:     "slouched",
    severe:       "severe slouch",
    tilted_left:  "tilting left",
    tilted_right: "tilting right",
  };

  const breakdown = Object.entries(data.sessionStats)
    .filter(([, ms]) => (ms ?? 0) > 0)
    .map(([state, ms]) => `  - ${stateLabel[state] ?? state}: ${toMin(ms!)} min`)
    .join("\n");

  const previousSection = data.previousUpdates.length > 0
    ? `\nPrevious s'updates this session:\n${data.previousUpdates.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
    : "";

  const dailySection = data.dailySummary
    ? `\nGoal for this user (from their most recent daily summary):\n  ${data.dailySummary}`
    : "";

  return `
You are s'kipper, the friendly posture coach in the s'up posture tracking app. The user has just asked for a mid-session update.

Session data so far:
- Total session time: ${toMin(data.sessionDurationMs)} minutes
- Currently in: ${stateLabel[data.currentState] ?? data.currentState} for ${toMin(data.timeInCurrentStateMs)} minutes
- Cumulative spinal load: ${data.cpl} (${cplLabel})
- Session breakdown:
${breakdown || "  - no posture data recorded yet"}
${previousSection}
${dailySection}

Write a warm, conversational 2-3 sentence mid-session update. Reference their goal if one is provided. Comment on the most notable aspect of their session so far. Give one clear actionable suggestion they can act on right now. Lowercase only unless for proper nouns. No bullet points or headers.

Based on everything above, decide if this session is "green" (going well), "yellow" (ok, room to improve), or "red" (needs attention). Use your own judgment.

Respond with ONLY a JSON object, no other text:
{"color": "yellow", "message": "your message here"}
  `.trim();
}


// To update if changing AI provider
const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? "";

async function callClaude(prompt: string, maxTokens = 200): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  const json = await response.json();
  return json.content?.[0]?.text ?? "";
}

function buildPromptSessionSummary(data: SessionSummaryData): string {
  const toMin = (ms: number) => Math.round((ms ?? 0) / 60000);
  const cplLabel = data.cpl < 600 ? "low" : data.cpl < 1000 ? "building up" : "high";
  const stateLabel: Record<string, string> = {
    upright:      "good alignment",
    transition:   "slight forward shift",
    forward_lean: "forward lean",
    slouched:     "slouched",
    severe:       "severe slouch",
    tilted_left:  "tilting left",
    tilted_right: "tilting right",
  };

  const breakdown = Object.entries(data.sessionStats)
    .filter(([, ms]) => (ms ?? 0) > 0)
    .map(([state, ms]) => `  - ${stateLabel[state] ?? state}: ${toMin(ms!)} min`)
    .join("\n");

  const updatesSection = data.previousUpdates.length > 0
    ? `\nMid-session updates given:\n${data.previousUpdates.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
    : "";

  return `
You are s'kipper, the friendly posture coach in the s'up posture tracking app. The user has just ended their session.

Full session data:
- Total session time: ${toMin(data.sessionDurationMs)} minutes
- Cumulative spinal load: ${data.cpl} (${cplLabel})
- Session breakdown:
${breakdown || "  - no posture data recorded"}
${updatesSection}

Write a warm end-of-session summary in 3-4 sentences. Cover: (1) an overall verdict on how the session went, (2) one thing that was good, (3) one thing to improve next time. Keep it conversational and encouraging. Lowercase only unless for proper nouns. No bullet points or headers.

Rate the overall session "green" (good session), "yellow" (mixed), or "red" (needs work). Use your judgment.

Respond with ONLY a JSON object, no other text:
{"color": "yellow", "message": "your message here"}
  `.trim();
}

export const claudeProvider: AIProvider = {
  async getSessionInsight(data: SessionInsightData): Promise<SessionInsightResult> {
    const raw = await callClaude(buildPromptSupdate(data));
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? raw);
      const validColors: InsightColor[] = ["green", "yellow", "red"];
      const color: InsightColor = validColors.includes(parsed.color) ? parsed.color : "yellow";
      return { color, message: parsed.message ?? raw };
    } catch {
      return { color: "yellow", message: raw };
    }
  },

  async getSessionSummary(data: SessionSummaryData): Promise<SessionSummaryResult> {
    const raw = await callClaude(buildPromptSessionSummary(data), 350);
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? raw);
      const validColors: InsightColor[] = ["green", "yellow", "red"];
      const color: InsightColor = validColors.includes(parsed.color) ? parsed.color : "yellow";
      return { color, message: parsed.message ?? raw };
    } catch {
      return { color: "yellow", message: raw };
    }
  },
};