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

interface SessionComparisonMetric {
  label: string;
  current: string;
  previous: string;
  change: string;
  improved: boolean | null;
}

interface SessionHighlight {
  label: string;
  text: string;
}

interface SessionSummaryData {
  sessionDurationMs: number;
  cpl: number;
  sessionStats: Record<string, number | undefined>;
  previousUpdates: string[];
  // Computed on-device (src/lib/sessionHighlights.ts); optional so older app builds still work
  comparison?: SessionComparisonMetric[] | null;
  highlights?: SessionHighlight[];
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

// Mirrors CPL_WEIGHTS in src/contexts/IMUContext.tsx — used only to rank which
// non-upright state cost the most this session, so the model targets the right habit.
const STATE_COST: Record<string, number> = {
  forward_lean: 0.6, slouched: 1.0, severe: 1.5, tilted_left: 0.7, tilted_right: 0.7,
};

// Transition time is left out of the prompt breakdown (still counted in the
// session total, so the remaining percentages stay true shares of the session).
const HIDDEN_STATES = new Set(["transition"]);

// Short, concrete fixes per state (adapted from POSTURE_CUES / INTERVENTION_MESSAGES
// in src/lib/imuParser.ts) so suggestions match what the app tells users elsewhere.
const POSTURE_GUIDE = `
How s'up reads posture (two s'pots: between the shoulder blades and on the lower back):
- good alignment: spine neutral, the goal state. the only state that lets s'train recover, and it recovers slowly.
- forward lean: back straight but hinged toward the screen, back muscles working to hold it. fix: move the screen or keyboard closer instead of leaning in, or sit back against the chair.
- slouched: upper back rounding. fix: sit tall, imagine a thread pulling the crown of the head up.
- severe slouch: deep rounding, the worst state for the s'core and builds s'train fastest. fix: change position right now, even a small shift helps.
- tilting left / right: weight on one side, often from an armrest or crossed legs. fix: sit evenly on both sit bones, uncross legs, come off the armrest.
- the s'up s'core is based on how tracked time is split across these posture states: more of the session in good alignment raises it, more time slouched, severe or tilted lowers it. so the percentages below are exactly what moves their s'core, and shifting even a few minutes from a problem state into good alignment helps.
- s'train is s'up's posture-awareness indicator: it builds while out of good alignment and only drops while in good alignment. under 600 is low, 600 to 1000 is building up, over 1000 is high.
`.trim();

const STYLE_RULES = `
Style rules:
- lowercase only, except proper nouns and the standalone word "I", which is always capitalized.
- no em dashes, no bullet points, no headers, no emojis.
- talk to the user as "you". warm and direct, like a coach who has been watching, not a report.
- quote at least one real number from the data (minutes or a percentage) so it is clearly about them. round naturally.
- never make medical claims or mention pain, injury, discs, ligaments or diagnosis. s'train is not a measure of physical force or damage.
- no generic filler like "remember to sit up straight" or "posture is important". every suggestion must be a specific physical action or setup change tied to the data.
`.trim();

interface StateShare { state: string; label: string; min: number; pct: number }

function stateShares(sessionStats: Record<string, number | undefined>): StateShare[] {
  const total = Object.values(sessionStats).reduce<number>((s, ms) => s + (ms ?? 0), 0);
  return Object.entries(sessionStats)
    .filter(([state, ms]) => (ms ?? 0) > 0 && !HIDDEN_STATES.has(state))
    .map(([state, ms]) => ({
      state,
      label: STATE_LABEL[state] ?? state,
      min: toMin(ms!),
      pct: total > 0 ? Math.round(((ms ?? 0) / total) * 100) : 0,
    }))
    .sort((a, b) => b.pct - a.pct);
}

function breakdownLines(shares: StateShare[]): string {
  return shares.map((s) => `  - ${s.label}: ${s.min} min (${s.pct}%)`).join("\n");
}

/** Non-upright state with the highest time × cost — the habit most worth fixing. */
function biggestDrag(shares: StateShare[]): StateShare | null {
  return shares
    .filter((s) => STATE_COST[s.state] !== undefined)
    .reduce<StateShare | null>(
      (best, s) => (!best || s.pct * STATE_COST[s.state] > best.pct * STATE_COST[best.state] ? s : best),
      null,
    );
}

function uprightPct(shares: StateShare[]): number {
  return shares.find((s) => s.state === "upright")?.pct ?? 0;
}

// ─── Prompts ────────────────────────────────────────────────────────────────────

function buildPromptInsight(data: SessionInsightData): string {
  const shares = stateShares(data.sessionStats);
  const breakdown = breakdownLines(shares);
  const drag = biggestDrag(shares);
  const sessionMin = toMin(data.sessionDurationMs);
  const currentLabel = STATE_LABEL[data.currentState] ?? data.currentState;

  const previousSection = data.previousUpdates.length > 0
    ? `\nPrevious s'updates this session (do not repeat their wording or their suggestion; if a suggestion was given, check in on whether the data shows it worked):\n${data.previousUpdates.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
    : "";

  const dailySection = data.dailySummary
    ? `\nThe user's recent trend and today's focus (from their 7-day review):\n  ${data.dailySummary}`
    : "";

  return `
You are s'kipper, the friendly posture coach in the s'up posture tracking app. The user has just tapped for a mid-session update while sitting at their desk.

Everything below describes ONLY the current desk session (the one that started when the s'pots last connected). It is not the user's whole day or their history. Do not reference earlier sessions, a daily total, or how long they have been "tracking today" — if the numbers are small it just means this session is young, not that the user only started using the app today. Comment strictly on this session.

${POSTURE_GUIDE}

Session data so far:
- Total session time: ${sessionMin} minutes
- Right now: ${currentLabel}, held for ${toMin(data.timeInCurrentStateMs)} minutes
- Time in good alignment: ${uprightPct(shares)}%
- Cumulative s'train: ${data.cpl} (${cplLabel(data.cpl)})
- Session breakdown (largest first):
${breakdown || "  - no posture data recorded yet"}
- Habit costing the most so far: ${drag ? `${drag.label} (${drag.pct}% of the session)` : "none"}
${previousSection}
${dailySection}

Write a 2-3 sentence mid-session update in this order:
1. what they are doing well in this session, backed by a number. if almost nothing is going well, acknowledge the effort of tracking instead of inventing praise.
2. the one thing pulling this session down (usually the habit costing the most, but if their current posture is slouched, severe or tilted and has been held for a few minutes, address that first since it is happening right now).
3. one specific action to do in the next minute, taken from the fixes above and adapted to their situation. if today's focus is provided and relevant, tie the action to it.
If the session is under 3 minutes, keep it short and just give an encouraging read on how they have started. If they are in good alignment right now, say so and tell them what to keep doing.

${STYLE_RULES}

Pick the color from the data:
- "green": good alignment is the majority of the session, s'train is low, and they are not currently slouched, severe or tilted.
- "red": severe slouch or slouched makes up a large share, s'train is high, or they have been slouched/severe/tilted for several minutes right now.
- "yellow": anything in between.

Respond with ONLY a JSON object, no other text:
{"color": "yellow", "message": "your message here"}
  `.trim();
}

function buildPromptSummary(data: SessionSummaryData): string {
  const shares = stateShares(data.sessionStats);
  const breakdown = breakdownLines(shares);
  const drag = biggestDrag(shares);

  const updatesSection = data.previousUpdates.length > 0
    ? `\nMid-session updates given (use these to say whether they followed through on the advice, and do not repeat the same suggestion word for word):\n${data.previousUpdates.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
    : "";

  const comparison = data.comparison ?? null;
  const comparisonSection = comparison?.length
    ? `\nCompared with their previous session (posture shares are % of session time; change is the difference):\n${comparison
        .map((m) => `  - ${m.label}: ${m.current} now vs ${m.previous} last time (${m.change}${m.improved === null ? "" : m.improved ? ", better" : ", worse"})`)
        .join("\n")}`
    : "\nThere is no previous session to compare with, so do not mention one.";

  const highlights = data.highlights ?? [];
  const highlightsSection = highlights.length
    ? `\nSession highlights (shown to the user as a list right below your message):\n${highlights.map((h) => `  - ${h.label}: ${h.text}`).join("\n")}`
    : "";

  return `
You are s'kipper, the friendly posture coach in the s'up posture tracking app. The user has just ended their session.

Everything below describes the session that just ended (from when the s'pots connected to now), plus a comparison with their single previous session. It is not the user's whole day or their history. Do not reference a daily total, other sessions, or how long they have been "using the app today" — a short session just means this one sitting was short.

${POSTURE_GUIDE}

Full session data:
- Total session time: ${toMin(data.sessionDurationMs)} minutes
- Time in good alignment: ${uprightPct(shares)}%
- Final s'train: ${data.cpl} (${cplLabel(data.cpl)})
- Session breakdown (largest first):
${breakdown || "  - no posture data recorded"}
- Habit that cost the most: ${drag ? `${drag.label} (${drag.pct}% of the session)` : "none"}
${comparisonSection}
${highlightsSection}
${updatesSection}

Write a 3-4 sentence end-of-session summary in this order:
1. a one-line verdict on the session. if a comparison is provided, say whether it beat the previous session, using the biggest posture change (for example "good alignment up 8% on last time"). otherwise use the good alignment percentage.
2. what went well and should be kept up, backed by a number. you may point to one highlight (like the best streak or the corrections count) but do not list them, the user already sees them.
3. the one habit that cost the most, with its number. if a "where it slipped" time is provided, use it to say when it tends to happen.
4. one specific thing to do differently next session, taken from the fixes above. if posture slipped after a certain time, suggest a concrete check-in or movement break just before that point.
If the session was under 3 minutes, skip the deep analysis and just thank them and encourage a longer sit next time.

${STYLE_RULES}

Pick the color from the data:
- "green": good alignment was the majority of the session and s'train finished low.
- "red": slouched and severe slouch together made up a large share of the session, or s'train finished high.
- "yellow": anything in between.

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
