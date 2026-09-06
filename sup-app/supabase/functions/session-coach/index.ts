// Live in-session AI coach ("s'kipper") — mid-session updates and end-of-session
// summaries for app/(tabs)/desk.tsx, called via supabase.functions.invoke() so
// the Anthropic key never leaves the server. JWT verification is left on
// (deploy without --no-verify-jwt) since this is called by a logged-in app
// user, not a cron job — unlike generate-daily-summaries, no manual auth
// check is needed here.
//
// Restored 2026-09 after a merge (c507749, Aug 19) accidentally reverted
// claudeProvider.ts back to calling api.anthropic.com directly from the
// client with EXPO_PUBLIC_ANTHROPIC_API_KEY (never set, by design — see
// src/services/ai/claudeProvider.ts), and a follow-up commit on the same
// branch (ef84ae4) deleted this directory entirely. Don't let the client
// go back to calling Anthropic directly — that's exactly the mistake this
// file exists to prevent.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// ─── Types (mirrors src/services/ai/aiProvider.ts) ─────────────────────────────

type InsightColor = "green" | "yellow" | "red";

interface SessionInsightData {
  sessionDurationMs: number;
  currentState: string;
  timeInCurrentStateMs: number;
  cpl: number;
  sessionStats: Record<string, number | undefined>;
  previousUpdates: string[];
  dailySummary: string | null;
}

interface SessionSummaryData {
  sessionDurationMs: number;
  cpl: number;
  sessionStats: Record<string, number | undefined>;
  previousUpdates: string[];
}

type RequestBody =
  | { kind: "insight"; data: SessionInsightData }
  | { kind: "summary"; data: SessionSummaryData };

interface CoachResult {
  color: InsightColor;
  message: string;
}

const STATE_LABEL: Record<string, string> = {
  upright:      "good alignment",
  transition:   "slight forward shift",
  forward_lean: "forward lean",
  slouched:     "slouched",
  severe:       "severe slouch",
  tilted_left:  "tilting left",
  tilted_right: "tilting right",
};

function toMin(ms: number): number {
  return Math.round((ms ?? 0) / 60000);
}

function cplLabel(cpl: number): string {
  return cpl < 600 ? "low" : cpl < 1000 ? "building up" : "high";
}

function breakdownLines(sessionStats: Record<string, number | undefined>): string {
  return Object.entries(sessionStats)
    .filter(([, ms]) => (ms ?? 0) > 0)
    .map(([state, ms]) => `  - ${STATE_LABEL[state] ?? state}: ${toMin(ms!)} min`)
    .join("\n");
}

// ─── Prompts ────────────────────────────────────────────────────────────────────

function buildPromptInsight(data: SessionInsightData): string {
  const breakdown = breakdownLines(data.sessionStats);

  const previousSection = data.previousUpdates.length > 0
    ? `\nPrevious s'updates this session:\n${data.previousUpdates.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
    : "";

  const dailySection = data.dailySummary
    ? `\nToday's goal for this user:\n  ${data.dailySummary}`
    : "";

  return `
You are s'kipper, the friendly posture coach in the s'up posture tracking app. The user has just asked for a mid-session update.

Session data so far:
- Total session time: ${toMin(data.sessionDurationMs)} minutes
- Currently in: ${STATE_LABEL[data.currentState] ?? data.currentState} for ${toMin(data.timeInCurrentStateMs)} minutes
- Cumulative s'train: ${data.cpl} (${cplLabel(data.cpl)})
- Session breakdown:
${breakdown || "  - no posture data recorded yet"}
${previousSection}
${dailySection}

Write a warm, conversational 2-3 sentence mid-session update. Reference today's goal if one is provided. Comment on the most notable aspect of their session so far. Give one clear actionable suggestion they can act on right now. Lowercase only, except for proper nouns and the standalone word "I", which should always be capitalized. No em dashes. No bullet points or headers.

Based on everything above, decide if this session is "green" (going well), "yellow" (ok, room to improve), or "red" (needs attention). Use your own judgment.

Respond with ONLY a JSON object, no other text:
{"color": "yellow", "message": "your message here"}
  `.trim();
}

function buildPromptSummary(data: SessionSummaryData): string {
  const breakdown = breakdownLines(data.sessionStats);

  const updatesSection = data.previousUpdates.length > 0
    ? `\nMid-session updates given:\n${data.previousUpdates.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
    : "";

  return `
You are s'kipper, the friendly posture coach in the s'up posture tracking app. The user has just ended their session.

Full session data:
- Total session time: ${toMin(data.sessionDurationMs)} minutes
- Cumulative s'train: ${data.cpl} (${cplLabel(data.cpl)})
- Session breakdown:
${breakdown || "  - no posture data recorded"}
${updatesSection}

Write a warm end-of-session summary in 3-4 sentences. Cover: (1) an overall verdict on how the session went, (2) one thing that was good, (3) one thing to improve next time. Keep it conversational and encouraging. Lowercase only, except for proper nouns and the standalone word "I", which should always be capitalized. No em dashes. No bullet points or headers.

Rate the overall session "green" (good session), "yellow" (mixed), or "red" (needs work). Use your judgment.

Respond with ONLY a JSON object, no other text:
{"color": "yellow", "message": "your message here"}
  `.trim();
}

// ─── Claude call + response parsing ────────────────────────────────────────────

async function callClaude(prompt: string, maxTokens = 350): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.content?.[0]?.text ?? "";
}

function parseResult(raw: string): CoachResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw);
    const validColors: InsightColor[] = ["green", "yellow", "red"];
    const color: InsightColor = validColors.includes(parsed.color) ? parsed.color : "yellow";
    return { color, message: parsed.message ?? raw };
  } catch {
    return { color: "yellow", message: raw };
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  try {
    const prompt = body.kind === "insight"
      ? buildPromptInsight(body.data)
      : buildPromptSummary(body.data);

    const raw = await callClaude(prompt);
    const result = parseResult(raw);

    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[session-coach] error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
