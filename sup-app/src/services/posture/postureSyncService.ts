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
      .select("id, started_at")
      .eq("user_id", userId)
      .is("ended_at", null)
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
          lastDaily?.updated_at && lastDaily.updated_at > row.started_at
            ? lastDaily.updated_at
            : row.started_at;
        return supabase.from("posture_sessions").update({ ended_at: fallback }).eq("id", row.id);
      })
    );
  } catch (e) {
    console.warn("[postureSync] closeStaleSessions failed", e);
  }
}

export async function startSession(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    await closeStaleSessions(userId);

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
 * Rebuild posture_daily for a given date by aggregating all completed
 * posture_sessions for that day. Call this after a session ends (with a
 * short delay so endSession has time to write to the DB first).
 */
export async function rebuildDailyFromSessions(
  userId: string,
  dateKey: string  // YYYY-MM-DD (UTC)
): Promise<void> {
  try {
    const nextDay = new Date(dateKey);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextDayKey = nextDay.toISOString().slice(0, 10);

    const { data: sessions, error } = await supabase
      .from("posture_sessions")
      .select("total_duration_ms, state_totals, avg_shs, min_shs, max_cpl")
      .eq("user_id", userId)
      .gte("started_at", `${dateKey}T00:00:00.000Z`)
      .lt("started_at",  `${nextDayKey}T00:00:00.000Z`)
      .not("ended_at", "is", null);

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
      await updateWeeklyAvgPoints(userId);
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

/**
 * Updates current_streak and last_activity_date in profiles.
 * Returns the new streak value so the caller can compute sup_score.
 *
 * Uses existing profile values — no need to fetch all posture_daily dates:
 *   last_activity == today     → streak unchanged (multiple sessions same day)
 *   last_activity == yesterday → streak + 1 (extending run)
 *   anything older             → streak resets to 1 (gap broke it)
 */
async function updateStreakAndActivity(userId: string): Promise<number> {
  try {
    const todayUTC     = new Date().toISOString().slice(0, 10);
    const yesterdayUTC = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("current_streak, last_activity_date")
      .eq("id", userId)
      .single();

    if (error) { console.warn("[postureSync] updateStreakAndActivity fetch failed", error); return 1; }

    const prev       = profile?.last_activity_date as string | null;
    const prevStreak = Number(profile?.current_streak ?? 0);

    let streak: number;
    if (prev === todayUTC) {
      streak = prevStreak;      // second session today — no change
    } else if (prev === yesterdayUTC) {
      streak = prevStreak + 1;  // consecutive day — extend
    } else {
      streak = 1;               // gap or first ever session
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ current_streak: streak, last_activity_date: todayUTC })
      .eq("id", userId);

    if (profileError) console.warn("[postureSync] updateStreakAndActivity update failed", profileError);
    else console.log(`[postureSync] streak=${streak} last_activity=${todayUTC}`);

    return streak;
  } catch (e) {
    console.warn("[postureSync] updateStreakAndActivity threw", e);
    return 1;
  }
}

/**
 * Averages sup_score from the last 7 days of posture_daily for this user
 * and writes the result to profiles.weekly_avg_points.
 * Called after sup_score is written for today's session.
 */
async function updateWeeklyAvgPoints(userId: string): Promise<void> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const { data: rows, error } = await supabase
      .from("posture_daily")
      .select("sup_score")
      .eq("user_id", userId)
      .gte("date", sevenDaysAgo);

    if (error) { console.warn("[postureSync] updateWeeklyAvgPoints fetch failed", error); return; }
    if (!rows?.length) return;

    const scored = rows.filter((r) => r.sup_score != null);
    if (!scored.length) return;

    const avg = scored.reduce((sum, r) => sum + Number(r.sup_score), 0) / scored.length;
    const weeklyAvgPoints = Math.round(avg);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ weekly_avg_points: weeklyAvgPoints })
      .eq("id", userId);

    if (updateError) console.warn("[postureSync] updateWeeklyAvgPoints update failed", updateError);
    else console.log(`[postureSync] weekly_avg_points=${weeklyAvgPoints} (from ${scored.length} days)`);
  } catch (e) {
    console.warn("[postureSync] updateWeeklyAvgPoints threw", e);
  }
}

