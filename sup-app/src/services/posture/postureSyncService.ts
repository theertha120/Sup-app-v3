/**
 * postureSyncService.ts
 *
 * Writes posture/session data to Supabase in batches — never per BLE packet.
 * Called from IMUContext.tsx (sessions, state-transition events, interventions)
 * and useSessionStats.ts (daily rollup upsert).
 *
 * All functions no-op when userId is null (guest / signed-out), matching the
 * guest-guard pattern used in behaviorProfileService.ts.
 */

import { supabase } from "@/src/lib/supabase";
import { DeskPostureState } from "../../components/desk/mockDeskPostureData";
import type { PostureSeverity } from "../../lib/imuParser";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StateTotals = Partial<Record<DeskPostureState, number>>; // ms per state — same shape as StateTimeMap

export interface StateEventInput {
  sessionId: string;
  userId: string;
  state: DeskPostureState;
  severity: PostureSeverity;
  enteredAt: number; // ms epoch
  exitedAt: number;  // ms epoch
  durationMs: number;
  avgPitchDiff?: number | null;
  avgRollDiff?: number | null;
}

export interface InterventionInput {
  sessionId: string;
  userId: string;
  state: DeskPostureState;
  firedAt: number; // ms epoch
  cplAtAlert?: number | null;
}

export interface SessionAggregates {
  avgShs?: number | null;
  minShs?: number | null;
  maxCpl?: number | null;
  avgInstantScore?: number | null;
  totalDurationMs: number;
}

export interface DailyRollupExtras {
  sessionCount?: number;
  interventionCount?: number;
  avgScore?: number | null;
}

const STALE_SESSION_MS = 30 * 60 * 1000;

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

// ── Sessions ──────────────────────────────────────────────────────────────────

/**
 * Closes any of this user's posture_sessions rows left open (ended_at null)
 * for more than STALE_SESSION_MS — an app kill can leave one dangling.
 * Best-effort close time is the last known posture_daily.updated_at for the
 * user (a proxy for "last time the app was alive"), falling back to started_at.
 */
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

/** Inserts a new posture_sessions row and returns its id, or null (guest / on failure). */
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

/** Sets ended_at + final aggregates on a posture_sessions row. No-op if sessionId is null. */
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
      })
      .eq("id", sessionId);
    if (error) console.warn("[postureSync] endSession failed", error);
  } catch (e) {
    console.warn("[postureSync] endSession threw", e);
  }
}

// ── State transition events ──────────────────────────────────────────────────

/** Batched insert of completed posture-state segments. Returns true on success. */
export async function flushStateEvents(events: StateEventInput[]): Promise<boolean> {
  if (events.length === 0) return true;
  try {
    const rows = events.map((e) => ({
      session_id: e.sessionId,
      user_id: e.userId,
      state: e.state,
      severity: e.severity,
      entered_at: toIso(e.enteredAt),
      exited_at: toIso(e.exitedAt),
      duration_ms: Math.round(e.durationMs),
      avg_pitch_diff: e.avgPitchDiff ?? null,
      avg_roll_diff: e.avgRollDiff ?? null,
    }));
    const { error } = await supabase.from("posture_state_events").insert(rows);
    if (error) {
      console.warn("[postureSync] flushStateEvents failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[postureSync] flushStateEvents threw", e);
    return false;
  }
}

// ── Interventions ─────────────────────────────────────────────────────────────

/** Inserts a fired intervention immediately (low-volume, no batching needed). */
export async function recordIntervention(input: InterventionInput): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("posture_interventions")
      .insert({
        session_id: input.sessionId,
        user_id: input.userId,
        state: input.state,
        fired_at: toIso(input.firedAt),
        cpl_at_alert: input.cplAtAlert ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.warn("[postureSync] recordIntervention failed", error);
      return null;
    }
    return data.id as string;
  } catch (e) {
    console.warn("[postureSync] recordIntervention threw", e);
    return null;
  }
}

export async function markInterventionDismissed(
  interventionId: string | null,
  dismissedAt: number,
  userMoved: boolean
): Promise<void> {
  if (!interventionId) return;
  try {
    const { error } = await supabase
      .from("posture_interventions")
      .update({ dismissed_at: toIso(dismissedAt), user_moved: userMoved })
      .eq("id", interventionId);
    if (error) console.warn("[postureSync] markInterventionDismissed failed", error);
  } catch (e) {
    console.warn("[postureSync] markInterventionDismissed threw", e);
  }
}

// ── Daily rollup ──────────────────────────────────────────────────────────────

/**
 * Upserts today's posture_daily row. `stateTotals` is the same StateTimeMap
 * shape useSessionStats.ts already computes — total_desk_ms is derived from it.
 *
 * posture_daily predates this service (minutes-based columns, NOT NULL):
 * good_posture_minutes / bad_posture_minutes / total_minutes / avg_score.
 * We derive those from stateTotals the same way stats.tsx's todayStatsDisplay
 * already does (good = time in "upright", bad = everything else) so both the
 * legacy columns and the new state_totals breakdown stay consistent.
 *
 * `extras.sessionCount`/`extras.interventionCount` are only written when
 * provided, so omitting them leaves those columns untouched on conflict
 * rather than zeroing them.
 */
export async function upsertDailyRollup(
  userId: string | null,
  dateKey: string, // YYYY-MM-DD
  stateTotals: StateTotals,
  extras: DailyRollupExtras = {}
): Promise<void> {
  if (!userId) return;
  try {
    const totalDeskMs = Object.values(stateTotals).reduce((sum, v) => sum + (v ?? 0), 0);
    const goodMs = stateTotals.upright ?? 0;
    const badMs = Math.max(0, totalDeskMs - goodMs);
    const avgScore = totalDeskMs > 0 ? (goodMs / totalDeskMs) * 100 : 0;

    const payload: Record<string, unknown> = {
      user_id: userId,
      date: dateKey,
      state_totals: stateTotals,
      total_desk_ms: Math.round(totalDeskMs),
      updated_at: new Date().toISOString(),
      avg_score: extras.avgScore ?? Math.round(avgScore),
      good_posture_minutes: Math.round(goodMs / 60_000),
      bad_posture_minutes: Math.round(badMs / 60_000),
      total_minutes: Math.round(totalDeskMs / 60_000),
    };
    if (extras.sessionCount !== undefined) payload.session_count = extras.sessionCount;
    if (extras.interventionCount !== undefined) payload.intervention_count = extras.interventionCount;

    const { error } = await supabase
      .from("posture_daily")
      .upsert(payload, { onConflict: "user_id,date" });
    if (error) console.warn("[postureSync] upsertDailyRollup failed", error);
  } catch (e) {
    console.warn("[postureSync] upsertDailyRollup threw", e);
  }
}
