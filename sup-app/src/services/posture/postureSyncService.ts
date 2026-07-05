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
        state_totals: aggregates.stateTotals ?? null,
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
      state_totals: stateTotals,
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
    const { data: sessions, error } = await supabase
      .from("posture_sessions")
      .select("total_duration_ms, state_totals, avg_shs, min_shs")
      .eq("user_id", userId)
      .gte("started_at", `${dateKey}T00:00:00.000Z`)
      .lt("started_at",  `${dateKey}T23:59:59.999Z`)
      .not("ended_at", "is", null);

    if (error) { console.warn("[postureSync] rebuildDailyFromSessions query failed", error); return; }
    if (!sessions?.length) return;

    // Aggregate across all sessions
    const stateTotals: StateTotals = {};
    let totalDeskMs  = 0;
    let shsSum       = 0;
    let shsCount     = 0;
    let minShs       = 100;

    for (const s of sessions) {
      totalDeskMs += s.total_duration_ms ?? 0;
      if (s.avg_shs != null) { shsSum += s.avg_shs; shsCount++; }
      if (s.min_shs != null && s.min_shs < minShs) minShs = s.min_shs;
      if (s.state_totals) {
        for (const [k, v] of Object.entries(s.state_totals as StateTotals)) {
          const key = k as DeskPostureState;
          stateTotals[key] = (stateTotals[key] ?? 0) + (v ?? 0);
        }
      }
    }

    const avgShs  = shsCount > 0 ? shsSum / shsCount : null;
    const goodMs  = stateTotals.upright ?? 0;
    const badMs   = Math.max(0, totalDeskMs - goodMs);
    const avgScore = totalDeskMs > 0 ? Math.round((goodMs / totalDeskMs) * 100) : 0;

    // Preserve session_count and intervention_count (don't overwrite with DB aggregate)
    const { data: existing } = await supabase
      .from("posture_daily")
      .select("session_count, intervention_count")
      .eq("user_id", userId)
      .eq("date", dateKey)
      .maybeSingle();

    const { error: upsertError } = await supabase.from("posture_daily").upsert({
      user_id:              userId,
      date:                 dateKey,
      state_totals:         stateTotals,
      total_desk_ms:        Math.round(totalDeskMs),
      avg_score:            avgScore,
      avg_shs:              avgShs != null ? Math.round(avgShs) : null,
      min_shs:              minShs < 100 ? Math.round(minShs) : null,
      good_posture_minutes: Math.round(goodMs / 60_000),
      bad_posture_minutes:  Math.round(badMs / 60_000),
      total_minutes:        Math.round(totalDeskMs / 60_000),
      session_count:        existing?.session_count ?? sessions.length,
      intervention_count:   existing?.intervention_count ?? null,
      updated_at:           new Date().toISOString(),
    }, { onConflict: "user_id,date" });

    if (upsertError) console.warn("[postureSync] rebuildDailyFromSessions upsert failed", upsertError);
    else console.log(`[postureSync] daily rebuilt from ${sessions.length} sessions — totalDeskMs=${Math.round(totalDeskMs)}`);
  } catch (e) {
    console.warn("[postureSync] rebuildDailyFromSessions threw", e);
  }
}