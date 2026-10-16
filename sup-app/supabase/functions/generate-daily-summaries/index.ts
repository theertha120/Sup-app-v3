import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StateTotals {
  upright?: number;
  slouched?: number;
  severe?: number;
  forward_lean?: number;
  tilted_left?: number;
  tilted_right?: number;
}

interface PostureRow {
  date: string;
  state_totals: StateTotals;
  sup_score: number;
  total_desk_ms: number;
}

interface UserProfile {
  id: string;
  daily_run: string | null;                 // "HH:00" in the user's LOCAL time, e.g. "08:00"
  timezone_offset_minutes: number | null;   // minutes east of UTC, saved by the app (SGT = 480)
}

/** One user to summarise, with the local calendar date the summary is for. */
interface Job {
  userId: string;
  today: string; // YYYY-MM-DD in the user's timezone
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Users with no saved offset yet (profiles created before it was recorded)
// fall back to Singapore time, which is what this job always used before.
const DEFAULT_OFFSET_MINUTES = 480;

/** The user's local hour (0–23) and date (YYYY-MM-DD) at `now`. */
function localNow(now: Date, offsetMinutes: number | null): { hour: number; date: string } {
  const local = new Date(now.getTime() + (offsetMinutes ?? DEFAULT_OFFSET_MINUTES) * 60_000);
  // UTC getters on the shifted instant read off the user's wall-clock time.
  return { hour: local.getUTCHours(), date: local.toISOString().slice(0, 10) };
}

/** Parse "HH:00" → hour number, returns null if malformed */
function parseHour(dailyRun: string | null | undefined): number | null {
  if (!dailyRun) return null;
  const match = dailyRun.match(/^(\d{1,2}):00$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  return h >= 0 && h <= 23 ? h : null;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(rows: PostureRow[]): string {
  const summary = rows
    .map((r) => {
      const t = r.state_totals ?? {};
      const mins = (ms?: number) => Math.round((ms ?? 0) / 60000);
      return `Date: ${r.date}
  - Upright: ${mins(t.upright)} min
  - Slouched: ${mins(t.slouched)} min
  - Severe: ${mins(t.severe)} min
  - Forward lean: ${mins(t.forward_lean)} min
  - Tilted left: ${mins(t.tilted_left)} min
  - Tilted right: ${mins(t.tilted_right)} min
  - Sup score: ${r.sup_score ?? 0}
  - Total tracked: ${mins(r.total_desk_ms)} min`;
    })
    .join("\n\n");

  return `
You are a friendly posture coach reviewing a user's last 7 days of posture tracking data.

${summary}

Respond in EXACTLY this format with no other text:
Answer 1: <Write a warm and motivating personalised insight in 2-3 sentences based on trends across the past 7 days. Keep it conversational and encouraging. Lowercase only, except for proper nouns and the standalone word "I", which should always be capitalized. No em dashes. No bullet points or headers.>
Answer 2: <Concise sentences summarising the user's posture status over the past 7 days. This will be used to generate future insights so be specific about the data and progress over the past 7 days for the different statistics.>
  `.trim();
}

function parseResponse(raw: string): { insight: string; concisedSummary: string } {
  const answer1 = raw.match(/Answer 1:\s*(.+?)(?=Answer 2:|$)/s)?.[1]?.trim() ?? raw.trim();
  const answer2 = raw.match(/Answer 2:\s*(.+?)$/s)?.[1]?.trim() ?? "";
  return { insight: answer1, concisedSummary: answer2 };
}

// ─── Claude call ──────────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.content?.[0]?.text ?? "";
}

// ─── Per-user processing ──────────────────────────────────────────────────────

async function processUser(
  userId: string,
  today: string
): Promise<"ok" | "skipped" | "error"> {
  const { data: existing } = await supabase
    .from("daily_ai_summary")
    .select("user_id")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (existing) return "skipped";

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const { data: rows, error } = await supabase
    .from("posture_daily")
    .select("date, state_totals, sup_score, total_desk_ms")
    .eq("user_id", userId)
    .in("date", dates)
    .order("date", { ascending: false });

  if (error) {
    console.error(`[${userId}] posture_daily fetch:`, error.message);
    return "error";
  }
  if (!rows?.length) return "skipped";

  const raw = await callClaude(buildPrompt(rows as PostureRow[]));
  const { insight, concisedSummary } = parseResponse(raw);

  const { error: upsertError } = await supabase
    .from("daily_ai_summary")
    .upsert(
      {
        user_id: userId,
        date: today,                  // user's local date — matches the app's toLocalDateKey()
        insight,
        concised_summary: concisedSummary,
      },
      { onConflict: "user_id,date" }
    );

  if (upsertError) {
    console.error(`[${userId}] upsert:`, upsertError.message);
    return "error";
  }

  return "ok";
}

// ─── Batch processing with concurrency control ────────────────────────────────
// Runs `userIds` in parallel chunks of `chunkSize`.
// This keeps us well under both the Edge Function timeout (400 s wall-clock)
// and the Claude API concurrency limits.

const CHUNK_SIZE = 10;          // parallel Claude calls per chunk
const INTER_CHUNK_DELAY_MS = 500; // breathing room between chunks

async function processBatch(
  jobs: Job[]
): Promise<{ ok: number; skipped: number; error: number }> {
  const results = { ok: 0, skipped: 0, error: 0 };

  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    const chunk = jobs.slice(i, i + CHUNK_SIZE);

    const chunkResults = await Promise.allSettled(
      chunk.map((job) => processUser(job.userId, job.today))
    );

    for (const r of chunkResults) {
      if (r.status === "fulfilled") results[r.value]++;
      else results.error++;
    }

    // Don't delay after the last chunk
    if (i + CHUNK_SIZE < jobs.length) {
      await new Promise((resolve) => setTimeout(resolve, INTER_CHUNK_DELAY_MS));
    }
  }

  return results;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
//
// Must be scheduled to run EVERY hour (on the hour). Each run picks the users
// whose own local time is currently their chosen daily_run hour, using the
// timezone_offset_minutes the app saves — so "08:00" means 8am wherever the
// user is, not 8am Singapore time.

Deno.serve(async (req) => {
  // Auth check
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // A request body can only be read once, so parse it a single time up front.
  const body = await req.json().catch(() => ({}));

  let jobs: Job[];
  if (Array.isArray(body?.jobs)) {
    // Overflow invocation — process exactly the jobs handed over.
    jobs = body.jobs as Job[];
  } else {
    const now = new Date();
    const { data: profiles, error: profilesError } = await supabase
      .from("user_profile")
      .select("id, daily_run, timezone_offset_minutes")
      .not("daily_run", "is", null);

    if (profilesError) {
      return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
    }

    jobs = [];
    for (const p of (profiles as UserProfile[]) ?? []) {
      const runHour = parseHour(p.daily_run);
      if (runHour === null) continue;
      const { hour, date } = localNow(now, p.timezone_offset_minutes);
      if (hour === runHour) jobs.push({ userId: p.id, today: date });
    }
  }

  console.log(`[daily-summaries] ${jobs.length} users due this hour`);
  if (!jobs.length) {
    return new Response(JSON.stringify({ ok: 0, skipped: 0, error: 0 }), {
      headers: { "content-type": "application/json" },
    });
  }

  // For large cohorts the edge function's ~400 s wall-clock limit may not be
  // enough to process everyone serially. Process up to SAFE_BATCH_LIMIT here
  // and hand the rest to a fresh invocation (fire-and-forget).
  //
  // Max users we can safely process in one invocation:
  //   400 s budget / ~1.5 s per user (Claude RTT + DB) = ~260
  // We use 200 as a conservative safe batch limit.
  const SAFE_BATCH_LIMIT = 200;

  const thisBatch = jobs.slice(0, SAFE_BATCH_LIMIT);
  const overflow  = jobs.slice(SAFE_BATCH_LIMIT);

  if (overflow.length) {
    console.log(`[daily-summaries] overflow: spawning continuation for ${overflow.length} users`);
    const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-daily-summaries`;
    fetch(selfUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ jobs: overflow }),
    }).catch((e) => console.error("[daily-summaries] overflow spawn failed", e));
  }

  const results = await processBatch(thisBatch);

  console.log(`[daily-summaries] done:`, results);
  return new Response(
    JSON.stringify({ users: thisBatch.length, ...results }),
    { headers: { "content-type": "application/json" } }
  );
});
