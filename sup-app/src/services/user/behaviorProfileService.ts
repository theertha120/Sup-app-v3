import { supabase } from "@/src/lib/supabase";
import { CURRENT_USER_ID } from "@/constants/env";

export type BehaviorGoalId =
  | "study_posture"
  | "less_back_discomfort"
  | "desk_posture"
  | "pilates_form_awareness"
  | "general_posture_awareness";

export type ReminderTone =
  | "gentle"
  | "cute"
  | "direct"
  | "funny"
  | "coach_like";

export type ReminderFrequency = "light" | "medium" | "active" | "custom";

export type WeeklyGoalId =
  | "3_resets_per_day"
  | "reduce_slouching_sessions"
  | "awareness_only"
  | "custom";

export type NotificationSensitivity = "low" | "normal" | "high";

export type ActiveTimePreset =
  | "morning"
  | "afternoon"
  | "evening"
  | "late_night"
  | "custom_time_range";

export interface BehaviorProfile {
  primaryGoal: BehaviorGoalId;
  preferredTone: ReminderTone;
  reminderFrequency: ReminderFrequency;
  activeTimeStart: string;
  activeTimeEnd: string;
  weeklyGoal: WeeklyGoalId;
  weeklyGoalCustomText?: string;
  notificationSensitivity: NotificationSensitivity;
}

export interface BehaviorProfileInput {
  primaryGoal: BehaviorGoalId;
  preferredTone: ReminderTone;
  reminderFrequency: ReminderFrequency;
  activeTimeStart: string;
  activeTimeEnd: string;
  weeklyGoal: WeeklyGoalId;
  weeklyGoalCustomText?: string;
}

type BehaviorProfileRow = {
  primary_goal: BehaviorGoalId | null;
  preferred_tone: ReminderTone | null;
  reminder_frequency: ReminderFrequency | null;
  active_time_start: string | null;
  active_time_end: string | null;
  weekly_goal: WeeklyGoalId | null;
  weekly_goal_custom?: string | null;
  notification_sensitivity: NotificationSensitivity | null;
};

// Persistence now uses Supabase table `user_profile`.

export const DEFAULT_BEHAVIOR_PROFILE: BehaviorProfile = {
  primaryGoal: "general_posture_awareness",
  preferredTone: "gentle",
  reminderFrequency: "light",
  activeTimeStart: "09:00",
  activeTimeEnd: "17:00",
  weeklyGoal: "awareness_only",
  notificationSensitivity: "normal",
};

const PRESET_RANGES: Record<
  Exclude<ActiveTimePreset, "custom_time_range">,
  { start: string; end: string }
> = {
  morning: { start: "07:00", end: "11:59" },
  afternoon: { start: "12:00", end: "16:59" },
  evening: { start: "17:00", end: "20:59" },
  late_night: { start: "21:00", end: "01:00" },
};

function getNotificationSensitivity(
  frequency: ReminderFrequency
): NotificationSensitivity {
  if (frequency === "light") return "low";
  if (frequency === "active") return "high";
  return "normal";
}

// storage helper removed

async function getCurrentUserId(): Promise<string> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return CURRENT_USER_ID;
    }

    return user.id;
  } catch {
    return CURRENT_USER_ID;
  }
}

function mapRowToBehaviorProfile(row: BehaviorProfileRow): BehaviorProfile | null {
  if (
    !row.primary_goal ||
    !row.preferred_tone ||
    !row.reminder_frequency ||
    !row.active_time_start ||
    !row.active_time_end ||
    !row.weekly_goal ||
    !row.notification_sensitivity
  ) {
    return null;
  }

  return {
    primaryGoal: row.primary_goal,
    preferredTone: row.preferred_tone,
    reminderFrequency: row.reminder_frequency,
    activeTimeStart: row.active_time_start,
    activeTimeEnd: row.active_time_end,
    weeklyGoal: row.weekly_goal,
    weeklyGoalCustomText: row.weekly_goal_custom ?? undefined,
    notificationSensitivity: row.notification_sensitivity,
  };
}

function toProfileInput(profile: BehaviorProfileInput): BehaviorProfile {
  return {
    ...profile,
    notificationSensitivity: getNotificationSensitivity(profile.reminderFrequency),
  };
}

// Local AsyncStorage fallback removed — writes/reads go to Supabase `user_profile`.

export function getPresetBehaviorHours(
  preset: Exclude<ActiveTimePreset, "custom_time_range">
): { start: string; end: string } {
  return PRESET_RANGES[preset];
}

export function createDefaultBehaviorProfile(): BehaviorProfileInput {
  return {
    primaryGoal: DEFAULT_BEHAVIOR_PROFILE.primaryGoal,
    preferredTone: DEFAULT_BEHAVIOR_PROFILE.preferredTone,
    reminderFrequency: DEFAULT_BEHAVIOR_PROFILE.reminderFrequency,
    activeTimeStart: DEFAULT_BEHAVIOR_PROFILE.activeTimeStart,
    activeTimeEnd: DEFAULT_BEHAVIOR_PROFILE.activeTimeEnd,
    weeklyGoal: DEFAULT_BEHAVIOR_PROFILE.weeklyGoal,
  };
}

export async function fetchCurrentBehaviorProfile(): Promise<BehaviorProfile | null> {
  const userId = await getCurrentUserId();

  try {
    // Use `id` (text) for lookups so we don't conflict with numeric PK `id`.
    const { data, error } = await supabase
      .from("user_profile")
      .select(
        "primary_goal, preferred_tone, reminder_frequency, active_time_start, active_time_end, weekly_goal, weekly_goal_custom, notification_sensitivity"
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      const profile = mapRowToBehaviorProfile(data as BehaviorProfileRow);
      return profile;
    }

    // No row found for this user
    return null;
  } catch (error) {
    console.warn("[behavior-profile] Remote fetch failed", error);
    throw error;
  }
}

export async function saveCurrentBehaviorProfile(
  profileInput: BehaviorProfileInput
): Promise<BehaviorProfile> {
  const userId = await getCurrentUserId();
  const profile = toProfileInput(profileInput);

  const payload = {
    primary_goal: profile.primaryGoal,
    preferred_tone: profile.preferredTone,
    reminder_frequency: profile.reminderFrequency,
    active_time_start: profile.activeTimeStart,
    active_time_end: profile.activeTimeEnd,
    weekly_goal: profile.weeklyGoal,
    weekly_goal_custom:
      profile.weeklyGoal === "custom"
        ? profile.weeklyGoalCustomText?.trim() || null
        : null,
    notification_sensitivity: profile.notificationSensitivity,
  };

  // Upsert into `user_profile` table. Throw on error so callers know if save failed.
  const payloadWithAuthId = { id: userId, ...payload };

  try {
    const { data, error } = await supabase
      .from("user_profile")
      .upsert(payloadWithAuthId, { onConflict: "id" })
      .select(
        "primary_goal, preferred_tone, reminder_frequency, active_time_start, active_time_end, weekly_goal, weekly_goal_custom, notification_sensitivity"
      )
      .maybeSingle();

    if (error) {
      console.warn("[behavior-profile] Remote upsert failed", error);
      throw error;
    }

    if (!data) {
      throw new Error("No data returned from upsert");
    }

    const saved = mapRowToBehaviorProfile(data as BehaviorProfileRow);
    if (!saved) {
      throw new Error("Saved profile row missing required fields");
    }

    return saved;
  } catch (err) {
    console.warn("[behavior-profile] Remote upsert threw", err);
    throw err;
  }
}
