import { supabase } from "@/src/lib/supabase";

export interface SessionRecord {
  id?: string;
  user_id: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  s_train_gained?: number;
  total_s_score?: number;
  insights?: string;
  created_at?: string;
}

export const sessionsService = {
  // Create a new session
  async createSession(userId: string) {
    const { data, error } = await supabase
      .from("sessions")
      .insert({
        user_id: userId,
        started_at: new Date().toISOString(),
      })
      .select();

    if (error) {
      console.error("[sessions] Error creating session:", error);
      throw error;
    }
    return data?.[0];
  },

  // End a session (save all data)
  async endSession(
    sessionId: string,
    durationMs: number,
    sTrainGained: number,
    totalSScore: number,
    insights?: string
  ) {
    const { data, error } = await supabase
      .from("sessions")
      .update({
        ended_at: new Date().toISOString(),
        duration_ms: durationMs,
        s_train_gained: sTrainGained,
        total_s_score: totalSScore,
        insights,
      })
      .eq("id", sessionId)
      .select();

    if (error) {
      console.error("[sessions] Error ending session:", error);
      throw error;
    }
    return data?.[0];
  },

  // Auto-save session progress (called periodically)
  async autoSaveSession(
    sessionId: string,
    durationMs: number,
    sTrainGained: number,
    totalSScore: number
  ) {
    const { data, error } = await supabase
      .from("sessions")
      .update({
        duration_ms: durationMs,
        s_train_gained: sTrainGained,
        total_s_score: totalSScore,
      })
      .eq("id", sessionId)
      .select();

    if (error) {
      console.error("[sessions] Error auto-saving session:", error);
      return null;
    }
    return data?.[0];
  },

  // Get a session by ID
  async getSession(sessionId: string) {
    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error) {
      console.error("[sessions] Error fetching session:", error);
      return null;
    }
    return data;
  },

  // Get today's sessions for a user
  async getTodaySessions(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", userId)
      .gte("started_at", today.toISOString())
      .order("started_at", { ascending: false });

    if (error) {
      console.error("[sessions] Error fetching today's sessions:", error);
      return [];
    }
    return data || [];
  },

  // Get recent sessions for a user
  async getRecentSessions(userId: string, limit: number = 10) {
    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[sessions] Error fetching recent sessions:", error);
      return [];
    }
    return data || [];
  },
};
