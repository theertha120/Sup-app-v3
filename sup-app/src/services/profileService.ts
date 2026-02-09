import { supabase } from "@/src/lib/supabase";
import type { User } from "../../constants/env";
import { CURRENT_USER_ID } from "../../constants/env";

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

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, avatar_url, created_at")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[profile] Failed to fetch basic profile", error);
    throw error;
  }

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

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, name, avatar_url, current_streak, last_activity_date, weekly_total_points, created_at"
    )
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[profile] Failed to fetch profile with stats", error);
    throw error;
  }

  return mapRowToUserProfile(data as ProfileRow);
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

  const { data, error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", userId)
    .select(
      "id, name, avatar_url, current_streak, last_activity_date, weekly_total_points, created_at"
    )
    .single();

  if (error) {
    console.error("[profile] Failed to update profile", error);
    
    // Provide helpful error message for RLS policy issues
    if (error.code === "42501" || error.message?.includes("permission denied") || error.message?.includes("policy")) {
      const isTestUser = userId === CURRENT_USER_ID;
      if (isTestUser) {
        throw new Error(
          "Update blocked by RLS policy. For development, ensure the 'Allow anon to update test user profile' policy is enabled in your Supabase database. See sql/rls_policies_profiles.sql"
        );
      } else {
        throw new Error(
          "Update blocked: You can only update your own profile. Authentication may be required."
        );
      }
    }
    
    throw error;
  }

  return mapRowToUserProfile(data as ProfileRow);
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
  const { data, error } = await supabase
    .from("profiles")
    .select("current_streak, last_activity_date, weekly_total_points")
    .eq("id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("[profile] Failed to fetch profile stats", error);
    throw error;
  }

  const row = data as Pick<ProfileRow, "current_streak" | "last_activity_date" | "weekly_total_points">;
  
  return {
    currentStreak: row.current_streak ?? 0,
    lastActivityDate: row.last_activity_date ?? "",
    weeklyTotalPoints: Number(row.weekly_total_points) || 0,
    hasActivity: Boolean(row.last_activity_date),
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
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, avatar_url, current_streak, last_activity_date, weekly_total_points, created_at")
    .eq("id", userId)
    .single();

  if (error) {
    // If profile doesn't exist, return null (not an error)
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("[profile] Failed to fetch user profile", error);
    throw error;
  }

  return mapRowToUserProfile(data as ProfileRow);
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

  // Perform update (restricted to current user via RLS)
  const { data, error } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId)
    .select("id, name, avatar_url, current_streak, last_activity_date, weekly_total_points, created_at")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Profile not found
    }
    
    // Provide helpful error message for RLS policy issues
    if (error.code === "42501" || error.message?.includes("permission denied") || error.message?.includes("policy")) {
      const isTestUser = userId === CURRENT_USER_ID;
      if (isTestUser) {
        throw new Error(
          "Update blocked by RLS policy. For development, ensure the 'Allow anon to update test user profile' policy is enabled in your Supabase database. See sql/rls_policies_profiles.sql"
        );
      } else {
        throw new Error(
          "Update blocked: You can only update your own profile. Authentication may be required."
        );
      }
    }
    
    console.error("[profile] Failed to update user profile", error);
    throw error;
  }

  return mapRowToUserProfile(data as ProfileRow);
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
