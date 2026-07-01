import { supabase } from "@/src/lib/supabase";
import type {
  BehaviorGoalId,
  ReminderTone,
  ReminderFrequency,
  WeeklyGoalId,
} from "../user/behaviorProfileService";

/**
 * REMINDER ENGINE SERVICE
 * Implements all MVP rules for reminder behavior
 *
 * Uses only:
 * - user_profile
 * - reminder_content
 * - reminder_log
 */

export type ReminderType =
  | "posture_check"
  | "posture_reset"
  | "movement_break"
  | "encouragement"
  | "re_engagement";

interface RemindersContent {
  id: number;
  reminder_type: ReminderType;
  tone: ReminderTone;
  title: string;
  body: string;
  action_label: string;
  active: boolean;
  sort_order: number;
}

interface ReminderLogEntry {
  id: string;
  user_id: string;
  reminder_content_id: number;
  reminder_type: ReminderType;
  sent_at: string;
  user_interacted: boolean;
  interaction_at: string | null;
}

export type ActiveTimePreset = "morning" | "afternoon" | "evening" | "late_night";

interface UserProfile {
  id: string;
  primary_goals: BehaviorGoalId[];
  preferred_tones: ReminderTone[];
  reminder_frequency: ReminderFrequency;
  active_time_start: string;
  active_time_end: string;
  active_time_presets: ActiveTimePreset[];
  weekly_goals: WeeklyGoalId[];
  last_app_interaction_at: string | null;
  last_reminder_sent_at: string | null;
  timezone_offset_minutes: number;
}

// RULE GROUP 2: REMINDER FREQUENCY 
const FREQUENCY_CONFIG: Record<
  ReminderFrequency,
  { cooldown_minutes: number; max_per_day: number }
> = {
  light: { cooldown_minutes: 5, max_per_day: 3 },
  medium: { cooldown_minutes: 5, max_per_day: 6 },
  active: { cooldown_minutes: 5, max_per_day: 10 }, // FOR TESTING ONLY
  // active: { cooldown_minutes: 45, max_per_day: 10 }, // ORIGINAL ACTIVE SETTINGS
};

const GLOBAL_MIN_COOLDOWN_MINUTES = 5; // TO DO CHANGE BACK 15 MIN & MIN TO MAX

// RULE GROUP 3: PRIMARY GOAL -> REMINDER DISTRIBUTION
// probability distribution of reminder types for each primary goal.
// Distributions are averaged if multiple goals are selected.
const GOAL_REMINDER_DISTRIBUTION: Record<
  BehaviorGoalId,
  Partial<Record<ReminderType, number>>
> = {
  study_posture: {
    posture_check: 0.7,
    posture_reset: 0.25,
    encouragement: 0.05,
  },
  less_back_discomfort: {
    movement_break: 0.5,
    posture_reset: 0.4,
    encouragement: 0.1,
  },
  desk_posture: {
    posture_check: 0.6,
    posture_reset: 0.3,
    movement_break: 0.1,
  },
  pilates_form_awareness: {
    posture_reset: 0.7,
    posture_check: 0.2,
    encouragement: 0.1,
  },
  general_posture_awareness: {
    posture_check: 0.4,
    posture_reset: 0.35,
    movement_break: 0.15,
    encouragement: 0.1,
  },
};

// RULE GROUP 4: WEEKLY GOAL MODIFIERS
// To boost probabilities of certain reminder types by adding a flat modifier to the base probabilities 
// Modifiers are later summed if multiple weekly goals are selected.
const WEEKLY_GOAL_MODIFIERS: Record<
  WeeklyGoalId,
  Partial<Record<ReminderType, number>>
> = {
  awareness_only: {},
  "3_resets_per_day": {
    posture_reset: 0.1, // +10%
  },
  reduce_slouching_sessions: {
    posture_check: 0.1, // +10%
  },
};

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

// RULE GROUP 1: ACTIVE HOURS 
const ACTIVE_TIME_PRESET_RANGES: Record<
  ActiveTimePreset,
  { start: string; end: string }
> = {
  morning:    { start: "07:00", end: "11:59" },
  afternoon:  { start: "12:00", end: "16:59" },
  evening:    { start: "17:00", end: "20:59" },
  late_night: { start: "21:00", end: "01:00" },
};
 
function isWithinActivePresets(
  activeTimePresets: ActiveTimePreset[],
  timezoneOffsetMinutes: number = 0
): boolean {
  if (!activeTimePresets || activeTimePresets.length === 0) {
    console.log("No active time presets configured");
    return false;
  }
 
  // Derive current local time as "HH:MM" string
  const now = new Date();
  const localTime = new Date(now.getTime() + timezoneOffsetMinutes * 60000);
  const hours = String(localTime.getUTCHours()).padStart(2, "0");
  const minutes = String(localTime.getUTCMinutes()).padStart(2, "0");
  const currentTime = `${hours}:${minutes}`;
  console.log("Current local time:", currentTime); // check if this gives HH:MM format
 
  // Check each selected preset in turn
  for (const preset of activeTimePresets) {
    if (preset === "morning") {
      // 07:00 – 11:59  (same day, no midnight crossing)
      if (currentTime >= "07:00" && currentTime <= "11:59") {
        return true;
      }
    } else if (preset === "afternoon") {
      // 12:00 – 16:59
      if (currentTime >= "12:00" && currentTime <= "16:59") {
        return true;
      }
    } else if (preset === "evening") {
      // 17:00 – 20:59
      if (currentTime >= "17:00" && currentTime <= "20:59") {
        return true;
      }
    } else if (preset === "late_night") {
      // 21:00 – 01:00  (crosses midnight — use OR)
      if (currentTime >= "21:00" || currentTime <= "01:00") {
        return true;
      }
    }
  }
 
  return false;
}
 

// RULE GROUP 2: CHECK COOLDOWN
async function checkCooldown(
  userId: string,
  frequencyLevel: ReminderFrequency
): Promise<boolean> {
  const config = FREQUENCY_CONFIG[frequencyLevel];

  const { data, error } = await supabase
    .from("reminder_log")
    .select("sent_at")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return true; // No previous reminder, pass
  }

  const lastSentAt = new Date(data[0].sent_at);
  const now = new Date();
  const minutesSinceLast = (now.getTime() - lastSentAt.getTime()) / 60000;

  // GLOBAL ANTI-SPAM RULE: Never allow less than 15 minutes
  const effectiveCooldown = Math.max(
    config.cooldown_minutes,
    GLOBAL_MIN_COOLDOWN_MINUTES
  );

  return minutesSinceLast >= effectiveCooldown;
}

//  RULE GROUP 12: CHECK DAILY LIMITS 
async function checkDailyLimit(
  userId: string,
  frequencyLevel: ReminderFrequency
): Promise<boolean> {
  const config = FREQUENCY_CONFIG[frequencyLevel];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("reminder_log")
    .select("id")
    .eq("user_id", userId)
    .gte("sent_at", today.toISOString())
    .lt("sent_at", new Date(today.getTime() + 86400000).toISOString());

  if (error) {
    return true; // On error, allow reminder
  }

  const count = data?.length || 0;
  return count < config.max_per_day;
}

//  RULE GROUP 5: RE-ENGAGEMENT CHECK 
async function shouldForceReEngagement(
  lastAppInteractionAt: string | null
): Promise<boolean> {
  if (!lastAppInteractionAt) {
    return true; // No interaction recorded, force re-engagement
  }

  const lastInteraction = new Date(lastAppInteractionAt);
  const now = new Date();
  const hoursSinceLastInteraction =
    (now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);

  return hoursSinceLastInteraction >= 48;
}

//  RULE GROUP 6: ENCOURAGEMENT FREQUENCY CHECK 
async function canSendEncouragement(userId: string): Promise<boolean> {
  // Check if last reminder was encouragement
  const { data: lastReminder } = await supabase
    .from("reminder_log")
    .select("reminder_type")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(1);

  if (lastReminder && lastReminder[0]?.reminder_type === "encouragement") {
    return false; // Never send encouragement twice in a row
  }

  // Check max 1 encouragement every 3 reminders
  const { data: recentReminders } = await supabase
    .from("reminder_log")
    .select("reminder_type")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(3);

  if (!recentReminders) return true;

  const encouragementCount = recentReminders.filter(
    (r) => r.reminder_type === "encouragement"
  ).length;

  return encouragementCount < 1;
}

//  DETERMINE REMINDER TYPE PROBABILITIES 
// For multiple primary goals, each goal's distribution is averaged so all
// selected goals contribute equally to the final probability mix.
// For multiple weekly goals, all modifiers are summed and applied on top.
function calculateReminderTypeProbabilities(
  primaryGoals: BehaviorGoalId[],
  weeklyGoals: WeeklyGoalId[],
  forceReEngagement: boolean
): Record<ReminderType, number> {
  if (forceReEngagement) {
    return { re_engagement: 1.0 } as any;
  }

  // Merge distributions from all selected primary goals by averaging
  // creating a custom distribution for the user based on their unique goal combination.
  const merged: Partial<Record<ReminderType, number>> = {};
  const goalCount = primaryGoals.length;
 
  for (const goal of primaryGoals) {
    const dist = GOAL_REMINDER_DISTRIBUTION[goal] || {};
    for (const [type, prob] of Object.entries(dist)) {
      const key = type as ReminderType;
      merged[key] = (merged[key] || 0) + (prob as number) / goalCount;
    }
  }

  // Apply all weekly goal modifiers (summed across all selected weekly goals)
  for (const weeklyGoal of weeklyGoals) {
    const modifiers = WEEKLY_GOAL_MODIFIERS[weeklyGoal];
    if (modifiers) {
      for (const [type, modifier] of Object.entries(modifiers)) {
        const key = type as ReminderType;
        merged[key] = (merged[key] || 0) + (modifier as number);
      }
    }
  }
 
  return merged as Record<ReminderType, number>;
}

//  SELECT REMINDER TYPE 
async function selectReminderType(
  probabilities: Record<ReminderType, number>,
  userId: string
): Promise<ReminderType> {
  // RULE GROUP 13: REMINDER ORDER PRIORITY
  if (probabilities.re_engagement && probabilities.re_engagement > 0) {
    return "re_engagement";
  }

  // Check if encouragement can be sent
  const canEncourage = await canSendEncouragement(userId);
  if (
    canEncourage &&
    probabilities.encouragement &&
    probabilities.encouragement > 0
  ) {
    // Use weighted random for encouragement
    if (Math.random() < probabilities.encouragement) {
      return "encouragement";
    }
  }

  // Random selection based on probabilities
  const rand = Math.random();
  let cumulative = 0;

  for (const [type, prob] of Object.entries(probabilities)) {
    cumulative += prob;
    if (rand < cumulative) {
      return type as ReminderType;
    }
  }

  // Fallback to first available type
  return Object.keys(probabilities)[0] as ReminderType;
}

//  RULE GROUP 11: FETCH WITH SORT ORDER PREFERENCE 
async function fetchReminderContent(
  reminderType: ReminderType,
  preferredTones: ReminderTone[],
  fallbackAttempt: number = 0
): Promise<RemindersContent | null> {

  const tone = preferredTones[Math.floor(Math.random() * preferredTones.length)];
  console.log(`Fetching content for type: ${reminderType}, tones: ${tone}, attempt: ${fallbackAttempt}`);

  const attempts = [
    // ATTEMPT 0: Exact match
    { reminder_type: reminderType, tone, active: true },
    // FALLBACK 1: Same type, gentle tone
    {
      reminder_type: reminderType,
      tone: "gentle" as ReminderTone,
      active: true,
    },
    // FALLBACK 2: Same type, any tone
    { reminder_type: reminderType, active: true },
  ];

  if (fallbackAttempt >= attempts.length) {
    return null;
  }

  const query = attempts[fallbackAttempt];
  let dbQuery = supabase
    .from("reminder_content")
    .select("*")
    .eq("reminder_type", query.reminder_type)
    .eq("active", true);

  if (query.tone) {
    dbQuery = dbQuery.eq("tone", query.tone);
  }

  dbQuery = dbQuery.order("sort_order", { ascending: true });

  const { data, error } = await dbQuery;

  if (error || !data || data.length === 0) {
    // Try next fallback
    return fetchReminderContent(reminderType, preferredTones, fallbackAttempt + 1);
  }

  // RULE GROUP 11: 70% prefer lower sort_order, 30% fully random
  const useWeighted = Math.random() < 0.7;

  if (useWeighted && data.length > 0) {
    // Already sorted by sort_order ascending, return first (lowest)
    return data[0] as RemindersContent;
  } else {
    // Random selection from all results
    return data[Math.floor(Math.random() * data.length)] as RemindersContent;
  }
}

//  RULE GROUP 9: AVOID REPETITION 
async function filterRecentReminders(
  userId: string,
  reminderContent: RemindersContent
): Promise<boolean> {
  const { data: recentLog } = await supabase
    .from("reminder_log")
    .select("reminder_content_id")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(5);

  if (!recentLog) return true;

  const recentIds = recentLog.map((log) => log.reminder_content_id);
  return !recentIds.includes(reminderContent.id);
}

//  LOG SENT REMINDER 
async function logReminder(
  userId: string,
  reminderContent: RemindersContent,
  reminderType: ReminderType
): Promise<ReminderLogEntry | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("reminder_log")
    .insert({
      user_id: userId,
      reminder_content_id: reminderContent.id,
      reminder_type: reminderType,
      sent_at: now,
      created_at: now,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to log reminder:", error);
    return null;
  }

  return data as ReminderLogEntry;
}

//  MAIN ENGINE 
export async function getReminderForUser(): Promise<RemindersContent | null> {
  const userId = await getCurrentUserId();
  console.log("Generating reminder for user:", userId);

  if (userId === "guest") {
    return null;
  }
  
  try {
    // Fetch user profile
    const { data: profileData, error: profileError } = await supabase
      .from("user_profile")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profileData) {
      console.error("Failed to fetch user profile:", profileError);
      return null;
    }

    const profile = profileData as UserProfile;
    console.log("profile.active_time_start:", profile.active_time_start);
    console.log("profile.primary_goals:", profile.primary_goals);

    // RULE GROUP 1: CHECK ACTIVE HOURS
    if (
      !isWithinActivePresets(
        profile.active_time_presets,
        profile.timezone_offset_minutes
      )
    ) {
      console.log("Outside active hours");
      return null;
    }
    console.log("Within active hours");

    // RULE GROUP 2: CHECK COOLDOWN
    const passedCooldown = await checkCooldown(
      userId,
      profile.reminder_frequency
    );
    console.log("Cooldown check result:", passedCooldown);
    if (!passedCooldown) {
      console.log("Still in cooldown period");
      return null;
    }

    // RULE GROUP 12: CHECK DAILY LIMIT
    const passedDailyLimit = await checkDailyLimit(
      userId,
      profile.reminder_frequency
    );
    console.log("Daily limit check result:", passedDailyLimit);
    if (!passedDailyLimit) {
      console.log("Daily reminder limit reached");
      return null;
    }

    // RULE GROUP 5: CHECK RE-ENGAGEMENT
    const forceReEngagement = await shouldForceReEngagement(
      profile.last_app_interaction_at
    );
    console.log("Force re-engagement:", forceReEngagement);

    console.log("profile.primary_goals:", profile.primary_goals);
    console.log("profile.weekly_goals:", profile.weekly_goals);
    // RULE GROUP 3 & 4: CALCULATE PROBABILITIES
    const probabilities = calculateReminderTypeProbabilities(
      profile.primary_goals,
      profile.weekly_goals,
      forceReEngagement
    );
    console.log("Calculated reminder type probabilities:", probabilities);

    // SELECT REMINDER TYPE by using weighted random roll to pick one type
    const reminderType = await selectReminderType(probabilities, userId);
    console.log("Selected reminder type:", reminderType);

    // console.log(profile.preferred_tones);
    // RULE GROUP 7 & 8: FETCH REMINDER CONTENT
    let reminderContent = await fetchReminderContent(
      reminderType,
      profile.preferred_tones
    );
    console.log("Fetched reminder content:", reminderContent);

    if (!reminderContent) {
      console.log("No matching reminder content found");
      return null;
    }

    // RULE GROUP 9: AVOID REPETITION
    let attempts = 0;
    while (
      !(await filterRecentReminders(userId, reminderContent)) &&
      attempts < 3
    ) {
      reminderContent = await fetchReminderContent(
        reminderType,
        profile.preferred_tones
      );
      attempts++;

      if (!reminderContent) {
        console.log("No non-repeated reminder found");
        return null;
      }
    }

    //  LOG THE REMINDER
    await logReminder(userId, reminderContent, reminderType);

    return reminderContent;
  } catch (error) {
    console.error("Error in reminder engine:", error);
    return null;
  }
}
