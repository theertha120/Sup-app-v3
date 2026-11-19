import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { localDayRange, toLocalDateKey } from "@/src/lib/dateKey";
import { fetchAllPostureRows } from "@/src/services/posture/postureSyncService";
import { loadCheckins, loadWorkouts } from "@/src/services/exercise/exerciseLogCache";
import {
  emptyDay, levelFor, summarizeXp, xpForDay,
  type DayActivity, type DayXp, type LevelProgress, type XpSummary,
} from "./xpRules";

/**
 * XP SERVICE — XP replaces the s'up s'core (docs/xp.md).
 *
 * Where XP is stored (supabase/migrations/202611190001_xp.sql):
 *   posture_daily.xp / xp_breakdown  — XP earned that phone-local day
 *   profiles.xp_total / xp_level     — lifetime XP and the level it gives
 *
 * Where it comes from (worked out from data the app already saves):
 *   s'it session time → posture_daily.total_desk_ms (completed sessions)
 *   posture check-ins → posture_checkins.logged_at (phone-local day)
 *   manual exercise   → exercise_workouts.performed_on
 *
 * When it's written:
 *   syncDayXp(user, day) — after a session ends, a check-in is logged, or a
 *     workout is saved / edited / deleted (both dates on an edit).
 *   syncAllXp(user)      — at login: backfills history and fixes any day whose
 *     stored XP is out of date (e.g. a write that failed while offline).
 *
 * To add s'quat / s'tep or daily goals later: read their rows in
 * buildDailyActivity / dayActivity and fill sessionMs.squat / sessionMs.step /
 * goalsCompleted. The rules in xpRules.ts already score them.
 */

// ─── Building activity ──────────────────────────────────────────────────────

/** Groups the raw rows into one DayActivity per phone-local day. */
export function buildDailyActivity(input: {
  daily: { date: string; totalDeskMs: number | null }[];
  workouts: { performed_on: string }[];
  checkins: { logged_at: string }[];
}): DayActivity[] {
  const days = new Map<string, DayActivity>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) { d = emptyDay(date); days.set(date, d); }
    return d;
  };
  for (const row of input.daily) {
    if (row.totalDeskMs) day(row.date).sessionMs.sit = (day(row.date).sessionMs.sit ?? 0) + row.totalDeskMs;
  }
  for (const w of input.workouts) day(w.performed_on).exerciseLogs++;
  for (const c of input.checkins) {
    const logged = new Date(c.logged_at);
    if (!Number.isNaN(logged.getTime())) day(toLocalDateKey(logged)).postureCheckins++;
  }
  return [...days.values()];
}

/**
 * One day's activity, read straight from Supabase (used after a single change),
 * plus the XP currently stored for that day so the caller can tell if it changed.
 */
async function dayActivity(userId: string, date: string): Promise<{ activity: DayActivity; storedXp: number }> {
  const { start, end } = localDayRange(date);
  const [daily, checkins, workouts] = await Promise.all([
    supabase.from("posture_daily").select("total_desk_ms, xp").eq("user_id", userId).eq("date", date).maybeSingle(),
    supabase.from("posture_checkins").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("logged_at", start.toISOString()).lt("logged_at", end.toISOString()),
    supabase.from("exercise_workouts").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("performed_on", date),
  ]);
  const error = daily.error ?? checkins.error ?? workouts.error;
  if (error) throw error;
  const row = daily.data as { total_desk_ms?: number; xp?: number } | null;
  const activity = emptyDay(date);
  const sitMs = Number(row?.total_desk_ms) || 0;
  if (sitMs) activity.sessionMs.sit = sitMs;
  activity.postureCheckins = checkins.count ?? 0;
  activity.exerciseLogs = workouts.count ?? 0;
  return { activity, storedXp: Number(row?.xp) || 0 };
}

// ─── Saving ─────────────────────────────────────────────────────────────────

const ZERO_STATE_TOTALS = {
  upright: 0, transition: 0, forward_lean: 0, slouched: 0, severe: 0, tilted_left: 0, tilted_right: 0,
};

/**
 * Saves a day's XP onto its posture_daily row. Updates only the XP columns of
 * an existing row (never its posture data). A day with XP but no row yet
 * (check-ins / workouts only, no session) gets a new row with zeroed posture
 * columns. A day with no XP and no row is left alone.
 */
async function saveDayXp(userId: string, day: DayXp): Promise<void> {
  const xpColumns = { xp: day.total, xp_breakdown: day.breakdown };
  const update = () => supabase.from("posture_daily").update(xpColumns)
    .eq("user_id", userId).eq("date", day.date).select("date");

  const updated = await update();
  if (updated.error) throw updated.error;
  if (updated.data?.length || day.total === 0) return;

  const inserted = await supabase.from("posture_daily").insert({
    user_id: userId, date: day.date, ...xpColumns,
    state_totals: ZERO_STATE_TOTALS, total_desk_ms: 0, avg_score: 0,
    good_posture_minutes: 0, bad_posture_minutes: 0, total_minutes: 0,
    session_count: 0, intervention_count: 0,
  });
  if (!inserted.error) return;
  // A session rebuild created the row in the meantime: just set the XP on it.
  if ((inserted.error as { code?: string }).code === "23505") {
    const retry = await update();
    if (retry.error) throw retry.error;
    return;
  }
  throw inserted.error;
}

/** Sum of every day's stored XP for the user. */
async function storedTotalXp(userId: string): Promise<number> {
  let total = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("posture_daily").select("xp")
      .eq("user_id", userId).range(offset, offset + 999);
    if (error) throw error;
    for (const row of data ?? []) total += Number((row as { xp?: number }).xp) || 0;
    if (!data || data.length < 1000) return total;
  }
}

/** Saves the profile's total and level if they differ; true when it wrote something. */
async function saveProfileXp(userId: string, totalXp: number): Promise<boolean> {
  const progress = levelFor(totalXp);
  const current = await supabase.from("profiles").select("xp_total, xp_level").eq("id", userId).maybeSingle();
  if (current.error) throw current.error;
  const row = current.data as { xp_total?: number; xp_level?: number } | null;
  if (Number(row?.xp_total) === progress.totalXp && Number(row?.xp_level) === progress.level) return false;
  const { error } = await supabase.from("profiles")
    .update({ xp_total: progress.totalXp, xp_level: progress.level }).eq("id", userId);
  if (error) throw error;
  return true;
}

// ─── Change notifications ───────────────────────────────────────────────────
// Screens that show XP (Stats via posture history, the level in the profile
// dropdown/modal, the leaderboard) subscribe here and reload when a sync
// actually changed a day's XP or the profile total — not on every sync.

type XpChangeListener = (userId: string) => void;
const listeners = new Set<XpChangeListener>();

/** Calls `listener(userId)` whenever an XP sync changed stored XP. Returns an unsubscribe function. */
export function subscribeToXpChanges(listener: XpChangeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyXpChanged(userId: string) {
  for (const listener of [...listeners]) {
    try { listener(userId); } catch (error) { captureError(error, "xp-change-listener"); }
  }
}

// One sync at a time, so two quick changes can't race each other's writes.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Recalculates one day's XP, saves it, and updates the profile's total and
 * level. Call after anything that can change that day's XP. Never throws:
 * failures go to Sentry and are fixed by the next login's syncAllXp.
 */
export function syncDayXp(userId: string, date: string = toLocalDateKey()): Promise<DayXp | null> {
  return serial(async () => {
    try {
      const { activity, storedXp } = await dayActivity(userId, date);
      const day = xpForDay(activity);
      const dayChanged = day.total !== storedXp;
      if (dayChanged) await saveDayXp(userId, day);
      const profileChanged = await saveProfileXp(userId, await storedTotalXp(userId));
      if (dayChanged || profileChanged) notifyXpChanged(userId);
      return day;
    } catch (error) {
      captureError(error, "xp-sync-day", { date });
      return null;
    }
  });
}

/**
 * Recalculates XP for every day from the saved data, writes any day whose
 * stored XP differs, and sets the profile's total and level. Run at login.
 */
export function syncAllXp(userId: string, today: string = toLocalDateKey()): Promise<XpSummary | null> {
  return serial(async () => {
    try {
      const [daily, workouts, checkins] = await Promise.all([
        fetchAllPostureRows(userId), loadWorkouts(userId), loadCheckins(userId),
      ]);
      const activity = buildDailyActivity({ daily, workouts, checkins });
      const computed = new Map(activity.map((a) => [a.date, xpForDay(a)]));
      const stored = new Map(daily.map((row) => [row.date, row.xp ?? 0]));
      let daysChanged = false;
      for (const date of new Set([...computed.keys(), ...stored.keys()])) {
        const day = computed.get(date) ?? xpForDay(emptyDay(date));
        if (day.total !== (stored.get(date) ?? 0)) { await saveDayXp(userId, day); daysChanged = true; }
      }
      const summary = summarizeXp(activity, today);
      const profileChanged = await saveProfileXp(userId, summary.totalXp);
      if (daysChanged || profileChanged) notifyXpChanged(userId);
      return summary;
    } catch (error) {
      captureError(error, "xp-sync-all");
      return null;
    }
  });
}

/** Lifetime XP and level from the profile (e.g. "Level 3 - 21/500" via formatLevel). */
export async function fetchLevelProgress(userId: string): Promise<LevelProgress> {
  const { data, error } = await supabase.from("profiles").select("xp_total").eq("id", userId).maybeSingle();
  if (error) throw error;
  return levelFor(Number((data as { xp_total?: number } | null)?.xp_total) || 0);
}

/** XP worked out from the saved data without writing anything (total, level, today). */
export async function fetchXpSummary(userId: string, today: string = toLocalDateKey()): Promise<XpSummary> {
  const [daily, workouts, checkins] = await Promise.all([
    fetchAllPostureRows(userId),
    loadWorkouts(userId),
    loadCheckins(userId),
  ]);
  return summarizeXp(buildDailyActivity({ daily, workouts, checkins }), today);
}
