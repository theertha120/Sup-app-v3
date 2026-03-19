import { supabase } from "@/src/lib/supabase";

export type ReminderPreferences = {
  postureRemindersEnabled: boolean;
  /** Daily reminder time in 24h "HH:MM" format (local time as interpreted by the app). */
  postureReminderTime: string;
};

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  postureRemindersEnabled: false,
  postureReminderTime: "09:00",
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
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error(
      "Not authenticated. Please sign in before syncing notification settings."
    );
  }

  return user.id;
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

  const { data, error } = await supabase
    .from("reminder_preferences")
    .select("user_id, reminders_enabled, reminder_time")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw normalizeSupabaseAuthzError(error);
  return toReminderPreferences((data as ReminderPreferencesRow | null) ?? null);
}

/**
 * Fetch reminder preferences and ensure a row exists.
 *
 * Useful to call after login to ensure future updates are simple upserts.
 */
export async function fetchOrCreateCurrentUserReminderPreferences(): Promise<ReminderPreferences> {
  const userId = await getCurrentUserId();

  const { data: existing, error: existingError } = await supabase
    .from("reminder_preferences")
    .select("user_id, reminders_enabled, reminder_time")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) throw normalizeSupabaseAuthzError(existingError);
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

  if (createError) throw normalizeSupabaseAuthzError(createError);
  return toReminderPreferences(created as ReminderPreferencesRow);
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

  if (error) throw normalizeSupabaseAuthzError(error);
  return toReminderPreferences(data as ReminderPreferencesRow);
}

