import type { User } from "@/constants/env";

/** The minimum a value needs for `displayName` to read it. */
type NameLike = Pick<User, "name"> & { username?: string | null };

/**
 * What the UI should call someone.
 *
 * Usernames are the displayed identity, but accounts created before the
 * `profiles.username` column existed have none, so this falls back to the first
 * name rather than showing a blank. Always prefer this over reading `username`
 * or `name` directly at a display site.
 */
export function displayName(user: NameLike | null | undefined, fallback = ""): string {
  if (!user) return fallback;
  const handle = user.username?.trim();
  if (handle) return handle;
  return user.name?.trim() || fallback;
}

/** Usernames compare case-insensitively, so "Sam" and "sam" are the same handle. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}
