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
  primaryGoals: BehaviorGoalId[];
  preferredTones: ReminderTone[];
  reminderFrequency: ReminderFrequency;
  activeTimePresets: ActiveTimePreset[]; // replaces activeTimeStart/End
  activeTimeStart: string;
  activeTimeEnd: string;
  weeklyGoals: WeeklyGoalId[];
}

export interface BehaviorProfileInput {
  primaryGoals: BehaviorGoalId[];
  preferredTones: ReminderTone[];
  reminderFrequency: ReminderFrequency;
  activeTimePresets: ActiveTimePreset[];
  activeTimeStart: string;
  activeTimeEnd: string;
  weeklyGoals: WeeklyGoalId[];
}

type BehaviorProfileRow = {
  primary_goals: BehaviorGoalId[] | null;
  preferred_tones: ReminderTone[] | null;
  reminder_frequency: ReminderFrequency | null;
  active_time_start: string | null;
  active_time_end: string | null;
  active_time_presets: ActiveTimePreset[] | null;
  weekly_goals: WeeklyGoalId[] | null;
};

// Persistence now uses Supabase table `user_profile`.

export const DEFAULT_BEHAVIOR_PROFILE: BehaviorProfile = {
  primaryGoals: ["general_posture_awareness"],
  preferredTones: ["gentle"],
  reminderFrequency: "light",
  activeTimePresets: ["afternoon"],
  activeTimeStart: "12:00",
  activeTimeEnd: "16:59",
  weeklyGoals: ["awareness_only"],
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

const PRESET_ORDER: ActiveTimePreset[] = [
  "morning",
  "afternoon",
  "evening",
  "late_night",
];

async function getCurrentUserId(): Promise<string> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return "guest";
    }

    return user.id;
  } catch {
    return "guest";
  }
}

function mapRowToBehaviorProfile(row: BehaviorProfileRow): BehaviorProfile | null {
  if (
    !row.primary_goals?.length ||
    !row.preferred_tones?.length ||
    !row.reminder_frequency ||
    !row.active_time_start ||
    !row.active_time_end ||
    !row.weekly_goals?.length
  ) {
    return null;
  }

  const activeTimePresets: ActiveTimePreset[] =
    row.active_time_presets?.length ? row.active_time_presets : ["afternoon"];

  return {
    primaryGoals: row.primary_goals,
    preferredTones: row.preferred_tones,
    reminderFrequency: row.reminder_frequency,
    activeTimePresets,
    activeTimeStart: row.active_time_start,
    activeTimeEnd: row.active_time_end,
    weeklyGoals: row.weekly_goals,
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

export function resolveTimeRangeFromPresets(presets: ActiveTimePreset[]): {
  start: string;
  end: string;
} {
  if (presets.length === 0) return { start: "09:00", end: "17:00" };
  const sorted = [...presets].sort(
    (a, b) => PRESET_ORDER.indexOf(a) - PRESET_ORDER.indexOf(b)
  );
  return {
    start: PRESET_RANGES[sorted[0]].start,
    end: PRESET_RANGES[sorted[sorted.length - 1]].end,
  };
}

export function createDefaultBehaviorProfile(): BehaviorProfileInput {
  return {
    primaryGoals: DEFAULT_BEHAVIOR_PROFILE.primaryGoals,
    preferredTones: DEFAULT_BEHAVIOR_PROFILE.preferredTones,
    reminderFrequency: DEFAULT_BEHAVIOR_PROFILE.reminderFrequency,
    activeTimePresets: DEFAULT_BEHAVIOR_PROFILE.activeTimePresets,
    activeTimeStart: DEFAULT_BEHAVIOR_PROFILE.activeTimeStart,
    activeTimeEnd: DEFAULT_BEHAVIOR_PROFILE.activeTimeEnd,
    weeklyGoals: DEFAULT_BEHAVIOR_PROFILE.weeklyGoals,
  };
}

export async function fetchCurrentBehaviorProfile(): Promise<BehaviorProfile | null> {
  const userId = await getCurrentUserId();

  if (userId === "guest") {
    return null;
  }

  try {
    // Use `id` (text) for lookups so we don't conflict with numeric PK `id`.
    const { data, error } = await supabase
      .from("user_profile")
      .select(
        "primary_goals, preferred_tones, reminder_frequency, active_time_start, active_time_end, active_time_presets, weekly_goals"
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      console.warn("[behavior-profile] Remote fetch failed", error);
      return null;
    }

    if (data) {
      const profile = mapRowToBehaviorProfile(data as BehaviorProfileRow);
      return profile;
    }

    // No row found for this user
    return null;
  } catch (error) {
    console.warn("[behavior-profile] Remote fetch failed", error);
    return null;
  }
}

export async function saveCurrentBehaviorProfile(
  profileInput: BehaviorProfileInput
): Promise<BehaviorProfile> {
  const userId = await getCurrentUserId();
  const profile = toProfileInput(profileInput);
  const { start, end } = resolveTimeRangeFromPresets(profileInput.activeTimePresets);

    const payload = {
      primary_goals: profileInput.primaryGoals,
      preferred_tones: profileInput.preferredTones,
      reminder_frequency: profileInput.reminderFrequency,
      active_time_presets: profileInput.activeTimePresets,
      active_time_start: start,
      active_time_end: end,
      weekly_goals: profileInput.weeklyGoals
  };

  // Upsert into `user_profile` table. Throw on error so callers know if save failed.
  const payloadWithAuthId = { id: userId, ...payload };

  try {
    const { data, error } = await supabase
      .from("user_profile")
      .upsert(payloadWithAuthId, { onConflict: "id" })
      .select(
        "primary_goals, preferred_tones, reminder_frequency, active_time_start, active_time_end, active_time_presets, weekly_goals"
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
