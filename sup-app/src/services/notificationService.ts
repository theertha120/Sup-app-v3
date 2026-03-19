import { supabase } from "@/src/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { CURRENT_USER_ID } from "@/constants/env";

export type ReminderPreferences = {
  postureRemindersEnabled: boolean;
  /** Daily reminder time in 24h "HH:MM" format (local time as interpreted by the app). */
  postureReminderTime: string;
};

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  postureRemindersEnabled: false,
  postureReminderTime: "17:30",
};

type ReminderPreferencesRow = {
  user_id: string;
  reminders_enabled: boolean | null;
  reminder_time: string | null;
};

type PushTokenRow = {
  id?: string;
  user_id: string;
  token: string;
  platform?: string | null;
  device_id?: string | null;
  last_seen_at?: string | null;
};

const LOCAL_POSTURE_REMINDER_NOTIFICATION_ID_KEY =
  "sup_app_posture_reminder_notification_id";

function toReminderPreferences(row: ReminderPreferencesRow | null): ReminderPreferences {
  if (!row) return DEFAULT_REMINDER_PREFERENCES;
  return {
    postureRemindersEnabled:
      row.reminders_enabled ?? DEFAULT_REMINDER_PREFERENCES.postureRemindersEnabled,
    postureReminderTime:
      normalizeDailyTime(row.reminder_time) ?? DEFAULT_REMINDER_PREFERENCES.postureReminderTime,
  };
}

async function getCurrentUserId(): Promise<string> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.warn(
        "[notifications] Failed to resolve auth user, falling back to CURRENT_USER_ID",
        error
      );
      return CURRENT_USER_ID;
    }

    if (!user) {
      console.warn(
        "[notifications] No authenticated user, falling back to CURRENT_USER_ID"
      );
      return CURRENT_USER_ID;
    }

    return user.id;
  } catch (e) {
    console.warn(
      "[notifications] Auth check threw, falling back to CURRENT_USER_ID",
      e
    );
    return CURRENT_USER_ID;
  }
}

function normalizeSupabaseAuthzError(err: unknown): Error {
  const e = err as { code?: string; message?: string };
  if (e?.code === "42501" || e?.message?.toLowerCase().includes("policy")) {
    return new Error(
      "Permission denied. You can only access your own notification settings."
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

function normalizeDailyTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  // Accept either "HH:MM" or "HH:MM:SS" (Supabase `time` may round-trip as HH:MM:SS)
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(v);
  if (!m) return null;
  const hh = m[1];
  const mm = m[2];
  return `${hh}:${mm}`;
}

function parseHHMM(value: string): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export async function ensureLocalNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  return status === "granted";
}

export async function cancelLocalPostureReminder(): Promise<void> {
  const existingId = await AsyncStorage.getItem(LOCAL_POSTURE_REMINDER_NOTIFICATION_ID_KEY);
  if (!existingId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(existingId);
  } catch (e) {
    console.warn("[notifications] Failed to cancel scheduled local reminder", e);
  } finally {
    await AsyncStorage.removeItem(LOCAL_POSTURE_REMINDER_NOTIFICATION_ID_KEY);
  }
}

export async function scheduleDailyLocalPostureReminder(timeHHMM: string): Promise<void> {
  const parsed = parseHHMM(timeHHMM) ?? parseHHMM(DEFAULT_REMINDER_PREFERENCES.postureReminderTime);
  if (!parsed) return;

  await cancelLocalPostureReminder();

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: "Posture reminder",
      body: "Quick check-in: roll your shoulders back and sit tall.",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour: parsed.hour,
      minute: parsed.minute,
      repeats: true,
    },
  });

  await AsyncStorage.setItem(LOCAL_POSTURE_REMINDER_NOTIFICATION_ID_KEY, id);
}

/**
 * Apply local scheduling based on stored preferences.
 * - If reminders enabled: ensure permission then schedule daily local reminder.
 * - If disabled or permission denied: cancel any scheduled reminder.
 */
export async function syncLocalPostureReminderWithPreferences(
  prefs: ReminderPreferences
): Promise<{ scheduled: boolean; permissionGranted: boolean }> {
  if (!prefs.postureRemindersEnabled) {
    await cancelLocalPostureReminder();
    return { scheduled: false, permissionGranted: true };
  }

  const granted = await ensureLocalNotificationPermission();
  if (!granted) {
    await cancelLocalPostureReminder();
    return { scheduled: false, permissionGranted: false };
  }

  await scheduleDailyLocalPostureReminder(prefs.postureReminderTime);
  return { scheduled: true, permissionGranted: true };
}

/**
 * Store or refresh the current user's push token.
 *
 * Intended frontend flow:
 * - If permission is granted and you obtain a token, call this.
 * - If permission is denied, do NOT call this (and instead store local UI state).
 */
export async function upsertCurrentUserPushToken(input: {
  token: string;
  platform?: "ios" | "android" | "web" | string;
  deviceId?: string;
  lastSeenAt?: Date;
}): Promise<void> {
  const userId = await getCurrentUserId();

  const token = input.token?.trim();
  if (!token) throw new Error("Push token is required");

  const payload: PushTokenRow = {
    user_id: userId,
    token,
    platform: input.platform ?? null,
    device_id: input.deviceId ?? null,
    last_seen_at: (input.lastSeenAt ?? new Date()).toISOString(),
  };

  const { error } = await supabase
    .from("push_tokens")
    .upsert(payload, { onConflict: "token" });

  if (error) throw normalizeSupabaseAuthzError(error);
}

/**
 * Fetch reminder preferences for the current user.
 *
 * - Returns safe defaults when row is missing/null.
 * - Does not create a row automatically.
 */
export async function fetchCurrentUserReminderPreferences(): Promise<ReminderPreferences> {
  const userId = await getCurrentUserId();

  try {
    const { data, error } = await supabase
      .from("reminder_preferences")
      .select("user_id, reminders_enabled, reminder_time")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.warn(
        "[notifications] Failed to fetch reminder preferences, falling back to defaults",
        error
      );
      return DEFAULT_REMINDER_PREFERENCES;
    }
    return toReminderPreferences((data as ReminderPreferencesRow | null) ?? null);
  } catch (e) {
    console.warn(
      "[notifications] Reminder preferences fetch threw, falling back to defaults",
      e
    );
    return DEFAULT_REMINDER_PREFERENCES;
  }
}

/**
 * Fetch reminder preferences and ensure a row exists.
 *
 * Useful to call after login to ensure future updates are simple upserts.
 */
export async function fetchOrCreateCurrentUserReminderPreferences(): Promise<ReminderPreferences> {
  const userId = await getCurrentUserId();

  try {
    const { data: existing, error: existingError } = await supabase
      .from("reminder_preferences")
      .select("user_id, reminders_enabled, reminder_time")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) {
      console.warn(
        "[notifications] Failed to fetch reminder prefs (maybeSingle), falling back to defaults",
        existingError
      );
      return DEFAULT_REMINDER_PREFERENCES;
    }
    if (existing) return toReminderPreferences(existing as ReminderPreferencesRow);

    const insertPayload = {
      user_id: userId,
      reminders_enabled: DEFAULT_REMINDER_PREFERENCES.postureRemindersEnabled,
      reminder_time: DEFAULT_REMINDER_PREFERENCES.postureReminderTime,
    };

    const { data: created, error: createError } = await supabase
      .from("reminder_preferences")
      .insert(insertPayload)
      .select("user_id, reminders_enabled, reminder_time")
      .single();

    if (createError) {
      console.warn(
        "[notifications] Failed to create reminder prefs row, falling back to defaults",
        createError
      );
      return DEFAULT_REMINDER_PREFERENCES;
    }

    return toReminderPreferences(created as ReminderPreferencesRow);
  } catch (e) {
    console.warn(
      "[notifications] Reminder preferences fetch/create threw, falling back to defaults",
      e
    );
    return DEFAULT_REMINDER_PREFERENCES;
  }
}

/**
 * Update reminder preferences for the current user.
 *
 * - Handles null/default values (never stores nulls).
 * - Uses upsert so it works whether or not a row exists yet.
 */
export async function updateCurrentUserReminderPreferences(
  updates: Partial<ReminderPreferences>
): Promise<ReminderPreferences> {
  const userId = await getCurrentUserId();

  const current = await fetchCurrentUserReminderPreferences();
  const next: ReminderPreferences = {
    postureRemindersEnabled:
      updates.postureRemindersEnabled ?? current.postureRemindersEnabled,
    postureReminderTime:
      normalizeDailyTime(updates.postureReminderTime) ??
      normalizeDailyTime(current.postureReminderTime) ??
      DEFAULT_REMINDER_PREFERENCES.postureReminderTime,
  };

  try {
    const payload = {
      user_id: userId,
      reminders_enabled: Boolean(next.postureRemindersEnabled),
      reminder_time: next.postureReminderTime,
    };

    const { data, error } = await supabase
      .from("reminder_preferences")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id, reminders_enabled, reminder_time")
      .single();

    if (error) {
      console.warn(
        "[notifications] Failed to upsert reminder preferences, returning local value",
        error
      );
      return next;
    }

    return toReminderPreferences(data as ReminderPreferencesRow);
  } catch (e) {
    console.warn(
      "[notifications] Reminder preferences upsert threw, returning local value",
      e
    );
    return next;
  }
}

/**
 * Convenience for Settings screen:
 * - Upserts reminder prefs in Supabase
 * - Syncs local scheduled notification accordingly (Expo Go compatible)
 */
export async function updateReminderPreferencesAndSyncLocal(
  updates: Partial<ReminderPreferences>
): Promise<{
  preferences: ReminderPreferences;
  local: { scheduled: boolean; permissionGranted: boolean };
}> {
  const preferences = await updateCurrentUserReminderPreferences(updates);
  const local = await syncLocalPostureReminderWithPreferences(preferences);
  return { preferences, local };
}

/**
 * Convenience for Settings screen initial load:
 * - Fetches/creates prefs in Supabase
 * - Syncs local scheduled notification
 */
export async function loadReminderPreferencesAndSyncLocal(): Promise<{
  preferences: ReminderPreferences;
  local: { scheduled: boolean; permissionGranted: boolean };
}> {
  const preferences = await fetchOrCreateCurrentUserReminderPreferences();
  const local = await syncLocalPostureReminderWithPreferences(preferences);
  return { preferences, local };
}

