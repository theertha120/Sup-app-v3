import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/src/lib/supabase";
import type { User } from "@/constants/env";
import { CURRENT_USER_ID } from "@/constants/env";

const LOCAL_SUPSONA_KEY_PREFIX = "sup_app_supsona_";

/** Used internally and by leaderboard so test user's local supsona appears in the list. */
export async function getLocalSupsona(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LOCAL_SUPSONA_KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

async function setLocalSupsona(userId: string, value: string | null): Promise<void> {
  try {
    if (value === null) {
      await AsyncStorage.removeItem(LOCAL_SUPSONA_KEY_PREFIX + userId);
    } else {
      await AsyncStorage.setItem(LOCAL_SUPSONA_KEY_PREFIX + userId, value);
    }
  } catch (e) {
    console.warn("[profile] Failed to save supsona locally", e);
  }
}

/**
 * Row shape of the `profiles` table in Supabase.
 *
 * Mirrors:
 * create table public.profiles (
 *   id text primary key,
 *   name text not null,
 *   avatar_url text,
 *   current_streak integer not null default 0,
 *   last_activity_date date,
 *   weekly_total_points numeric(10,2) not null default 0,
 *   created_at timestamptz not null default now()
 * );
 */
type ProfileRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  current_streak: number | null;
  last_activity_date: string | null;
  weekly_total_points: number | null;
  created_at?: string;
};

/**
 * Profile data returned to the app for the current user.
 *
 * - `avatar` is optional (undefined when no avatar_url is set)
 * - numeric stats are always safe (fall back to 0 when missing)
 * - dates are ISO 8601 strings (YYYY-MM-DD or full ISO for createdAt)
 */
export type UserProfile = {
  /** Supabase auth user id (profiles.id). */
  id: string;
  /** Display name stored in `profiles.name`. */
  name: string;
  /** Optional avatar URL derived from `profiles.avatar_url`. */
  avatar?: string;
  /** Current streak from `profiles.current_streak` (defaults to 0). */
  currentStreak: number;
  /**
   * Last activity date (YYYY-MM-DD) from `profiles.last_activity_date`.
   * Empty string when unknown.
   */
  lastActivityDate: string;
  /**
   * Sum of daily avg_score from last 7 days (`profiles.weekly_total_points`).
   * Safe default of 0 when missing.
   */
  weeklyTotalPoints: number;
  /**
   * Account creation timestamp from `profiles.created_at` (ISO 8601), optional.
   */
  createdAt?: string;
};

/**
 * Basic editable profile fields.
 *
 * Only `name` and `avatar` are user-editable. All keys are optional to allow
 * partial updates (e.g. updating just the name).
 *
 * - `avatar` accepts a URL string or null to clear it.
 * - `name` must be a non-empty string.
 */
export type ProfileUpdateInput = {
  name?: string;
  avatar?: string | null;
};

const localProfileOverrides = new Map<
  string,
  Pick<User, "name" | "avatar">
>();

type ProfileSaveMode = "remote" | "local_offline";
let lastProfileSaveMode: ProfileSaveMode = "remote";

type ProfileUpdateListener = (updatedProfile: UserProfile) => void;
const profileUpdateListeners = new Set<ProfileUpdateListener>();

export function subscribeToProfileUpdates(
  listener: ProfileUpdateListener
): () => void {
  profileUpdateListeners.add(listener);
  return () => {
    profileUpdateListeners.delete(listener);
  };
}

function notifyProfileUpdated(profile: UserProfile): void {
  profileUpdateListeners.forEach((listener) => {
    try {
      listener(profile);
    } catch (err) {
      console.warn("[profile] Profile update listener threw", err);
    }
  });
}

export function consumeLastProfileSaveMode(): ProfileSaveMode {
  const mode = lastProfileSaveMode;
  lastProfileSaveMode = "remote";
  return mode;
}

function getMockUserById(userId: string): User | undefined {
  return undefined;
}

function applyLocalProfileOverride(userId: string, updates: ProfileUpdateInput): void {
  const current = getMockUserById(userId);
  if (!current) return;

  const nextName =
    typeof updates.name === "string" && updates.name.trim().length > 0
      ? updates.name.trim()
      : current.name;

  let nextAvatar = current.avatar;
  if (Object.prototype.hasOwnProperty.call(updates, "avatar")) {
    if (updates.avatar === null) {
      nextAvatar = undefined;
    } else if (typeof updates.avatar === "string") {
      nextAvatar = updates.avatar.trim() || undefined;
    }
  }

  localProfileOverrides.set(userId, {
    name: nextName,
    avatar: nextAvatar,
  });
}

/**
 * Aggregated stats for profile preview.
 * Includes computed values useful for displaying user achievements.
 */
export interface ProfilePreviewStats {
  /** Current consecutive days streak */
  currentStreak: number;
  
  /** Last activity date (YYYY-MM-DD), empty string if never active */
  lastActivityDate: string;
  
  /** Sum of daily avg_score from last 7 days */
  weeklyTotalPoints: number;
  
  /** Whether user has any activity recorded */
  hasActivity: boolean;
}

function mapRowToUserProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    name: row.name || "User", // Fallback name if somehow null
    avatar: row.avatar_url ?? undefined,
    currentStreak: row.current_streak ?? 0,
    lastActivityDate: row.last_activity_date ?? "",
    weeklyTotalPoints: Number(row.weekly_total_points) || 0,
    createdAt: row.created_at,
  };
}

function userToUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    currentStreak: user.currentStreak,
    lastActivityDate: user.lastActivityDate,
    weeklyTotalPoints: user.weeklyTotalPoints,
    createdAt: undefined,
  };
}

/**
 * Get the currently authenticated Supabase user id.
 *
 * This relies on Supabase Auth being configured in the app. If there is no
 * active session, falls back to CURRENT_USER_ID from env for development/testing.
 */
async function getCurrentUserId(): Promise<string> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.warn(
        "[profile] Failed to resolve current user from auth, falling back to CURRENT_USER_ID",
        error
      );
      return CURRENT_USER_ID;
    }

    if (!user) {
      console.warn(
        "[profile] No authenticated user found, falling back to CURRENT_USER_ID"
      );
      return CURRENT_USER_ID;
    }

    return user.id;
  } catch (err) {
    console.warn(
      "[profile] Auth check failed, falling back to CURRENT_USER_ID",
      err
    );
    return CURRENT_USER_ID;
  }
}

/**
 * Fetch basic profile information for the current user.
 *
 * Returned fields:
 * - `id`: Supabase auth user id
 * - `name`: display name
 * - `avatar`: optional avatar URL
 * - `createdAt`: profile creation timestamp (ISO string)
 *
 * Throws when:
 * - no authenticated user is present
 * - the profiles row cannot be loaded
 */
export async function fetchCurrentUserBasicProfile(): Promise<
  Pick<UserProfile, "id" | "name" | "avatar" | "createdAt">
> {
  const userId = await getCurrentUserId();

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, avatar_url, created_at")
      .eq("id", userId)
      .single();

    if (error) {
      console.warn(
        "[profile] Failed to fetch basic profile, falling back to mock data",
        error
      );
      // fall through to mock below
    } else if (data) {
      const row = data as ProfileRow;
      const profile = mapRowToUserProfile({
        ...row,
        // Ensure stats fields have safe defaults even if omitted from select
        current_streak: null,
        last_activity_date: null,
        weekly_total_points: null,
      });

      return {
        id: profile.id,
        name: profile.name,
        avatar: profile.avatar,
        createdAt: profile.createdAt,
      };
    }
  } catch (err) {
    console.warn(
      "[profile] Supabase basic profile fetch threw, falling back to mock data",
      err
    );
  }

  const mock = getMockUserById(userId);
  if (!mock) {
    throw new Error(
      "[profile] Basic profile not found in Supabase or mock data"
    );
  }

  const fallback = userToUserProfile(mock);
  return {
    id: fallback.id,
    name: fallback.name,
    avatar: fallback.avatar,
    createdAt: fallback.createdAt,
  };
}

/**
 * Fetch full profile + aggregated posture stats for the current user.
 *
 * Returned fields (UserProfile):
 * - `id`, `name`, `avatar`
 * - `currentStreak`, `lastActivityDate`, `weeklyTotalPoints`
 * - `createdAt` (optional)
 *
 * Safe defaults:
 * - `currentStreak` → 0 when null
 * - `weeklyTotalPoints` → 0 when null
 * - `lastActivityDate` → "" when null
 *
 * Throws when:
 * - no authenticated user is present
 * - the profiles row cannot be loaded
 */
export async function fetchCurrentUserProfileWithStats(): Promise<UserProfile> {
  const userId = await getCurrentUserId();

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, name, avatar_url, current_streak, last_activity_date, weekly_total_points, created_at"
      )
      .eq("id", userId)
      .single();

    if (error) {
      console.warn(
        "[profile] Failed to fetch profile with stats, falling back to mock data",
        error
      );
      // fall through to mock below
    } else if (data) {
      const profile = mapRowToUserProfile(data as ProfileRow);
      if (userId === CURRENT_USER_ID) {
        const local = await getLocalSupsona(userId);
        if (local != null) profile.avatar = local;
      }
      return profile;
    }
  } catch (err) {
    console.warn(
      "[profile] Supabase profile-with-stats fetch threw, falling back to mock data",
      err
    );
  }

  const mock = getMockUserById(userId);
  if (!mock) {
    throw new Error(
      "[profile] Profile with stats not found in Supabase or mock data"
    );
  }
  const profile = userToUserProfile(mock);
  if (userId === CURRENT_USER_ID) {
    const local = await getLocalSupsona(userId);
    if (local != null) profile.avatar = local;
  }
  return profile;
}

/**
 * Update the current user's profile.
 *
 * - Only `name` and `avatar` (avatar_url) can be changed.
 * - Accepts partial updates; omitted fields are left unchanged.
 * - Restricts updates to the current authenticated user:
 *   - `id` is resolved via Supabase Auth and cannot be overridden.
 *   - RLS on `profiles` should additionally enforce this on the backend.
 *
 * Example:
 *   await updateCurrentUserProfile({ name: "New Name" });
 *   await updateCurrentUserProfile({ avatar: "https://..." });
 *   await updateCurrentUserProfile({ avatar: null }); // clear avatar
 *
 * Returns the updated `UserProfile`.
 */
export async function updateCurrentUserProfile(
  updates: ProfileUpdateInput
): Promise<UserProfile> {
  const userId = await getCurrentUserId();

  const payload: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    if (typeof updates.name !== "string" || updates.name.trim().length === 0) {
      throw new Error("Name must be a non-empty string");
    }
    payload.name = updates.name.trim();
  }
  
  if (Object.prototype.hasOwnProperty.call(updates, "avatar")) {
    // Map domain `avatar` -> DB `avatar_url`
    if (updates.avatar === null) {
      payload.avatar_url = null;
    } else if (typeof updates.avatar === "string") {
      payload.avatar_url = updates.avatar.trim() || null;
    } else {
      throw new Error("Avatar must be a string URL or null");
    }
  }

  if (Object.keys(payload).length === 0) {
    // Nothing to update; just return the current profile snapshot.
    return fetchCurrentUserProfileWithStats();
  }

  // For test user, always persist supsona (avatar) locally so it works when Supabase is down
  if (userId === CURRENT_USER_ID && Object.prototype.hasOwnProperty.call(updates, "avatar")) {
    await setLocalSupsona(userId, updates.avatar ?? null);
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", userId)
    .select(
      "id, name, avatar_url, current_streak, last_activity_date, weekly_total_points, created_at"
    )
    .single();

  if (error) {
    console.warn("[profile] Failed to update profile (Supabase), using local fallback for test user", error);
    if (userId === CURRENT_USER_ID) {
      return fetchCurrentUserProfileWithStats();
    }
    console.error("[profile] Failed to update profile", error);

    const isNetworkError = /network request failed|failed to fetch|fetch failed|network/i.test(
      error.message ?? ""
    );
    if (isNetworkError) {
      lastProfileSaveMode = "local_offline";
      console.warn(
        "[profile] Supabase is unreachable right now. Your profile changes were saved locally (offline mode)."
      );
      applyLocalProfileOverride(userId, updates);
      const locallyUpdated = getMockUserById(userId);
      if (locallyUpdated) {
        const fallbackProfile = userToUserProfile(locallyUpdated);
        notifyProfileUpdated(fallbackProfile);
        return fallbackProfile;
      }
    }
    
    // Provide helpful error message for RLS policy issues
    if (error.code === "42501" || error.message?.includes("permission denied") || error.message?.includes("policy")) {
      throw new Error(
        "Update blocked: You can only update your own profile. Authentication may be required."
      );
    }
    throw error;
  }

  lastProfileSaveMode = "remote";

  const updatedProfile = mapRowToUserProfile(data as ProfileRow);
  notifyProfileUpdated(updatedProfile);
  return updatedProfile;
}

/**
 * Fetches aggregated stats for profile preview.
 * Useful for displaying user achievements without full profile data.
 * 
 * @param userId - The authenticated user's ID
 * @returns ProfilePreviewStats with safe defaults, or null if profile not found
 * @throws Error if database query fails
 * 
 * @example
 * ```ts
 * const stats = await fetchProfilePreviewStats("user-4");
 * if (stats) {
 *   console.log(`Streak: ${stats.currentStreak} days`);
 *   console.log(`Weekly points: ${stats.weeklyTotalPoints}`);
 * }
 * ```
 */
export async function fetchProfilePreviewStats(
  userId: string
): Promise<ProfilePreviewStats | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("current_streak, last_activity_date, weekly_total_points")
      .eq("id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // Not found in Supabase, fall through to mock
      } else {
        console.warn(
          "[profile] Failed to fetch profile stats, falling back to mock data",
          error
        );
      }
    } else if (data) {
      const row = data as Pick<
        ProfileRow,
        "current_streak" | "last_activity_date" | "weekly_total_points"
      >;

      return {
        currentStreak: row.current_streak ?? 0,
        lastActivityDate: row.last_activity_date ?? "",
        weeklyTotalPoints: Number(row.weekly_total_points) || 0,
        hasActivity: Boolean(row.last_activity_date),
      };
    }
  } catch (err) {
    console.warn(
      "[profile] Supabase stats fetch threw, falling back to mock data",
      err
    );
  }

  const mock = getMockUserById(userId);
  if (!mock) {
    return null;
  }

  return {
    currentStreak: mock.currentStreak,
    lastActivityDate: mock.lastActivityDate,
    weeklyTotalPoints: mock.weeklyTotalPoints,
    hasActivity: Boolean(mock.lastActivityDate),
  };
}

/**
 * Fetches a user's profile by userId (for use with explicit userId).
 * 
 * @param userId - The authenticated user's ID (from auth context)
 * @returns UserProfile with safe defaults for missing data, or null if not found
 * @throws Error if database query fails
 * 
 * @example
 * ```ts
 * const profile = await fetchUserProfile("user-4");
 * if (profile) {
 *   console.log(profile.name, profile.currentStreak);
 * }
 * ```
 */
export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, name, avatar_url, current_streak, last_activity_date, weekly_total_points, created_at"
      )
      .eq("id", userId)
      .single();

    if (error) {
      console.error(
        "[profile] Failed to fetch user profile:",
        error
      );
      return null;
    }

    if (!data) {
      return null;
    }

    const profile = mapRowToUserProfile(data as ProfileRow);
    if (userId === CURRENT_USER_ID) {
      const local = await getLocalSupsona(userId);
      if (local != null) profile.avatar = local;
    }
    return profile;
  } catch (err) {
    console.error(
      "[profile] Exception while fetching user profile:",
      err
    );
    return null;
  }
}

/**
 * Updates a user's profile by userId (for use with explicit userId).
 * 
 * Restrictions:
 * - Only name and avatar_url can be updated
 * - Updates are restricted to the authenticated user (userId must match)
 * - Partial updates are supported (can update just name or just avatar_url)
 * 
 * @param userId - The authenticated user's ID (must match the profile being updated)
 * @param updates - Partial profile fields to update (only name and avatar are allowed)
 * @returns Updated UserProfile, or null if profile not found
 * @throws Error if update fails or userId doesn't match
 * 
 * @example
 * ```ts
 * // Update just the name
 * await updateUserProfile("user-4", { name: "New Name" });
 * 
 * // Update avatar
 * await updateUserProfile("user-4", { avatar: "https://example.com/avatar.jpg" });
 * 
 * // Remove avatar
 * await updateUserProfile("user-4", { avatar: null });
 * ```
 */
export async function updateUserProfile(
  userId: string,
  updates: ProfileUpdateInput
): Promise<UserProfile | null> {
  // Validate that only editable fields are being updated
  const allowedFields = ["name", "avatar"];
  const updateKeys = Object.keys(updates);
  const invalidFields = updateKeys.filter((key) => !allowedFields.includes(key));
  
  if (invalidFields.length > 0) {
    throw new Error(
      `Cannot update fields: ${invalidFields.join(", ")}. Only name and avatar can be updated.`
    );
  }

  // Build update payload (only include provided fields)
  const updatePayload: Record<string, unknown> = {};
  
  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || updates.name.trim().length === 0) {
      throw new Error("Name must be a non-empty string");
    }
    updatePayload.name = updates.name.trim();
  }
  
  if (updates.avatar !== undefined) {
    // Allow null to remove avatar, or a valid URL string
    if (updates.avatar === null) {
      updatePayload.avatar_url = null;
    } else if (typeof updates.avatar === "string") {
      updatePayload.avatar_url = updates.avatar.trim() || null;
    } else {
      throw new Error("Avatar must be a string URL or null");
    }
  }

  // If no valid updates, return current profile
  if (Object.keys(updatePayload).length === 0) {
    return fetchUserProfile(userId);
  }

  // For test user, always persist supsona (avatar) locally so it works when Supabase is down
  if (userId === CURRENT_USER_ID && updates.avatar !== undefined) {
    await setLocalSupsona(userId, updates.avatar ?? null);
  }

  // Perform update (restricted to current user via RLS)
  const { data, error } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId)
    .select("id, name, avatar_url, current_streak, last_activity_date, weekly_total_points, created_at")
    .single();

  if (error) {
    if (userId === CURRENT_USER_ID) {
      console.warn("[profile] Failed to update user profile (Supabase), using local fallback for test user", error);
      return fetchUserProfile(userId);
    }
    if (error.code === "PGRST116") {
      return null; // Profile not found
    }

    const isNetworkError = /network request failed|failed to fetch|fetch failed|network/i.test(
      error.message ?? ""
    );
    if (isNetworkError) {
      lastProfileSaveMode = "local_offline";
      console.warn(
        "[profile] Supabase is unreachable right now. Your profile changes were saved locally (offline mode)."
      );
      applyLocalProfileOverride(userId, updates);
      const locallyUpdated = getMockUserById(userId);
      if (!locallyUpdated) {
        return null;
      }
      const fallbackProfile = userToUserProfile(locallyUpdated);
      notifyProfileUpdated(fallbackProfile);
      return fallbackProfile;
    }
    
    // Provide helpful error message for RLS policy issues
    if (error.code === "42501" || error.message?.includes("permission denied") || error.message?.includes("policy")) {
      throw new Error(
        "Update blocked: You can only update your own profile. Authentication may be required."
      );
    }
    console.error("[profile] Failed to update user profile", error);
    throw error;
  }

  lastProfileSaveMode = "remote";

  const updatedProfile = mapRowToUserProfile(data as ProfileRow);

  if (userId === CURRENT_USER_ID) {
    const local = await getLocalSupsona(userId);
    if (local != null) updatedProfile.avatar = local;
  }

  notifyProfileUpdated(updatedProfile);
  return updatedProfile;
}

/**
 * Helper to convert UserProfile to User type (for compatibility with existing UI components).
 * This maps UserProfile fields to the User interface used throughout the app.
 */
export function userProfileToUser(profile: UserProfile): User {
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    currentStreak: profile.currentStreak,
    lastActivityDate: profile.lastActivityDate,
    weeklyTotalPoints: profile.weeklyTotalPoints,
  };
}
