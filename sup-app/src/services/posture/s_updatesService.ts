import { supabase } from "@/src/lib/supabase";

export interface SUpdate {
  id?: string;
  user_id: string;
  text: string;
  color: "green" | "yellow" | "red";
  session_id?: string;
  created_at?: string;
}

export const sUpdatesService = {
  // Save a new s'update
  async saveSUpdate(userId: string, text: string, color: "green" | "yellow" | "red", sessionId?: string) {
    const { data, error } = await supabase.from("s_updates").insert({
      user_id: userId,
      text,
      color,
      session_id: sessionId,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[s_updates] Error saving s'update:", error);
      throw error;
    }
    return data;
  },

  // Get all s'updates for today for a user
  async getTodaySUpdates(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("s_updates")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[s_updates] Error fetching today's s'updates:", error);
      return [];
    }
    return data || [];
  },

  // Get recent s'updates (last N)
  async getRecentSUpdates(userId: string, limit: number = 10) {
    const { data, error } = await supabase
      .from("s_updates")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[s_updates] Error fetching recent s'updates:", error);
      return [];
    }
    return data || [];
  },

  // Get s'updates for a specific session
  async getSessionSUpdates(sessionId: string) {
    const { data, error } = await supabase
      .from("s_updates")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[s_updates] Error fetching session s'updates:", error);
      return [];
    }
    return data || [];
  },
};
