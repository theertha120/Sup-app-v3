import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";

/**
 * POSTURE CHECK-IN SERVICE
 * Saves answers to the "Quick check" notification into public.posture_checkins
 * (see docs/posture-checkin.md for the table's columns and access rules).
 */

/** data.type on the check-in notification, so the tap listener can route it. */
export const POSTURE_CHECKIN_TYPE = "posture_checkin";

/** How often the check-in notification repeats. */
export const POSTURE_CHECKIN_INTERVAL_SECONDS = 10 * 60;

export type PostureCheckinPosture =
  | "upright"
  | "forward_lean"
  | "slouched"
  | "severe"
  | "tilted_left"
  | "tilted_right";

export type BackFeel = 1 | 2 | 3 | 4 | 5;

export interface PostureCheckinInput {
  posture: PostureCheckinPosture;
  backFeel: BackFeel;
  /** ISO time the prompting notification was delivered, if opened from one. */
  notificationSentAt?: string | null;
  source?: "notification" | "in_app";
}

export const POSTURE_LABELS: Record<PostureCheckinPosture, string> = {
  upright: "Upright",
  forward_lean: "Forward lean",
  slouched: "Slouched",
  severe: "Severe",
  tilted_left: "Tilted L",
  tilted_right: "Tilted R",
};

/** A saved check-in, as read back from public.posture_checkins. */
export interface PostureCheckin {
  id: string;
  posture: PostureCheckinPosture;
  back_feel: BackFeel;
  logged_at: string;
  notification_sent_at: string | null;
  source: "notification" | "in_app";
}

const CHECKIN_COLUMNS = "id,posture,back_feel,logged_at,notification_sent_at,source";
const PAGE = 500;

/** Every check-in for the user, newest first (paged so none are dropped at the API row limit). */
export async function fetchPostureCheckins(userId: string): Promise<PostureCheckin[]> {
  const rows: PostureCheckin[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("posture_checkins")
      .select(CHECKIN_COLUMNS)
      .eq("user_id", userId)
      .order("logged_at", { ascending: false })
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as PostureCheckin[]));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function savePostureCheckin(
  input: PostureCheckinInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Sign in to log your posture." };

    const { error } = await supabase.from("posture_checkins").insert({
      user_id: user.id,
      posture: input.posture,
      back_feel: input.backFeel,
      logged_at: new Date().toISOString(), // "Now"
      notification_sent_at: input.notificationSentAt ?? null,
      source: input.source ?? "notification",
    });

    if (error) {
      captureError(error, "posture-checkin-save", { posture: input.posture });
      return { success: false, error: "Couldn't save your check-in. Try again." };
    }
    return { success: true };
  } catch (e) {
    captureError(e, "posture-checkin-save");
    return { success: false, error: "Couldn't save your check-in. Try again." };
  }
}
