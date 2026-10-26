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

const STATE_LABEL: Record<keyof StateTotals, string> = {
  upright:      "good alignment",
  forward_lean: "forward lean",
  slouched:     "slouched",
  severe:       "severe slouch",
  tilted_left:  "tilting left",
  tilted_right: "tilting right",
};

// Mirrors CPL_WEIGHTS in src/contexts/IMUContext.tsx — ranks which habit cost the most.
const STATE_COST: Partial<Record<keyof StateTotals, number>> = {
  forward_lean: 0.6, slouched: 1.0, severe: 1.5, tilted_left: 0.7, tilted_right: 0.7,
};

const mins = (ms?: number) => Math.round((ms ?? 0) / 60000);
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

function buildPrompt(rows: PostureRow[], today: string): string {
  const days = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const dayLines = days
    .map((r) => {
      const t = r.state_totals ?? {};
      const total = r.total_desk_ms ?? 0;
      const parts = (Object.keys(STATE_LABEL) as (keyof StateTotals)[])
        .filter((k) => (t[k] ?? 0) > 0)
        .map((k) => `${STATE_LABEL[k]} ${mins(t[k])} min (${pct(t[k] ?? 0, total)}%)`)
        .join(", ");
      const weekday = new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      return `- ${weekday} ${r.date}: tracked ${mins(total)} min, s'up s'core ${r.sup_score ?? 0}. ${parts || "no posture breakdown"}`;
    })
    .join("\n");

  // Week-level totals so the model doesn't have to sum across days itself
  const weekTotals: StateTotals = {};
  let weekMs = 0;
  for (const r of days) {
    weekMs += r.total_desk_ms ?? 0;
    for (const k of Object.keys(STATE_LABEL) as (keyof StateTotals)[]) {
      weekTotals[k] = (weekTotals[k] ?? 0) + (r.state_totals?.[k] ?? 0);
    }
  }
  const weekBreakdown = (Object.keys(STATE_LABEL) as (keyof StateTotals)[])
    .filter((k) => (weekTotals[k] ?? 0) > 0)
    .sort((a, b) => (weekTotals[b] ?? 0) - (weekTotals[a] ?? 0))
    .map((k) => `${STATE_LABEL[k]} ${pct(weekTotals[k] ?? 0, weekMs)}%`)
    .join(", ");

  const drag = (Object.keys(STATE_COST) as (keyof StateTotals)[])
    .map((k) => ({ k, cost: (weekTotals[k] ?? 0) * (STATE_COST[k] ?? 0) }))
    .filter((d) => d.cost > 0)
    .sort((a, b) => b.cost - a.cost)[0];

  // Trend: good-alignment share on the earliest vs most recent tracked day
  const uprightShare = (r: PostureRow) => pct(r.state_totals?.upright ?? 0, r.total_desk_ms ?? 0);
  const first = days[0];
  const last = days[days.length - 1];
  const trendLine = days.length >= 2
    ? `good alignment went from ${uprightShare(first)}% on ${first.date} to ${uprightShare(last)}% on ${last.date}; s'up s'core went from ${first.sup_score ?? 0} to ${last.sup_score ?? 0}`
    : "only one tracked day, no trend yet";

  const byScore = [...days].sort((a, b) => (b.sup_score ?? 0) - (a.sup_score ?? 0));
  const bestWorst = days.length >= 2
    ? `best day ${byScore[0].date} (s'core ${byScore[0].sup_score ?? 0}), weakest day ${byScore[byScore.length - 1].date} (s'core ${byScore[byScore.length - 1].sup_score ?? 0})`
    : "n/a";

  return `
You are s'kipper, the friendly posture coach in the s'up posture tracking app. It is the morning of ${today}. You are writing the user's daily insight, shown on their home screen, based on their last 7 days of desk tracking.

How s'up reads posture (two s'pots: between the shoulder blades and on the lower back):
- good alignment: spine neutral, the goal state.
- forward lean: back straight but hinged toward the screen. fix: move the screen or keyboard closer, or sit back against the chair.
- slouched: upper back rounding. fix: sit tall, imagine a thread pulling the crown of the head up, set a check-in every 20 minutes.
- severe slouch: deep rounding, the worst state for the s'core. fix: change position as soon as it happens, raise the screen to eye level.
- tilting left / right: weight on one side, often from an armrest, a mouse reach or crossed legs. fix: sit evenly on both sit bones, bring the mouse closer, uncross legs.
- the s'up s'core (0 to 100) is based on how each day's tracked time is split across these posture states: more time in good alignment raises it, more time slouched, severe or tilted lowers it. so a change in s'core reflects a change in posture mix, and the percentages below are what drive it.

Last 7 days (oldest first, days with no tracking are missing):
${dayLines}

Week at a glance:
- days tracked: ${days.length} of 7
- total tracked: ${mins(weekMs)} min
- share of tracked time: ${weekBreakdown || "no breakdown"}
- habit costing the most: ${drag ? STATE_LABEL[drag.k] : "none"}
- trend: ${trendLine}
- ${bestWorst}

Respond in EXACTLY this format with no other text:
Answer 1: <the daily insight, 2-3 sentences, in this order: (1) one thing they did well this week, backed by a specific number or a day, (2) the one habit holding them back most, backed by a number, (3) one concrete action for today, taken from the fixes above and tailored to their pattern (for example if tilting dominates, suggest the mouse or armrest fix; if slouching dominates, suggest a specific target like moving their good alignment share up by 10 points today). if the trend is improving, say so; if it is slipping, say so kindly.>
Answer 2: <a factual note for s'kipper to use during today's sessions, 2-3 plain sentences: the week's good alignment percentage and trend direction, the main problem habit with its percentage, typical daily tracking time, and finish with "today's focus:" followed by the single action from answer 1. no style rules apply to this answer, just be precise.>

Style rules for Answer 1:
- lowercase only, except proper nouns and the standalone word "I", which is always capitalized.
- no em dashes, no bullet points, no headers, no emojis.
- talk to the user as "you". warm and encouraging, but honest about what the data shows.
- quote real numbers, rounded naturally. refer to days by weekday or "yesterday" rather than raw dates.
- never make medical claims or mention pain, injury, discs, ligaments or diagnosis.
- no generic filler like "posture is important" or "keep up the good work" without saying what work.
- if there is only one tracked day or very little data (under 15 minutes total), keep it short and focus on encouraging a longer tracked session today.
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
          max_tokens: 500,
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

  const raw = await callClaude(buildPrompt(rows as PostureRow[], today));
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
// The active handler (Deno.serve further down) generates every user's summary
// once a day at 8am Singapore time (DAILY_RUN_HOUR_SGT), dated by the SGT day.
// It is not per-user local time: timezone_offset_minutes is not used for this.

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
    JSON.stringify({ users: thisBatch.length, ...results }),
    { headers: { "content-type": "application/json" } }
  );
});
