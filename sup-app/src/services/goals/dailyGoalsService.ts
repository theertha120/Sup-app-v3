// daily_goals reads/writes, the "has hardware" check used to pick the goal
// set, and the per-day data goals are auto-completed from (see goalRules.ts).
import { supabase } from "@/src/lib/supabase";
import { localDayRange } from "@/src/lib/dateKey";
import type { DailyGoal, GoalOffer } from "@/src/lib/goals/dailyGoals";
import type { CheckIn, CheckInSettings, DeskSession } from "@/src/lib/goals/goalRules";
import type { Workout } from "@/src/features/exercise/model";

const COLUMNS = "id,goal_date,goal_set,section,difficulty,goal_id,goal_text,completed_at,created_at";
const PAGE = 500;

/** True once the user has any posture_sessions row, i.e. has used s'pots. */
export async function hasLoggedPostureSession(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("posture_sessions").select("id").eq("user_id", userId).limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Goals picked for one local day, in the order they were picked. */
export async function fetchGoalsForDay(userId: string, dateKey: string): Promise<DailyGoal[]> {
  const { data, error } = await supabase
    .from("daily_goals").select(COLUMNS)
    .eq("user_id", userId).eq("goal_date", dateKey)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DailyGoal[];
}

export async function pickGoal(userId: string, dateKey: string, offer: GoalOffer): Promise<DailyGoal> {
  const { data, error } = await supabase
    .from("daily_goals")
    .insert({
      user_id: userId,
      goal_date: dateKey,
      goal_set: offer.set,
      section: offer.section,
      difficulty: offer.difficulty,
      goal_id: offer.goalId,
      goal_text: offer.text,
    })
    .select(COLUMNS).single();
  if (error) throw error;
  return data as DailyGoal;
}

/** Un-picks a goal. Completed goals are kept so history can't be lost by accident. */
export async function unpickGoal(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("daily_goals").delete()
    .eq("id", id).eq("user_id", userId).is("completed_at", null);
  if (error) throw error;
}

/** Marks goals the app found complete. Never un-completes, never re-dates. */
export async function markGoalsCompleted(userId: string, ids: string[]): Promise<DailyGoal[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("daily_goals")
    .update({ completed_at: new Date().toISOString() })
    .eq("user_id", userId).in("id", ids).is("completed_at", null)
    .select(COLUMNS);
  if (error) throw error;
  return (data ?? []) as DailyGoal[];
}

/** Every completed goal, newest day first. Pages past the API row limit. */
export async function fetchCompletedGoals(userId: string): Promise<DailyGoal[]> {
  const goals: DailyGoal[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("daily_goals").select(COLUMNS)
      .eq("user_id", userId).not("completed_at", "is", null)
      .order("goal_date", { ascending: false })
      .order("completed_at", { ascending: false })
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    goals.push(...((data ?? []) as DailyGoal[]));
    if ((data?.length ?? 0) < PAGE) return goals;
  }
}

// ── data goals are checked against ─────────────────────────────────────────

/** Reminder frequency and active presets (no row = reminders never fire). */
export async function fetchCheckInSettings(userId: string): Promise<CheckInSettings> {
  const { data, error } = await supabase
    .from("user_profile").select("reminder_frequency, active_time_presets")
    .eq("id", userId).maybeSingle();
  if (error) throw error;
  return {
    frequency: (data?.reminder_frequency as string | undefined) ?? null,
    presets: Array.isArray(data?.active_time_presets) ? (data.active_time_presets as string[]) : [],
  };
}

/** The day's check-ins (reminder_log), minus re-engagement reminders, which aren't check-ins. */
export async function fetchCheckInsForDay(userId: string, dateKey: string): Promise<CheckIn[]> {
  const { start, end } = localDayRange(dateKey);
  const { data, error } = await supabase
    .from("reminder_log").select("sent_at, interaction_at, interaction_action, user_interacted")
    .eq("user_id", userId).neq("reminder_type", "re_engagement")
    .gte("sent_at", start.toISOString()).lt("sent_at", end.toISOString())
    .order("sent_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    sentAt: Date.parse(row.sent_at as string),
    interactedAt: row.user_interacted && row.interaction_at ? Date.parse(row.interaction_at as string) : null,
    action: (row.interaction_action as string | null) ?? null,
  }));
}

/** Finished desk sessions that started on the day (in-progress ones count once ended). */
export async function fetchCompletedSessionsForDay(userId: string, dateKey: string): Promise<DeskSession[]> {
  const { start, end } = localDayRange(dateKey);
  const { data, error } = await supabase
    .from("posture_sessions").select("started_at, ended_at, total_duration_ms, state_totals")
    .eq("user_id", userId).eq("is_completed_session", true)
    .gte("started_at", start.toISOString()).lt("started_at", end.toISOString());
  if (error) throw error;
  return (data ?? []).map((row) => ({
    startedAt: Date.parse(row.started_at as string),
    endedAt: row.ended_at ? Date.parse(row.ended_at as string) : null,
    durationMs: Number(row.total_duration_ms ?? 0),
    stateTotals: (row.state_totals as Record<string, number> | null) ?? null,
  }));
}

/** Workouts dated the day (Exercise lets users log a past date, which won't count). */
export async function fetchWorkoutsForDay(userId: string, dateKey: string): Promise<Workout[]> {
  const { data, error } = await supabase
    .from("exercise_workouts").select("id,user_id,performed_on,back_feeling,exercises,created_at")
    .eq("user_id", userId).eq("performed_on", dateKey);
  if (error) throw error;
  return (data ?? []) as Workout[];
}
