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

// OLD: single attempt — a rate limit (429) or overload (529) failed the user for the day
// async function callClaude(prompt: string): Promise<string> {
//   const res = await fetch(ANTHROPIC_URL, {
//     method: "POST",
//     headers: {
//       "content-type": "application/json",
//       "x-api-key": ANTHROPIC_API_KEY,
//       "anthropic-version": "2023-06-01",
//     },
//     body: JSON.stringify({
//       model: "claude-haiku-4-5",
//       max_tokens: 300,
//       messages: [{ role: "user", content: prompt }],
//     }),
//   });
//
//   if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
//   const json = await res.json();
//   return json.content?.[0]?.text ?? "";
// }

// NEW: retries rate-limit / overload / 5xx / network errors with backoff,
// honouring Anthropic's retry-after header when present.
const CLAUDE_MAX_RETRIES = 4;
const CLAUDE_BASE_DELAY_MS = 1000;
const CLAUDE_MAX_DELAY_MS = 20000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, CLAUDE_MAX_DELAY_MS);
  }
  // Exponential backoff with jitter so parallel retries don't line up
  const exp = CLAUDE_BASE_DELAY_MS * 2 ** attempt;
  return Math.min(exp + Math.random() * CLAUDE_BASE_DELAY_MS, CLAUDE_MAX_DELAY_MS);
}

async function callClaude(prompt: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
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
    } catch (e) {
      if (attempt >= CLAUDE_MAX_RETRIES) throw e;
      await sleep(backoffMs(attempt, null));
      continue;
    }

    if (res.ok) {
      const json = await res.json();
      return json.content?.[0]?.text ?? "";
    }

    const errText = await res.text();
    if (!isRetryableStatus(res.status) || attempt >= CLAUDE_MAX_RETRIES) {
      throw new Error(`Claude ${res.status}: ${errText}`);
    }
    await sleep(backoffMs(attempt, res.headers.get("retry-after")));
  }
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

// OLD: per-user scheduled run — matched the cron's SGT hour against each
// user_profile.daily_run. Disabled: the summary now runs at 8am SGT for all users.
// Deno.serve(async (req) => {
//   // Auth check
//   const cronSecret = Deno.env.get("CRON_SECRET");
//   if (cronSecret && req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
//     return new Response("Unauthorized", { status: 401 });
//   }
//
//   // Body: { hour: 8 }  ← SGT hour sent by the cron job
//   // Fallback: derive current SGT hour so manual POSTs still work
//   let sgtHour: number;
//   let today: string;
//   try {
//     const body = await req.json().catch(() => ({}));
//     const sgtNow = new Date(
//       new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })
//     );
//     sgtHour = body?.hour ?? sgtNow.getHours();
//     today   = body?.date ?? sgtNow.toISOString().slice(0, 10); // fallback; todayInSGT() used below too
//     today   = todayInSGT(); // always use SGT date regardless of body
//   } catch {
//     const sgtNow = new Date(
//       new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })
//     );
//     sgtHour = sgtNow.getHours();
//     today   = todayInSGT();
//   }
//
//   // "HH:00" string to match against user_profile.daily_run
//   const targetDailyRun = `${String(sgtHour).padStart(2, "0")}:00`;
//   console.log(`[daily-summaries] hour=${targetDailyRun} date=${today}`);
//
//   // Fetch all user profiles whose daily_run matches this hour
//   const { data: profiles, error: profilesError } = await supabase
//     .from("user_profile")
//     .select("id, daily_run")
//     .eq("daily_run", targetDailyRun);
//
//   if (profilesError) {
//     return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
//   }
//
//   const userIds = (profiles as UserProfile[] ?? []).map((p) => p.id);
//   console.log(`[daily-summaries] ${userIds.length} users scheduled for ${targetDailyRun}`);
//
//   if (!userIds.length) {
//     return new Response(JSON.stringify({ date: today, hour: targetDailyRun, ok: 0, skipped: 0, error: 0 }), {
//       headers: { "content-type": "application/json" },
//     });
//   }
//
//   // For large cohorts (e.g. 1000 users at 08:00) the edge function's
//   // ~400 s wall-clock limit may not be enough to process everyone serially.
//   // Strategy: process in parallel chunks of CHUNK_SIZE, then if there are
//   // still users remaining beyond what we can finish, re-invoke ourselves
//   // for the overflow (fire-and-forget via fetch so we return 200 quickly).
//   //
//   // Max users we can safely process in one invocation:
//   //   400 s budget / ~1.5 s per user (Claude RTT + DB) = ~260
//   // We use 200 as a conservative safe batch limit.
//   const SAFE_BATCH_LIMIT = 200;
//
//   const thisBatch = userIds.slice(0, SAFE_BATCH_LIMIT);
//   const overflow  = userIds.slice(SAFE_BATCH_LIMIT);
//
//   // Kick off overflow invocation before we start processing (fire-and-forget)
//   if (overflow.length) {
//     console.log(`[daily-summaries] overflow: spawning continuation for ${overflow.length} users`);
//     const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-daily-summaries`;
//     // We pass explicit user IDs in the overflow body to skip the profile query
//     fetch(selfUrl, {
//       method: "POST",
//       headers: {
//         "content-type": "application/json",
//         "Authorization": `Bearer ${cronSecret}`,
//       },
//       body: JSON.stringify({ hour: sgtHour, date: today, userIds: overflow }),
//     }).catch((e) => console.error("[daily-summaries] overflow spawn failed", e));
//   }
//
//   // Also support receiving an explicit userIds array (from overflow invocations)
//   let finalUserIds = thisBatch;
//   try {
//     const body = await req.json().catch(() => ({}));
//     if (Array.isArray(body?.userIds)) {
//       // This is an overflow invocation — process exactly these users
//       finalUserIds = (body.userIds as string[]).slice(0, SAFE_BATCH_LIMIT);
//     }
//   } catch { /* ignore */ }
//
//   const results = await processBatch(finalUserIds, today);
//
//   console.log(`[daily-summaries] done:`, results);
//   return new Response(
//     JSON.stringify({ date: today, hour: targetDailyRun, ...results }),
//     { headers: { "content-type": "application/json" } }
//   );
// });

// ─── NEW: Handler — fixed 8am SGT run for all users ──────────────────────────
// Cron may still fire hourly; every hour other than 8 is a no-op. All users are
// processed regardless of user_profile.daily_run. processUser() skips users who
// already have today's row, so retries/manual re-runs are idempotent.

const DAILY_RUN_HOUR_SGT = 8;

// ~200 users per invocation; the remainder is handed to a continuation of this
// function. Each invocation acks immediately and processes in the background
// (EdgeRuntime.waitUntil), so a non-2xx from a hand-off reliably means it was
// not accepted and is safe to retry.
const SAFE_BATCH_LIMIT = 200;
const PROFILE_PAGE_SIZE = 1000; // PostgREST default max rows per request
const HANDOFF_MAX_RETRIES = 3;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/** Pages through user_profile so no users are dropped past the 1000-row API cap. */
async function fetchAllUserIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PROFILE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("user_profile")
      .select("id")
      .order("id", { ascending: true }) // stable ordering across pages
      .range(from, from + PROFILE_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as { id: string }[];
    ids.push(...page.map((p) => p.id));
    if (page.length < PROFILE_PAGE_SIZE) return ids;
  }
}

/** Hands remaining users to a continuation invocation, retrying if it isn't accepted. */
async function spawnContinuation(
  userIds: string[],
  today: string,
  cronSecret: string | undefined
): Promise<void> {
  const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-daily-summaries`;

  for (let attempt = 0; attempt <= HANDOFF_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(selfUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({ hour: DAILY_RUN_HOUR_SGT, date: today, userIds }),
      });
      await res.body?.cancel();
      if (res.ok) return;
      console.error(`[daily-summaries] hand-off attempt ${attempt + 1} got ${res.status}`);
    } catch (e) {
      console.error(`[daily-summaries] hand-off attempt ${attempt + 1} failed`, e);
    }
    if (attempt < HANDOFF_MAX_RETRIES) await sleep(backoffMs(attempt, null));
  }
  console.error(
    `[daily-summaries] hand-off gave up; ${userIds.length} users skipped for today`
  );
}

async function runInvocation(
  userIds: string[],
  today: string,
  cronSecret: string | undefined
): Promise<{ ok: number; skipped: number; error: number }> {
  const thisBatch = userIds.slice(0, SAFE_BATCH_LIMIT);
  const overflow  = userIds.slice(SAFE_BATCH_LIMIT);

  // Hand off overflow first so continuations run in parallel with this batch
  const handoff = overflow.length
    ? (console.log(`[daily-summaries] overflow: spawning continuation for ${overflow.length} users`),
       spawnContinuation(overflow, today, cronSecret))
    : Promise.resolve();

  const results = await processBatch(thisBatch, today);
  await handoff;

  console.log(`[daily-summaries] done:`, results);
  return results;
}

Deno.serve(async (req) => {
  // Auth check
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Read the body once (the old handler read it twice; the second read always
  // failed, so overflow invocations ignored their userIds).
  const body = await req.json().catch(() => ({}));
  const sgtNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })
  );
  const sgtHour: number = body?.hour ?? sgtNow.getHours();
  const today = todayInSGT();
  const targetDailyRun = `${String(DAILY_RUN_HOUR_SGT).padStart(2, "0")}:00`;

  if (sgtHour !== DAILY_RUN_HOUR_SGT) {
    console.log(`[daily-summaries] hour=${sgtHour} is not ${targetDailyRun} SGT, skipping`);
    return new Response(
      JSON.stringify({ date: today, hour: targetDailyRun, ok: 0, skipped: 0, error: 0 }),
      { headers: { "content-type": "application/json" } }
    );
  }

  console.log(`[daily-summaries] hour=${targetDailyRun} date=${today}`);

  let userIds: string[];
  if (Array.isArray(body?.userIds)) {
    // Overflow invocation — process exactly these users
    userIds = body.userIds as string[];
  } else {
    // Fetch all user profiles (no daily_run filter), paginated
    try {
      userIds = await fetchAllUserIds();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
  }

  console.log(`[daily-summaries] ${userIds.length} users scheduled for ${targetDailyRun}`);

  if (!userIds.length) {
    return new Response(JSON.stringify({ date: today, hour: targetDailyRun, ok: 0, skipped: 0, error: 0 }), {
      headers: { "content-type": "application/json" },
    });
  }

  const work = runInvocation(userIds, today, cronSecret);

  // Ack immediately and keep processing in the background, so callers (cron or
  // a parent invocation) never hit the request timeout while Claude calls run.
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(
      work.catch((e) => console.error("[daily-summaries] background run failed", e))
    );
    return new Response(
      JSON.stringify({ date: today, hour: targetDailyRun, accepted: userIds.length }),
      { status: 202, headers: { "content-type": "application/json" } }
    );
  }

  // Fallback (e.g. local runtime without EdgeRuntime): process inline
  const results = await work;
  return new Response(
    JSON.stringify({ date: today, hour: targetDailyRun, ...results }),
    { headers: { "content-type": "application/json" } }
  );
});
