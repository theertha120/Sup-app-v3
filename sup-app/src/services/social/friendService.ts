import { supabase } from "@/src/lib/supabase";
import type { User } from "@/constants/env";

export type FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

export interface FriendRequest {
  id: string;
  fromUserId: string | null;
  toUserId: string | null;
  status: FriendRequestStatus | null;
  createdAt: string | null;
  respondedAt?: string | null;
}

const usernameByUserId = new Map<string, string>();
const userIdByUsername = new Map<string, string>();

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function ensureFriendDirectory(users: User[]): void {
  users.forEach((user) => {
    const normalized = normalizeUsername(user.name);
    if (!normalized) return;

    usernameByUserId.set(user.id, user.name);
    if (!userIdByUsername.has(normalized)) {
      userIdByUsername.set(normalized, user.id);
    }
  });
}

export function getUsernameForUser(userId: string): string | undefined {
  return usernameByUserId.get(userId);
}

// Get friends for a user (accepted relationships)
export async function getFriendsForUser(userId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("friend_requests")
      .select("from_user_id, to_user_id, status")
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
      .in("status", ["accepted"]);

    if (error) throw error;
    if (!data) return [];

    const friends: string[] = [];
    data.forEach((row: any) => {
      const from = row.from_user_id;
      const to = row.to_user_id;
      if (from === userId && to) friends.push(to);
      if (to === userId && from) friends.push(from);
    });

    return friends;
  } catch (err) {
    console.warn("[friend] getFriendsForUser failed", err);
    return [];
  }
}

export async function getIncomingPendingRequests(userId: string): Promise<FriendRequest[]> {
  try {
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, from_user_id, to_user_id, status, created_at, responded_at")
      .eq("to_user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      fromUserId: row.from_user_id ?? null,
      toUserId: row.to_user_id ?? null,
      status: row.status ?? null,
      createdAt: row.created_at ?? null,
      respondedAt: row.responded_at ?? null,
    } as FriendRequest));
  } catch (err) {
    console.warn("[friend] getIncomingPendingRequests failed", err);
    return [];
  }
}

export async function getOutgoingPendingRequests(userId: string): Promise<FriendRequest[]> {
  try {
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, from_user_id, to_user_id, status, created_at, responded_at")
      .eq("from_user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      fromUserId: row.from_user_id ?? null,
      toUserId: row.to_user_id ?? null,
      status: row.status ?? null,
      createdAt: row.created_at ?? null,
      respondedAt: row.responded_at ?? null,
    } as FriendRequest));
  } catch (err) {
    console.warn("[friend] getOutgoingPendingRequests failed", err);
    return [];
  }
}

async function resolveUserIdByUsername(username: string): Promise<string | null> {
  const normalized = normalizeUsername(username);
  const cached = userIdByUsername.get(normalized);
  if (cached) return cached;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name")
      .ilike("name", username)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    const id = (data as any).id as string;
    userIdByUsername.set(normalized, id);
    usernameByUserId.set(id, (data as any).name as string);
    return id;
  } catch (err) {
    console.warn("[friend] resolveUserIdByUsername failed", err);
    return null;
  }
}

export async function sendFriendRequestByUsername(
  fromUserId: string,
  usernameInput: string,
  users?: User[]
): Promise<{ ok: true; request: FriendRequest } | { ok: false; message: string }> {
  if (users) ensureFriendDirectory(users);

  const username = normalizeUsername(usernameInput);
  if (!username) return { ok: false, message: "enter a username." };

  const toUserId = await resolveUserIdByUsername(username);
  if (!toUserId) return { ok: false, message: "username not found." };
  if (toUserId === fromUserId) return { ok: false, message: "you can’t send a request to yourself." };

  try {
    // Check for existing pending or accepted between the two users
    const { data: existing, error: exErr } = await supabase
      .from("friend_requests")
      .select("id, status, from_user_id, to_user_id")
      .or(
        `and(from_user_id.eq.${fromUserId},to_user_id.eq.${toUserId}),and(from_user_id.eq.${toUserId},to_user_id.eq.${fromUserId}))`
      )
      .limit(1);

    if (exErr) throw exErr;
    if (existing && existing.length > 0) {
      const row = existing[0] as any;
      if (row.status === "accepted") return { ok: false, message: "you are already friends." };
      if (row.status === "pending") return { ok: false, message: "a pending request already exists." };
    }

    const { data, error } = await supabase
      .from("friend_requests")
      .insert({ from_user_id: fromUserId, to_user_id: toUserId, status: "pending" })
      .select("id, from_user_id, to_user_id, status, created_at, responded_at")
      .single();

    if (error) throw error;

    const row = data as any;
    const mapped = {
      id: row.id,
      fromUserId: row.from_user_id ?? null,
      toUserId: row.to_user_id ?? null,
      status: row.status ?? null,
      createdAt: row.created_at ?? null,
      respondedAt: row.responded_at ?? null,
    } as FriendRequest;
    return { ok: true, request: mapped };
  } catch (err: any) {
    console.warn("[friend] sendFriendRequest failed", err);
    return { ok: false, message: err?.message ?? "failed to send request" };
  }
}

export async function acceptFriendRequest(
  requestId: string,
  actingUserId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { data: req, error: fetchErr } = await supabase
      .from("friend_requests")
      .select("id, to_user_id, status")
      .eq("id", requestId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!req) return { ok: false, message: "request not found." };
    if (req.to_user_id !== actingUserId) return { ok: false, message: "you can only accept requests sent to you." };
    if (req.status !== "pending") return { ok: false, message: "this request is no longer pending." };

    const { error } = await supabase
      .from("friend_requests")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", requestId);

    if (error) throw error;
    return { ok: true };
  } catch (err: any) {
    console.warn("[friend] acceptFriendRequest failed", err);
    return { ok: false, message: err?.message ?? "failed to accept request" };
  }
}

export async function rejectFriendRequest(
  requestId: string,
  actingUserId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { data: req, error: fetchErr } = await supabase
      .from("friend_requests")
      .select("id, to_user_id, status")
      .eq("id", requestId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!req) return { ok: false, message: "request not found." };
    if (req.to_user_id !== actingUserId) return { ok: false, message: "you can only reject requests sent to you." };
    if (req.status !== "pending") return { ok: false, message: "this request is no longer pending." };

    const { error } = await supabase
      .from("friend_requests")
      .update({ status: "rejected", responded_at: new Date().toISOString() })
      .eq("id", requestId);

    if (error) throw error;
    return { ok: true };
  } catch (err: any) {
    console.warn("[friend] rejectFriendRequest failed", err);
    return { ok: false, message: err?.message ?? "failed to reject request" };
  }
}
