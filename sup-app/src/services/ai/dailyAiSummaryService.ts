import { supabase } from "@/src/lib/supabase";

export async function upsertDailyAiSummary(
  userId: string,
  date: string,       // YYYY-MM-DD
  concisedSummary: string,
  insight: string
): Promise<void> {
  const { error } = await supabase
    .from("daily_ai_summary")
    .upsert(
      { user_id: userId, date, concisedSummary, insight },
      { onConflict: "user_id,date" }  // safe to re-run
    );

  if (error) throw error;
}

export async function fetchDailyAiSummary(
  userId: string,
  date: string
): Promise<{ insight: string; concised_summary: string } | null> {
  const { data, error } = await supabase
    .from("daily_ai_summary")
    .select("insight, concised_summary")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  if (error) throw error;
  return data;
}