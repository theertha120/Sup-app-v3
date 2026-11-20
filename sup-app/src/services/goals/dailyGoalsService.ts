// daily_goals reads/writes, plus the "has hardware" check used to pick the goal set.
import { supabase } from "@/src/lib/supabase";
import type { DailyGoal, GoalOffer } from "@/src/lib/goals/dailyGoals";

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

export async function setGoalCompleted(userId: string, id: string, completed: boolean): Promise<DailyGoal> {
  const { data, error } = await supabase
    .from("daily_goals")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id).eq("user_id", userId)
    .select(COLUMNS).single();
  if (error) throw error;
  return data as DailyGoal;
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
