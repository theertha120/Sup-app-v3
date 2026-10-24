import { supabase } from "@/src/lib/supabase";

// Reads/writes s'kipper's daily insight rows (daily_ai_summary, one per user per day).
// Rows are normally written by the generate-daily-summaries Edge Function.

// Insert or replace the summary for one user and date.
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

// The summary for exactly one date, or null if none was generated.
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

// Newest summary among the given dates (e.g. today, falling back to yesterday) in one query.
export async function fetchLatestDailyAiSummary(
  userId: string,
  dates: string[]     // YYYY-MM-DD
): Promise<{ insight: string } | null> {
  const { data, error } = await supabase
    .from("daily_ai_summary")
    .select("insight")
    .eq("user_id", userId)
    .in("date", dates)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
