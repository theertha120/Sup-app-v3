import { createClient } from "@supabase/supabase-js";

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
  daily_run: string; // "HH:00" format e.g. "08:00"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Current date in SGT (UTC+8) as YYYY-MM-DD */
function todayInSGT(): string {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })
  )
    .toISOString()
    .slice(0, 10);
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
Answer 1: <A 2-3 sentence personalised insight based on trends across the 7 days. Warm, motivating tone. No bullet points. No em dashes.>
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
        date: today,                  // SGT date
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
  userIds: string[],
  today: string
): Promise<{ ok: number; skipped: number; error: number }> {
  const results = { ok: 0, skipped: 0, error: 0 };

  for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + CHUNK_SIZE);

    const chunkResults = await Promise.allSettled(
      chunk.map((uid) => processUser(uid, today))
    );

    for (const r of chunkResults) {
      if (r.status === "fulfilled") results[r.value]++;
      else results.error++;
    }

    // Don't delay after the last chunk
    if (i + CHUNK_SIZE < userIds.length) {
      await new Promise((resolve) => setTimeout(resolve, INTER_CHUNK_DELAY_MS));
    }
  }

  return results;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Auth check
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Body: { hour: 8 }  ← SGT hour sent by the cron job
  // Fallback: derive current SGT hour so manual POSTs still work
  let sgtHour: number;
  let today: string;
  try {
    const body = await req.json().catch(() => ({}));
    const sgtNow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })
    );
    sgtHour = body?.hour ?? sgtNow.getHours();
    today   = body?.date ?? sgtNow.toISOString().slice(0, 10); // fallback; todayInSGT() used below too
    today   = todayInSGT(); // always use SGT date regardless of body
  } catch {
    const sgtNow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })
    );
    sgtHour = sgtNow.getHours();
    today   = todayInSGT();
  }

  // "HH:00" string to match against user_profile.daily_run
  const targetDailyRun = `${String(sgtHour).padStart(2, "0")}:00`;
  console.log(`[daily-summaries] hour=${targetDailyRun} date=${today}`);

  // Fetch all user profiles whose daily_run matches this hour
  const { data: profiles, error: profilesError } = await supabase
    .from("user_profile")
    .select("id, daily_run")
    .eq("daily_run", targetDailyRun);

  if (profilesError) {
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
  }

  const userIds = (profiles as UserProfile[] ?? []).map((p) => p.id);
  console.log(`[daily-summaries] ${userIds.length} users scheduled for ${targetDailyRun}`);

  if (!userIds.length) {
    return new Response(JSON.stringify({ date: today, hour: targetDailyRun, ok: 0, skipped: 0, error: 0 }), {
      headers: { "content-type": "application/json" },
    });
  }

  // For large cohorts (e.g. 1000 users at 08:00) the edge function's
  // ~400 s wall-clock limit may not be enough to process everyone serially.
  // Strategy: process in parallel chunks of CHUNK_SIZE, then if there are
  // still users remaining beyond what we can finish, re-invoke ourselves
  // for the overflow (fire-and-forget via fetch so we return 200 quickly).
  //
  // Max users we can safely process in one invocation:
  //   400 s budget / ~1.5 s per user (Claude RTT + DB) = ~260
  // We use 200 as a conservative safe batch limit.
  const SAFE_BATCH_LIMIT = 200;

  const thisBatch = userIds.slice(0, SAFE_BATCH_LIMIT);
  const overflow  = userIds.slice(SAFE_BATCH_LIMIT);

  // Kick off overflow invocation before we start processing (fire-and-forget)
  if (overflow.length) {
    console.log(`[daily-summaries] overflow: spawning continuation for ${overflow.length} users`);
    const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-daily-summaries`;
    // We pass explicit user IDs in the overflow body to skip the profile query
    fetch(selfUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ hour: sgtHour, date: today, userIds: overflow }),
    }).catch((e) => console.error("[daily-summaries] overflow spawn failed", e));
  }

  // Also support receiving an explicit userIds array (from overflow invocations)
  let finalUserIds = thisBatch;
  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.userIds)) {
      // This is an overflow invocation — process exactly these users
      finalUserIds = (body.userIds as string[]).slice(0, SAFE_BATCH_LIMIT);
    }
  } catch { /* ignore */ }

  const results = await processBatch(finalUserIds, today);

  console.log(`[daily-summaries] done:`, results);
  return new Response(
    JSON.stringify({ date: today, hour: targetDailyRun, ...results }),
    { headers: { "content-type": "application/json" } }
  );
});