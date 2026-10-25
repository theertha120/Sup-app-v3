import { supabase } from "@/src/lib/supabase";
import { DeskPostureState } from "../../components/desk/mockDeskPostureData";
import { toLocalDateKey, addDaysToDateKey, localDayRange } from "@/src/lib/dateKey";

export type StateTotals = Partial<Record<DeskPostureState, number>>;

export interface SessionAggregates {
  avgShs?: number | null;
  minShs?: number | null;
  maxCpl?: number | null;
  avgInstantScore?: number | null;
  totalDurationMs: number;
  stateTotals?: StateTotals;
}

export interface DailyRollupExtras {
  sessionCountDelta?: number;
  interventionCountDelta?: number;
}

export interface DailyPostureRow {
  avgScore: number | null;
  goodPostureMinutes: number | null;
  badPostureMinutes: number | null;
  totalMinutes: number | null;
  totalDeskMs: number | null;
  sessionCount: number | null;
  interventionCount: number | null;
  avgShs: number | null;
  minShs: number | null;
  maxCpl: number | null;
  supScore: number | null;
  stateTotals: StateTotals | null;
}

export interface DailyPosturePair {
  today: DailyPostureRow | null;
  previous: DailyPostureRow | null;
}

export interface PosturePageRow extends DailyPostureRow {
  date: string; // YYYY-MM-DD
}

const STALE_SESSION_MS = 30 * 60 * 1000;

const ALL_STATES: DeskPostureState[] = [
  "upright", "transition", "forward_lean", "slouched", "severe", "tilted_left", "tilted_right",
];

function fillStateTotals(totals: StateTotals): Record<DeskPostureState, number> {
  const filled = {} as Record<DeskPostureState, number>;
  for (const state of ALL_STATES) filled[state] = totals[state] ?? 0;
  return filled;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}


async function closeStaleSessions(userId: string): Promise<void> {
  try {
    const cutoff = toIso(Date.now() - STALE_SESSION_MS);
    const { data: staleSessions, error } = await supabase
      .from("posture_sessions")
      .select("id, started_at, ended_at")
      .eq("user_id", userId)
      .eq("is_completed_session", false)
      .lt("started_at", cutoff);

    if (error || !staleSessions?.length) return;

    const { data: lastDaily } = await supabase
      .from("posture_daily")
      .select("updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await Promise.all(
      staleSessions.map((row) => {
        const fallback =
          row.ended_at ??
          (lastDaily?.updated_at && lastDaily.updated_at > row.started_at
            ? lastDaily.updated_at
            : row.started_at);
        return supabase
          .from("posture_sessions")
          .update({ ended_at: fallback, is_completed_session: true })
          .eq("id", row.id);
      })
    );

    const affectedDateKeys = new Set(staleSessions.map((row) => toLocalDateKey(new Date(row.started_at))));
    await Promise.all(
      [...affectedDateKeys].map((dateKey) => rebuildDailyFromSessions(userId, dateKey))
    );
  } catch (e) {
    console.warn("[postureSync] closeStaleSessions failed", e);
  }
}

export async function startSession(userId: string | null): Promise<string | null> {
  if (!userId) {
    console.warn("[postureSync] startSession skipped — no userId (not logged in, or auth not resolved yet)");
    return null;
  }
  try {
    closeStaleSessions(userId).catch((e) => console.warn("[postureSync] closeStaleSessions rejected", e));

    const { data, error } = await supabase
      .from("posture_sessions")
      .insert({ user_id: userId, started_at: new Date().toISOString() })
      .select("id")
      .single();

    if (error || !data) {
      console.warn("[postureSync] startSession failed", error);
      return null;
    }

    return data.id as string;
  } catch (e) {
    console.warn("[postureSync] startSession threw", e);
    return null;
  }
}

export async function endSession(
  sessionId: string | null,
  aggregates: SessionAggregates
): Promise<void> {
  if (!sessionId) return;
  try {
    const { error } = await supabase
      .from("posture_sessions")
      .update({
        ended_at: new Date().toISOString(),
        is_completed_session: true,
        avg_shs: aggregates.avgShs ?? null,
        min_shs: aggregates.minShs ?? null,
        max_cpl: aggregates.maxCpl ?? null,
        avg_instant_score: aggregates.avgInstantScore ?? null,
        total_duration_ms: Math.round(aggregates.totalDurationMs),
        state_totals: aggregates.stateTotals ? fillStateTotals(aggregates.stateTotals) : null,
      })
      .eq("id", sessionId);

    if (error) console.warn("[postureSync] endSession failed", error);
  } catch (e) {
    console.warn("[postureSync] endSession threw", e);
  }
}


export async function snapshotSession(
  sessionId: string | null,
  aggregates: SessionAggregates
): Promise<void> {
  if (!sessionId) return;
  try {
    const { error } = await supabase
      .from("posture_sessions")
      .update({
        ended_at: new Date().toISOString(),
        is_completed_session: false,
        avg_shs: aggregates.avgShs ?? null,
        min_shs: aggregates.minShs ?? null,
        max_cpl: aggregates.maxCpl ?? null,
        avg_instant_score: aggregates.avgInstantScore ?? null,
        total_duration_ms: Math.round(aggregates.totalDurationMs),
        state_totals: aggregates.stateTotals ? fillStateTotals(aggregates.stateTotals) : null,
      })
      .eq("id", sessionId);

    if (error) console.warn("[postureSync] snapshotSession failed", error);
  } catch (e) {
    console.warn("[postureSync] snapshotSession threw", e);
  }
}

export interface PreviousSessionSnapshot {
  startedAt: string;
  totalDurationMs: number;
  stateTotals: StateTotals;
}

/**
 * The user's most recent completed session that started before `beforeMs`
 * (the current session's start), for the end-of-session comparison. Sessions
 * under a minute are skipped as too short to compare against.
 */
export async function fetchPreviousSession(
  userId: string | null,
  beforeMs: number
): Promise<PreviousSessionSnapshot | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from("posture_sessions")
      .select("started_at, total_duration_ms, state_totals")
      .eq("user_id", userId)
      .eq("is_completed_session", true)
      .lt("started_at", toIso(beforeMs))
      .gte("total_duration_ms", 60_000)
      .not("state_totals", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) { console.warn("[postureSync] fetchPreviousSession failed", error); return null; }
    if (!data || !isStateTotals(data.state_totals)) return null;

    return {
      startedAt: data.started_at as string,
      totalDurationMs: Number(data.total_duration_ms ?? 0),
      stateTotals: data.state_totals,
    };
  } catch (e) {
    console.warn("[postureSync] fetchPreviousSession threw", e);
    return null;
  }
}

export async function upsertDailyRollup(
  userId: string | null,
  dateKey: string,
  stateTotals: StateTotals,
  extras: DailyRollupExtras = {}
): Promise<void> {
  if (!userId) return;

  try {
    const totalDeskMs = Object.values(stateTotals).reduce((sum, v) => sum + (v ?? 0), 0);
    const goodMs = stateTotals.upright ?? 0;
    const badMs = Math.max(0, totalDeskMs - goodMs);
    const avgScore = totalDeskMs > 0 ? (goodMs / totalDeskMs) * 100 : 0;

    let sessionCount: number | undefined;
    let interventionCount: number | undefined;

    if (extras.sessionCountDelta !== undefined || extras.interventionCountDelta !== undefined) {
      const { data: existing } = await supabase
        .from("posture_daily")
        .select("session_count, intervention_count")
        .eq("user_id", userId)
        .eq("date", dateKey)
        .maybeSingle();

      sessionCount = Number(existing?.session_count ?? 0) + (extras.sessionCountDelta ?? 0);
      interventionCount =
        Number(existing?.intervention_count ?? 0) + (extras.interventionCountDelta ?? 0);
    }

    const payload: Record<string, unknown> = {
      user_id: userId,
      date: dateKey,
      state_totals: fillStateTotals(stateTotals),
      total_desk_ms: Math.round(totalDeskMs),
      updated_at: new Date().toISOString(),
      avg_score: Math.round(avgScore),
      good_posture_minutes: Math.round(goodMs / 60_000),
      bad_posture_minutes: Math.round(badMs / 60_000),
      total_minutes: Math.round(totalDeskMs / 60_000),
    };

    if (sessionCount !== undefined) payload.session_count = sessionCount;
    if (interventionCount !== undefined) payload.intervention_count = interventionCount;

    const { error } = await supabase.from("posture_daily").upsert(payload, {
      onConflict: "user_id,date",
    });

    if (error) console.warn("[postureSync] upsertDailyRollup failed", error);
  } catch (e) {
    console.warn("[postureSync] upsertDailyRollup threw", e);
  }
}

/**
 * Rebuild posture_daily for a given date by aggregating every
 * is_completed_session posture_sessions row for that day — set only by a
 * deliberate endSession() or a closeStaleSessions() recovery, never by the
 * periodic snapshotSession() (see its own comment) — so a still-active or
 * not-yet-recovered session's in-progress numbers never get folded in as if
 * finished. Call this after a session ends (with a short delay so endSession
 * has time to write to the DB first).
 */
export async function rebuildDailyFromSessions(
  userId: string,
  dateKey: string  // YYYY-MM-DD (phone's local day)
): Promise<void> {
  try {
    // dateKey is a calendar day in the phone's timezone; select the sessions
    // that started between that day's local midnight and the next one.
    const { start: startUtc, end: endUtc } = localDayRange(dateKey);

    const { data: sessions, error } = await supabase
      .from("posture_sessions")
      .select("total_duration_ms, state_totals, avg_shs, min_shs, max_cpl")
      .eq("user_id", userId)
      .gte("started_at", startUtc.toISOString())
      .lt("started_at",  endUtc.toISOString())
      .eq("is_completed_session", true);

    if (error) { console.warn("[postureSync] rebuildDailyFromSessions query failed", error); return; }
    if (!sessions?.length) return;

    // Aggregate across all sessions
    const stateTotals: StateTotals = {};
    let totalDeskMs  = 0;
    let shsWeightedSum = 0;  // sum of (avg_shs × duration_ms) for weighted average
    let shsDurationMs  = 0;  // total duration of sessions that have avg_shs
    let minShs         = 100;
    let maxCpl: number | null = null;

    for (const s of sessions) {
      const dur = s.total_duration_ms ?? 0;
      totalDeskMs += dur;
      if (s.avg_shs != null) { shsWeightedSum += s.avg_shs * dur; shsDurationMs += dur; }
      if (s.min_shs != null && s.min_shs < minShs) minShs = s.min_shs;
      if (s.max_cpl != null && (maxCpl === null || s.max_cpl > maxCpl)) maxCpl = s.max_cpl;
      if (s.state_totals) {
        for (const [k, v] of Object.entries(s.state_totals as StateTotals)) {
          const key = k as DeskPostureState;
          stateTotals[key] = (stateTotals[key] ?? 0) + (v ?? 0);
        }
      }
    }

    const avgShs = shsDurationMs > 0 ? shsWeightedSum / shsDurationMs : null;
    const goodMs  = stateTotals.upright ?? 0;
    const badMs   = Math.max(0, totalDeskMs - goodMs);
    const avgScore = totalDeskMs > 0 ? Math.round((goodMs / totalDeskMs) * 100) : 0;

    // Preserve intervention_count if a row already exists (never overwrite with null)
    const { data: existing } = await supabase
      .from("posture_daily")
      .select("intervention_count")
      .eq("user_id", userId)
      .eq("date", dateKey)
      .maybeSingle();

    const { error: upsertError } = await supabase.from("posture_daily").upsert({
      user_id:              userId,
      date:                 dateKey,
      state_totals:         fillStateTotals(stateTotals),
      total_desk_ms:        Math.round(totalDeskMs),
      avg_score:            avgScore,
      avg_shs:              avgShs,
      min_shs:              minShs < 100 ? minShs : null,
      max_cpl:              maxCpl,
      good_posture_minutes: Math.round(goodMs / 60_000),
      bad_posture_minutes:  Math.round(badMs / 60_000),
      total_minutes:        Math.round(totalDeskMs / 60_000),
      session_count:        sessions.length,
      intervention_count:   existing?.intervention_count ?? 0,
      updated_at:           new Date().toISOString(),
    }, { onConflict: "user_id,date" });

    if (upsertError) {
      console.warn("[postureSync] rebuildDailyFromSessions upsert failed", upsertError);
    } else {
      console.log(`[postureSync] daily rebuilt from ${sessions.length} sessions — totalDeskMs=${Math.round(totalDeskMs)}`);
      // Score comes from the day's per-state time only (docs/score-methodology.md §2);
      // streak and avg_shs are no longer inputs.
      const supScore = computeSupScore(stateTotals);
      await supabase
        .from("posture_daily")
        .update({ sup_score: supScore })
        .eq("user_id", userId)
        .eq("date", dateKey);
      console.log(`[postureSync] sup_score=${supScore}`);
    }
  } catch (e) {
    console.warn("[postureSync] rebuildDailyFromSessions threw", e);
  }
}

// ── Sup Score helpers ─────────────────────────────────────────────────────────

// Credit (0–100) earned per tracked minute in each posture state.
const POSTURE_CREDIT: Record<DeskPostureState, number> = {
  upright:      100,
  transition:    75,
  forward_lean:  50,
  tilted_left:   50,
  tilted_right:  50,
  slouched:      25,
  severe:         0,
};

// Every day starts as if it already had SUP_SCORE_PRIOR_MS of average
// (SUP_SCORE_PRIOR_SCORE) posture tracked. Short sessions therefore stay near
// 50 instead of swinging to 0 or 100, and the score settles onto the user's
// real posture as tracked time grows (half-weight at 10 min, ~86% at 1 hour).
const SUP_SCORE_PRIOR_SCORE = 50;
const SUP_SCORE_PRIOR_MS    = 10 * 60_000;

/**
 * Daily s'up s'core, 0–100: time-weighted posture credit across the day's
 * tracked time, blended with a 10-minute prior of 50. Null if nothing was
 * tracked (a day off has no score rather than a free 50).
 */
function computeSupScore(stateTotals: StateTotals): number | null {
  const score = unroundedSupScore(stateTotals);
  return score === null ? null : Math.round(score);
}

function unroundedSupScore(stateTotals: StateTotals): number | null {
  let trackedMs = 0;
  let creditMs  = 0;
  for (const state of ALL_STATES) {
    const ms = stateTotals[state] ?? 0;
    trackedMs += ms;
    creditMs  += ms * POSTURE_CREDIT[state];
  }
  if (trackedMs <= 0) return null;
  return (creditMs + SUP_SCORE_PRIOR_SCORE * SUP_SCORE_PRIOR_MS) / (trackedMs + SUP_SCORE_PRIOR_MS);
}

/**
 * s'up s'core for a multi-day period (unrounded): the daily formula applied to
 * the period's summed per-state time, so the prior counts once per period and
 * each day weighs by its tracked time. Rows without state_totals are skipped.
 */
export function supScoreForRows(rows: Pick<DailyPostureRow, "stateTotals">[]): number | null {
  const summed: StateTotals = {};
  for (const row of rows) {
    if (!row.stateTotals) continue;
    for (const state of ALL_STATES) {
      summed[state] = (summed[state] ?? 0) + (row.stateTotals[state] ?? 0);
    }
  }
  return unroundedSupScore(summed);
}

function getLocalDateKeys(): { todayLocal: string; yesterdayLocal: string } {
  const todayLocal = toLocalDateKey();
  return { todayLocal, yesterdayLocal: addDaysToDateKey(todayLocal, -1) };
}

/**
 * Updates current_streak and last_activity_date in profiles. Call when a user logs
 * in, the app cold-starts with a session, or the app returns to the foreground —
 * opening the app is what counts as a streak day:
 *   last_activity == today     → streak unchanged (already opened today)
 *   last_activity == yesterday → streak + 1 (extending run)
 *   anything older             → streak resets to 1 (gap broke it)
 * Idempotent within a day, so repeated opens are safe.
 *
 * Dates are the device's local calendar day, matching how "today" is defined
 * elsewhere in the app (daily.tsx, home.tsx) — not UTC.
 */
export async function checkStreakOnAppOpen(userId: string): Promise<void> {
  try {
    const { todayLocal, yesterdayLocal } = getLocalDateKeys();

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("current_streak, last_activity_date")
      .eq("id", userId)
      .single();

    if (error) { console.warn("[postureSync] checkStreakOnAppOpen fetch failed", error); return; }

    const prev       = profile?.last_activity_date as string | null;
    const prevStreak = Number(profile?.current_streak ?? 0);

    if (prev === todayLocal) return; // already opened today — no change

    const streak = prev === yesterdayLocal ? prevStreak + 1 : 1;

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ current_streak: streak, last_activity_date: todayLocal })
      .eq("id", userId);

    if (profileError) console.warn("[postureSync] checkStreakOnAppOpen update failed", profileError);
    else console.log(`[postureSync] streak=${streak} last_activity=${todayLocal}`);
  } catch (e) {
    console.warn("[postureSync] checkStreakOnAppOpen threw", e);
  }
}

const DAILY_COLUMNS = [
  "date",
  "avg_score",
  "good_posture_minutes",
  "bad_posture_minutes",
  "total_minutes",
  "total_desk_ms",
  "session_count",
  "intervention_count",
  "avg_shs",
  "min_shs",
  "max_cpl",
  "sup_score",
  "state_totals",
].join(", ");

function mapRowToDailyPostureRow(row: Record<string, unknown> | null): DailyPostureRow | null {
  if (!row) return null;

  return {
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
    goodPostureMinutes: row.good_posture_minutes != null ? Number(row.good_posture_minutes) : null,
    badPostureMinutes: row.bad_posture_minutes != null ? Number(row.bad_posture_minutes) : null,
    totalMinutes: row.total_minutes != null ? Number(row.total_minutes) : null,
    totalDeskMs: row.total_desk_ms != null ? Number(row.total_desk_ms) : null,
    sessionCount: row.session_count != null ? Number(row.session_count) : null,
    interventionCount: row.intervention_count != null ? Number(row.intervention_count) : null,
    avgShs: row.avg_shs != null ? Number(row.avg_shs) : null,
    minShs: row.min_shs != null ? Number(row.min_shs) : null,
    maxCpl: row.max_cpl != null ? Number(row.max_cpl) : null,
    supScore: row.sup_score != null ? Number(row.sup_score) : null,
    stateTotals: isStateTotals(row.state_totals) ? row.state_totals : null,
  };
}

function isStateTotals(value: unknown): value is StateTotals {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as object).every((v) => v == null || typeof v === "number")
  );
}

/**
 * Fetches posture_daily rows for a given date and the day before it.
 * Returns { today, previous } — either can be null if no row exists yet.
 * Throws on a failed query, so the caller keeps what it already shows instead
 * of treating an outage as an empty day.
 *
 * @param userId  Auth user ID
 * @param dateKey Target date in YYYY-MM-DD format (e.g. "2026-07-07")
 */
export async function fetchDailyPosturePair(
  userId: string | null,
  dateKey: string  // YYYY-MM-DD
): Promise<DailyPosturePair> {
  const empty: DailyPosturePair = { today: null, previous: null };

  if (!userId) {
    console.warn("[postureSync] fetchDailyPosturePair: no userId");
    return empty;
  }

  // Derive the previous day
  const targetDate = new Date(`${dateKey}T00:00:00.000Z`);
  if (isNaN(targetDate.getTime())) {
    console.warn("[postureSync] fetchDailyPosturePair: invalid dateKey", dateKey);
    return empty;
  }
  const prevDateKey = addDaysToDateKey(dateKey, -1);

  const { data, error } = await supabase
    .from("posture_daily")
    .select(DAILY_COLUMNS)
    .eq("user_id", userId)
    .in("date", [dateKey, prevDateKey]);

  // console.log("[postureSync] fetchDailyPosturePair query", { userId, dateKey, prevDateKey, data, error });

  if (error) {
    console.warn("[postureSync] fetchDailyPosturePair query failed", error);
    throw error;
  }

  if (!data?.length) return empty;

  const rows = data as unknown as Array<Record<string, unknown> & { date: string }>; //MIGHT BE PROBLEM
  const todayRow = rows.find((r) => r.date === dateKey) ?? null;
  const previousRow = rows.find((r) => r.date === prevDateKey) ?? null;

  return {
    today: mapRowToDailyPostureRow(todayRow),
    previous: mapRowToDailyPostureRow(previousRow),
  };
}

/**
 * Fetches all posture_daily rows for a user between startDateKey and
 * endDateKey (inclusive). Mirrors fetchDailyPosturePair's shape/error
 * handling, but returns a range instead of a single day + previous day.
 */
export async function fetchPosturePageRows(
  userId: string | null,
  startDateKey: string, // YYYY-MM-DD
  endDateKey: string    // YYYY-MM-DD
): Promise<PosturePageRow[]> {
  if (!userId) {
    console.warn("[postureSync] fetchPosturePageRows: no userId");
    return [];
  }

  if (isNaN(new Date(`${startDateKey}T00:00:00.000Z`).getTime()) ||
      isNaN(new Date(`${endDateKey}T00:00:00.000Z`).getTime())) {
    console.warn("[postureSync] fetchPosturePageRows: invalid date range", { startDateKey, endDateKey });
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("posture_daily")
      .select(DAILY_COLUMNS)
      .eq("user_id", userId)
      .gte("date", startDateKey)
      .lte("date", endDateKey)
      .order("date", { ascending: true });

    if (error) {
      console.warn("[postureSync] fetchPosturePageRows query failed", error);
      return [];
    }

    if (!data?.length) return [];

    const rows = data as unknown as Array<Record<string, unknown> & { date: string }>;
    return rows.map((r) => {
      const mapped = mapRowToDailyPostureRow(r);
      return mapped ? { date: r.date, ...mapped } : null;
    }).filter(Boolean) as PosturePageRow[];
  } catch (e) {
    console.warn("[postureSync] fetchPosturePageRows threw", e);
    return [];
  }
}

// Batched sibling of fetchPosturePageRows: one round-trip for many users over
// the same window. The leaderboard needs every ranked user's rows for the same
// date range, and querying per user meant N requests for an N-person board.
// Returns a map keyed by user id; users with no rows in the window are absent.
export async function fetchPosturePageRowsForUsers(
  userIds: string[],
  startDateKey: string, // YYYY-MM-DD
  endDateKey: string    // YYYY-MM-DD
): Promise<Map<string, PosturePageRow[]>> {
  const byUser = new Map<string, PosturePageRow[]>();

  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return byUser;

  if (isNaN(new Date(`${startDateKey}T00:00:00.000Z`).getTime()) ||
      isNaN(new Date(`${endDateKey}T00:00:00.000Z`).getTime())) {
    console.warn("[postureSync] fetchPosturePageRowsForUsers: invalid date range", { startDateKey, endDateKey });
    return byUser;
  }

  // `.in()` travels in the query string, so chunk to keep the URL bounded.
  const CHUNK_SIZE = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const { data, error } = await supabase
          .from("posture_daily")
          .select(`user_id, ${DAILY_COLUMNS}`)
          .in("user_id", chunk)
          .gte("date", startDateKey)
          .lte("date", endDateKey)
          .order("date", { ascending: true });

        if (error) {
          console.warn("[postureSync] fetchPosturePageRowsForUsers query failed", error);
          return;
        }
        if (!data?.length) return;

        const rows = data as unknown as Array<
          Record<string, unknown> & { date: string; user_id: string }
        >;
        for (const row of rows) {
          const mapped = mapRowToDailyPostureRow(row);
          if (!mapped) continue;
          const entry: PosturePageRow = { date: row.date, ...mapped };
          const existing = byUser.get(row.user_id);
          if (existing) existing.push(entry);
          else byUser.set(row.user_id, [entry]);
        }
      } catch (e) {
        console.warn("[postureSync] fetchPosturePageRowsForUsers threw", e);
      }
    })
  );

  return byUser;
}

// Every posture_daily row a user has, oldest first, in as few round-trips as
// possible. The stats screen derives all of its week/month/year pages from one
// contiguous history, so fetching per page (which it used to do, serially) meant
// dozens of requests for a user with a few months of data.
// Throws on any failed page: a partial history would silently chart as missing
// days, so the caller keeps its previous snapshot and shows an error instead.
export async function fetchAllPostureRows(
  userId: string | null
): Promise<PosturePageRow[]> {
  if (!userId) return [];

  // PostgREST caps rows per response, so page through until short-read.
  const PAGE_SIZE = 1000;
  const all: PosturePageRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("posture_daily")
      .select(DAILY_COLUMNS)
      .eq("user_id", userId)
      .order("date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.warn("[postureSync] fetchAllPostureRows query failed", error);
      throw error;
    }
    if (!data?.length) break;

    const rows = data as unknown as Array<Record<string, unknown> & { date: string }>;
    for (const row of rows) {
      const mapped = mapRowToDailyPostureRow(row);
      if (mapped) all.push({ date: row.date, ...mapped });
    }

    if (rows.length < PAGE_SIZE) break; // last page
  }

  return all;
}

// past 7 days
export async function fetchLast7DaysPosture(
  userId: string | null,
  todayKey: string // YYYY-MM-DD
): Promise<DailyPostureRow[]> {
  if (!userId) return [];

  // Build array of last 7 date keys
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) dates.push(addDaysToDateKey(todayKey, -i));

  const { data, error } = await supabase
    .from("posture_daily")
    .select(DAILY_COLUMNS)
    .eq("user_id", userId)
    .in("date", dates)
    .order("date", { ascending: false });

  if (error || !data?.length) return [];
  return (data as unknown as Array<Record<string, unknown> & { date: string }>)
    .map(mapRowToDailyPostureRow)
    .filter(Boolean) as DailyPostureRow[];
}