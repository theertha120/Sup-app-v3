import { supabase } from "@/src/lib/supabase";
import type { PosturePageRow } from "../posture/postureSyncService";

export async function fetchStatsWindow(userId: string, start: string, end: string): Promise<PosturePageRow[]> {
  const { data, error } = await supabase.from("posture_daily")
    .select("date, sup_score, total_desk_ms, total_minutes, state_totals")
    .eq("user_id", userId).gte("date", start).lte("date", end)
    .order("date", { ascending: true });
  if (error) throw error;
  // A chart window is at most one calendar year (366 daily rows).
  return (data ?? []).map((row) => ({
    date: row.date, supScore: row.sup_score, totalDeskMs: row.total_desk_ms,
    totalMinutes: row.total_minutes, stateTotals: row.state_totals,
    avgScore: null, goodPostureMinutes: null, badPostureMinutes: null,
    sessionCount: null, interventionCount: null, avgShs: null, minShs: null, maxCpl: null,
  }));
}

export async function fetchEarliestStatsDate(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("posture_daily").select("date")
    .eq("user_id", userId).order("date", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.date ?? null;
}
