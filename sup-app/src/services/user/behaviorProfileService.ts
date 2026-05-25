import { supabase } from "@/src/lib/supabase";

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

export type ReminderFrequency = "light" | "medium" | "active";

export type WeeklyGoalId =
  | "3_resets_per_day"
  | "reduce_slouching_sessions"
  | "awareness_only";

export type ActiveTimePreset =
  | "morning"
  | "afternoon"
  | "evening"
  | "late_night";

export interface BehaviorProfile {
  primaryGoal: BehaviorGoalId;
  preferredTone: ReminderTone;
  reminderFrequency: ReminderFrequency;
  activeTimeStart: string;
  activeTimeEnd: string;
  weeklyGoal: WeeklyGoalId;
}

export interface BehaviorProfileInput {
  primaryGoal: BehaviorGoalId;
  preferredTone: ReminderTone;
  reminderFrequency: ReminderFrequency;
  activeTimeStart: string;
  activeTimeEnd: string;
  weeklyGoal: WeeklyGoalId;
}

type BehaviorProfileRow = {
  primary_goals: BehaviorGoalId | null;
  preferred_tones: ReminderTone | null;
  reminder_frequency: ReminderFrequency | null;
  active_time_start: string | null;
  active_time_end: string | null;
  weekly_goals: WeeklyGoalId | null;
};

// Persistence now uses Supabase table `user_profile`.

export const DEFAULT_BEHAVIOR_PROFILE: BehaviorProfile = {
  primaryGoal: "general_posture_awareness",
  preferredTone: "gentle",
  reminderFrequency: "light",
  activeTimeStart: "09:00",
  activeTimeEnd: "17:00",
  weeklyGoal: "awareness_only",
};

const PRESET_RANGES: Record<
  ActiveTimePreset,
  { start: string; end: string }
> = {
  morning: { start: "07:00", end: "11:59" },
  afternoon: { start: "12:00", end: "16:59" },
  evening: { start: "17:00", end: "20:59" },
  late_night: { start: "21:00", end: "01:00" },
};

async function getCurrentUserId(): Promise<string> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new Error("No authenticated user");
    }

    return user.id;
  } catch {
    throw new Error("No authenticated user");
  }
}

function mapRowToBehaviorProfile(row: BehaviorProfileRow): BehaviorProfile | null {
  if (
    !row.primary_goals ||
    !row.preferred_tones ||
    !row.reminder_frequency ||
    !row.active_time_start ||
    !row.active_time_end ||
    !row.weekly_goals 
  ) {
    return null;
  }

  return {
    primaryGoal: row.primary_goals,
    preferredTone: row.preferred_tones,
    reminderFrequency: row.reminder_frequency,
    activeTimeStart: row.active_time_start,
    activeTimeEnd: row.active_time_end,
    weeklyGoal: row.weekly_goals,
  };
}

function toProfileInput(profile: BehaviorProfileInput): BehaviorProfile {
  return {
    ...profile,
  };
}

export function getPresetBehaviorHours(
  preset: ActiveTimePreset
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
        "primary_goals, preferred_tones, reminder_frequency, active_time_start, active_time_end, weekly_goals"
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
    primary_goals: profile.primaryGoal,
    preferred_tones: profile.preferredTone,
    reminder_frequency: profile.reminderFrequency,
    active_time_start: profile.activeTimeStart,
    active_time_end: profile.activeTimeEnd,
    weekly_goals: profile.weeklyGoal,
  };

  // Upsert into `user_profile` table. Throw on error so callers know if save failed.
  const payloadWithAuthId = { id: userId, ...payload };

  try {
    const { data, error } = await supabase
      .from("user_profile")
      .upsert(payloadWithAuthId, { onConflict: "id" })
      .select(
        "primary_goals, preferred_tones, reminder_frequency, active_time_start, active_time_end, weekly_goals"
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
