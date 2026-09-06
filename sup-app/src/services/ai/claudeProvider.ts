import { supabase } from "@/src/lib/supabase";
import { AIProvider, InsightColor, SessionInsightData, SessionInsightResult, SessionSummaryData, SessionSummaryResult } from "./aiProvider";

// Prompt-building and the actual Claude call live server-side, in
// supabase/functions/session-coach — an EXPO_PUBLIC_* env var gets compiled
// straight into the shipped app bundle, so a billed Anthropic key can never
// live here. supabase.functions.invoke() attaches the current user's session
// automatically; the edge function is deployed with JWT verification on, so
// only authenticated app users can call it.
//
// Restored 2026-09: a merge (c507749, Aug 19) had accidentally reverted this
// file to calling api.anthropic.com directly with
// process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY — a var that is never set in any
// EAS environment (confirmed via `eas env:list`), so every call 401'd. Do NOT
// reintroduce a client-side ANTHROPIC_API_KEY read here.

async function invokeCoach<TResult>(
  kind: "insight" | "summary",
  data: SessionInsightData | SessionSummaryData
): Promise<TResult> {
  const { data: result, error } = await supabase.functions.invoke("session-coach", {
    body: { kind, data },
  });
  if (error) throw error;
  return result as TResult;
}

function normaliseResult(result: { color?: string; message?: string }): { color: InsightColor; message: string } {
  const validColors: InsightColor[] = ["green", "yellow", "red"];
  const color: InsightColor = validColors.includes(result.color as InsightColor) ? (result.color as InsightColor) : "yellow";
  return { color, message: result.message ?? "" };
}

export const claudeProvider: AIProvider = {
  async getSessionInsight(data: SessionInsightData): Promise<SessionInsightResult> {
    const result = await invokeCoach<{ color?: string; message?: string }>("insight", data);
    return normaliseResult(result);
  },

  async getSessionSummary(data: SessionSummaryData): Promise<SessionSummaryResult> {
    const result = await invokeCoach<{ color?: string; message?: string }>("summary", data);
    return normaliseResult(result);
  },
};
