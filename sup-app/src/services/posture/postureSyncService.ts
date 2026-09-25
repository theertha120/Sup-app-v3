import { supabase } from "@/src/lib/supabase";
import { DeskPostureState } from "../../components/desk/mockDeskPostureData";

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

function toSgtDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
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

    const affectedDateKeys = new Set(staleSessions.map((row) => toSgtDateKey(row.started_at)));
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
  dateKey: string  // YYYY-MM-DD (SGT)
): Promise<void> {
  try {
    // dateKey is an SGT calendar date (SGT = UTC+8, no DST).
    // The SGT day [00:00, 24:00) maps to this UTC range:
    const startUtc = new Date(`${dateKey}T00:00:00.000Z`);
    startUtc.setUTCHours(startUtc.getUTCHours() - 8);
    const endUtc = new Date(startUtc);
    endUtc.setUTCDate(endUtc.getUTCDate() + 1);

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
      const newStreak = await updateStreakAndActivity(userId);
      const supScore  = computeSupScore(avgShs, totalDeskMs, newStreak);
      await supabase
        .from("posture_daily")
        .update({ sup_score: supScore })
        .eq("user_id", userId)
        .eq("date", dateKey);
      console.log(`[postureSync] sup_score=${supScore} (quality=${Math.round((avgShs ?? 0) / 100 * 50)} showing_up=${computeShowingUpScore(totalDeskMs)} streak=${Math.min(20, newStreak * 3)})`);
    }
  } catch (e) {
    console.warn("[postureSync] rebuildDailyFromSessions threw", e);
  }
}

// ── Sup Score helpers ─────────────────────────────────────────────────────────

function computeShowingUpScore(totalDeskMs: number): number {
  if (totalDeskMs <= 0) return 0;
  const base = 15;
  let duration = 0;
  if      (totalDeskMs >= 120 * 60_000) duration = 15;
  else if (totalDeskMs >=  60 * 60_000) duration = 10;
  else if (totalDeskMs >=  30 * 60_000) duration = 5;
  return base + duration;
}

function computeSupScore(avgShs: number | null, totalDeskMs: number, streak: number): number {
  const quality    = avgShs != null ? (avgShs / 100) * 50 : 0;
  const showingUp  = computeShowingUpScore(totalDeskMs);
  const streakPts  = Math.min(20, streak * 3);
  return Math.round(quality + showingUp + streakPts);
}

function formatLocalDateKey(date: Date): string {
  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day   = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalDateKeys(): { todayLocal: string; yesterdayLocal: string } {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    todayLocal:     formatLocalDateKey(now),
    yesterdayLocal: formatLocalDateKey(yesterday),
  };
}

/**
 * Updates current_streak and last_activity_date in profiles.
 * Returns the new streak value so the caller can compute sup_score.
 *
 * Uses existing profile values — no need to fetch all posture_daily dates:
 *   last_activity == today     → streak unchanged (multiple sessions same day)
 *   last_activity == yesterday → streak + 1 (extending run)
 *   anything older             → streak resets to 1 (gap broke it)
 *
 * Dates are the device's local calendar day, matching how "today" is defined
 * elsewhere in the app (daily.tsx, home.tsx) — not UTC.
 */
async function updateStreakAndActivity(userId: string): Promise<number> {
  try {
    const { todayLocal, yesterdayLocal } = getLocalDateKeys();

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("current_streak, last_activity_date")
      .eq("id", userId)
      .single();

    if (error) { console.warn("[postureSync] updateStreakAndActivity fetch failed", error); return 1; }

    const prev       = profile?.last_activity_date as string | null;
    const prevStreak = Number(profile?.current_streak ?? 0);

    let streak: number;
    if (prev === todayLocal) {
      streak = prevStreak;      // second session today — no change
    } else if (prev === yesterdayLocal) {
      streak = prevStreak + 1;  // consecutive day — extend
    } else {
      streak = 1;               // gap or first ever session
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ current_streak: streak, last_activity_date: todayLocal })
      .eq("id", userId);

    if (profileError) console.warn("[postureSync] updateStreakAndActivity update failed", profileError);
    else console.log(`[postureSync] streak=${streak} last_activity=${todayLocal}`);

    return streak;
  } catch (e) {
    console.warn("[postureSync] updateStreakAndActivity threw", e);
    return 1;
  }
}

/**
 * Call once when a user logs in / the app opens with a session already active.
 * Does NOT increment the streak — logging in isn't "using the S'pots". It only
 * catches a broken streak early: if the user's last real session (last_activity_date)
 * isn't today or yesterday, the gap already broke the streak, so we zero it out
 * immediately instead of leaving the old count displayed until their next session.
 */
export async function checkStreakOnLogin(userId: string): Promise<void> {
  try {
    const { todayLocal, yesterdayLocal } = getLocalDateKeys();

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("current_streak, last_activity_date")
      .eq("id", userId)
      .single();

    if (error) { console.warn("[postureSync] checkStreakOnLogin fetch failed", error); return; }

    const lastActivity = profile?.last_activity_date as string | null;
    const prevStreak    = Number(profile?.current_streak ?? 0);

    const streakIsIntact = lastActivity === todayLocal || lastActivity === yesterdayLocal;
    if (streakIsIntact || prevStreak === 0) return;

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ current_streak: 0 })
      .eq("id", userId);

    if (profileError) console.warn("[postureSync] checkStreakOnLogin reset failed", profileError);
    else console.log(`[postureSync] streak reset to 0 on login (last_activity=${lastActivity ?? "never"})`);
  } catch (e) {
    console.warn("[postureSync] checkStreakOnLogin threw", e);
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
  const prevDate = new Date(targetDate);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const prevDateKey = prevDate.toISOString().slice(0, 10);

  try {
    const { data, error } = await supabase
      .from("posture_daily")
      .select(DAILY_COLUMNS)
      .eq("user_id", userId)
      .in("date", [dateKey, prevDateKey]);

    // console.log("[postureSync] fetchDailyPosturePair query", { userId, dateKey, prevDateKey, data, error });

    if (error) {
      console.warn("[postureSync] fetchDailyPosturePair query failed", error);
      return empty;
    }

    if (!data?.length) return empty;

    const rows = data as unknown as Array<Record<string, unknown> & { date: string }>; //MIGHT BE PROBLEM
    const todayRow = rows.find((r) => r.date === dateKey) ?? null;
    const previousRow = rows.find((r) => r.date === prevDateKey) ?? null;

    return {
      today: mapRowToDailyPostureRow(todayRow),
      previous: mapRowToDailyPostureRow(previousRow),
    };
  } catch (e) {
    console.warn("[postureSync] fetchDailyPosturePair threw", e);
    return empty;
  }
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

// past 7 days
export async function fetchLast7DaysPosture(
  userId: string | null,
  todayKey: string // YYYY-MM-DD
): Promise<DailyPostureRow[]> {
  if (!userId) return [];

  // Build array of last 7 date keys
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${todayKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

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