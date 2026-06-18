import type { User } from "@/constants/env";

export type FriendRequestStatus = "pending" | "accepted" | "rejected";

export interface FriendRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: FriendRequestStatus;
  createdAt: string;
}

const usernameByUserId = new Map<string, string>();
const userIdByUsername = new Map<string, string>();
const requestsById = new Map<string, FriendRequest>();
const friendshipKeys = new Set<string>();

let reqCounter = 1;

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function makeFriendKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function nextRequestId(): string {
  const id = `fr-${reqCounter}`;
  reqCounter += 1;
  return id;
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

export function getFriendsForUser(userId: string): string[] {
  const friends: string[] = [];

  friendshipKeys.forEach((key) => {
    const [a, b] = key.split("::");
    if (a === userId) friends.push(b);
    if (b === userId) friends.push(a);
  });

  return friends;
}

export function getIncomingPendingRequests(userId: string): FriendRequest[] {
  return Array.from(requestsById.values())
    .filter((request) => request.toUserId === userId && request.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOutgoingPendingRequests(userId: string): FriendRequest[] {
  return Array.from(requestsById.values())
    .filter((request) => request.fromUserId === userId && request.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function sendFriendRequestByUsername(
  fromUserId: string,
  usernameInput: string,
  users: User[]
): { ok: true; request: FriendRequest } | { ok: false; message: string } {
  ensureFriendDirectory(users);

  const username = normalizeUsername(usernameInput);
  if (!username) {
    return { ok: false, message: "Enter a username." };
  }

  const toUserId = userIdByUsername.get(username);
  if (!toUserId) {
    return { ok: false, message: "Username not found." };
  }

  if (toUserId === fromUserId) {
    return { ok: false, message: "You can’t send a request to yourself." };
  }

  if (friendshipKeys.has(makeFriendKey(fromUserId, toUserId))) {
    return { ok: false, message: "You are already friends." };
  }

  const existingPending = Array.from(requestsById.values()).find(
    (request) =>
      request.status === "pending" &&
      ((request.fromUserId === fromUserId && request.toUserId === toUserId) ||
        (request.fromUserId === toUserId && request.toUserId === fromUserId))
  );

  if (existingPending) {
    return { ok: false, message: "A pending request already exists." };
  }

  const request: FriendRequest = {
    id: nextRequestId(),
    fromUserId,
    toUserId,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  requestsById.set(request.id, request);

  return { ok: true, request };
}

export function acceptFriendRequest(
  requestId: string,
  actingUserId: string
): { ok: true } | { ok: false; message: string } {
  const request = requestsById.get(requestId);
  if (!request) {
    return { ok: false, message: "Request not found." };
  }

  if (request.toUserId !== actingUserId) {
    return { ok: false, message: "You can only accept requests sent to you." };
  }

  if (request.status !== "pending") {
    return { ok: false, message: "This request is no longer pending." };
  }

  requestsById.set(requestId, {
    ...request,
    status: "accepted",
  });

  friendshipKeys.add(makeFriendKey(request.fromUserId, request.toUserId));

  return { ok: true };
}

export function rejectFriendRequest(
  requestId: string,
  actingUserId: string
): { ok: true } | { ok: false; message: string } {
  const request = requestsById.get(requestId);
  if (!request) {
    return { ok: false, message: "Request not found." };
  }

  if (request.toUserId !== actingUserId) {
    return { ok: false, message: "You can only reject requests sent to you." };
  }

  if (request.status !== "pending") {
    return { ok: false, message: "This request is no longer pending." };
  }

  requestsById.set(requestId, {
    ...request,
    status: "rejected",
  });

  return { ok: true };
}
