import PressFeedback from "@/src/components/ui/PressFeedback";
import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { User } from "../../../constants/env";
import { displayName } from "../../utils/displayName";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  ensureFriendDirectory,
  getUsernameForUser,
  fetchHandlesForUserIds,
  getFriendsForUser,
  getIncomingPendingRequests,
  getOutgoingPendingRequests,
  rejectFriendRequest,
  sendFriendRequestByUsername,
} from "../../services/social/friendService";
import { fetchLeaderboardByStreak } from "../../services/social/leaderboardService";
import { useToast } from "../../contexts/ToastContext";

const PRIMARY_TEXT = "#1D014A";
const { height: SCREEN_H } = Dimensions.get("window");

interface FriendsModalProps {
  visible: boolean;
  onClose: () => void;
  currentUserId: string | null;
}

export default function FriendsModal({ visible, onClose, currentUserId }: FriendsModalProps) {
  const { showToast } = useToast();

  const [users, setUsers] = useState<User[]>([]);
  const [friendUsernameInput, setFriendUsernameInput] = useState("");
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<any[]>([]);
  const [friends, setFriends] = useState<string[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  // Handles for everyone referenced by requests/friends, looked up by id so a
  // person missing from the roster still renders as a name.
  const [handles, setHandles] = useState<Map<string, string>>(new Map());
  // Guards against a fast double-tap on "Send" firing two requests to the
  // same person before the optimistic update re-renders the button as "Cancel".
  const sendingToRef = useRef<Set<string>>(new Set());

  // Load the user roster whenever the modal opens
  useEffect(() => {
    if (!visible) return;
    fetchLeaderboardByStreak()
      .then(setUsers)
      .catch((err) => console.error("[FriendsModal] Failed to load users", err));
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    // Names are resolved by id below, so request and friend data no longer wait
    // on the roster — it only warms the username directory when present.
    if (users.length > 0) ensureFriendDirectory(users);

    if (!currentUserId) {
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setFriends([]);
      return;
    }

    (async () => {
      try {
        const [inc, out, fr] = await Promise.all([
          getIncomingPendingRequests(currentUserId),
          getOutgoingPendingRequests(currentUserId),
          getFriendsForUser(currentUserId),
        ]);
        setIncomingRequests(inc);
        setOutgoingRequests(out);
        setFriends(fr);

        setHandles(
          await fetchHandlesForUserIds([
            ...inc.map((r: any) => r.fromUserId),
            ...out.map((r: any) => r.toUserId),
            ...fr,
          ])
        );
      } catch (err) {
        console.warn("[FriendsModal] friend data load failed", err);
        setIncomingRequests([]);
        setOutgoingRequests([]);
        setFriends([]);
      }
    })();
  }, [visible, users, currentUserId, refreshVersion]);

  const refresh = () => setRefreshVersion((v) => v + 1);

  const normalizedSearch = friendUsernameInput.trim().toLowerCase();
  const incomingFromSet = new Set(incomingRequests.map((r) => r.fromUserId));
  const outgoingToSet = new Set(outgoingRequests.map((r) => r.toUserId));
  const friendSet = new Set(friends);

  const getUserDisplayName = (userId: string): string => {
    const known = handles.get(userId) ?? getUsernameForUser(userId);
    if (known) return known;
    // Never fall back to the raw uuid — it tells the viewer nothing.
    return displayName(users.find((u) => u.id === userId)) || "unknown user";
  };

  const getInitials = (name: string): string =>
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");

  const getFriendStatusForUserId = (
    userId: string
  ): "friend" | "incoming" | "outgoing" | "none" => {
    if (friendSet.has(userId)) return "friend";
    if (incomingFromSet.has(userId)) return "incoming";
    if (outgoingToSet.has(userId)) return "outgoing";
    return "none";
  };

  const getStatusLabel = (status: "friend" | "incoming" | "outgoing" | "none") => {
    if (status === "friend") return "Friends";
    if (status === "incoming") return "Sent you a request";
    if (status === "outgoing") return "Request sent";
    return "Not connected";
  };

  const searchMatches =
    normalizedSearch.length === 0
      ? []
      : users
          .filter(
            (user) =>
              (currentUserId ? user.id !== currentUserId : true) &&
              displayName(user).toLowerCase().startsWith(normalizedSearch)
          )
          .slice(0, 5);

  const handleSendRequest = async (toUser: User) => {
    if (!currentUserId) {
      showToast("You must be signed in to send requests", "error");
      return;
    }
    if (sendingToRef.current.has(toUser.id)) return; // already sending, ignore the repeat tap
    const currentUsername = getUsernameForUser(currentUserId);
    if (!currentUsername) {
      showToast("Couldn't determine your username", "error");
      return;
    }
    sendingToRef.current.add(toUser.id);

    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      fromUserId: currentUserId,
      toUserId: toUser.id,
      status: "pending",
      createdAt: null,
    };
    setOutgoingRequests((prev) => [optimistic, ...prev]);

    const result = await sendFriendRequestByUsername(currentUserId, displayName(toUser), users);
    sendingToRef.current.delete(toUser.id);
    if (!result.ok) {
      setOutgoingRequests((prev) => prev.filter((r) => r.id !== tempId));
    }
    showToast(result.ok ? "Request sent" : result.message, result.ok ? "success" : "error");
    if (result.ok) refresh();
  };

  const handleAcceptRequest = async (requestId: string) => {
    if (!currentUserId) {
      showToast("You must be signed in to accept requests", "error");
      return;
    }
    const pending = incomingRequests.find((r) => r.id === requestId);
    const fromId = pending?.fromUserId ?? null;
    if (fromId) {
      setIncomingRequests((prev) => prev.filter((r) => r.id !== requestId));
      setFriends((prev) => (prev.includes(fromId) ? prev : [...prev, fromId]));
    }

    const result = await acceptFriendRequest(requestId, currentUserId);
    if (!result.ok && fromId) {
      setIncomingRequests((prev) => [
        { id: requestId, fromUserId: fromId, toUserId: currentUserId, status: "pending", createdAt: null },
        ...prev,
      ]);
      setFriends((prev) => prev.filter((id) => id !== fromId));
    }
    showToast(result.ok ? "New bestie unlocked" : result.message, result.ok ? "success" : "error");
    refresh();
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!currentUserId) {
      showToast("You must be signed in to cancel requests", "error");
      return;
    }
    const pending = outgoingRequests.find((r) => r.id === requestId);
    if (pending) {
      setOutgoingRequests((prev) => prev.filter((r) => r.id !== requestId));
    }

    const result = await cancelFriendRequest(requestId, currentUserId);
    if (!result.ok && pending) {
      setOutgoingRequests((prev) => [pending, ...prev]);
    }
    showToast(result.ok ? "Request cancelled" : result.message, result.ok ? "success" : "error");
    refresh();
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!currentUserId) {
      showToast("You must be signed in to reject requests", "error");
      return;
    }
    const pending = incomingRequests.find((r) => r.id === requestId);
    if (pending) {
      setIncomingRequests((prev) => prev.filter((r) => r.id !== requestId));
    }

    const result = await rejectFriendRequest(requestId, currentUserId);
    if (!result.ok && pending) {
      setIncomingRequests((prev) => [pending, ...prev]);
    }
    showToast(result.ok ? "Request declined" : result.message, result.ok ? "success" : "error");
    refresh();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        {/* Backdrop: a plain Pressable sibling behind the sheet, so it only
            catches taps in the empty area above the sheet and never wraps
            (and therefore never steals touches from) the ScrollView below. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Friends</Text>
            <PressFeedback onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={PRIMARY_TEXT} />
            </PressFeedback>
          </View>

          <ScrollView
            showsVerticalScrollIndicator
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
                <View style={styles.searchRow}>
                  <Ionicons name="search" size={16} color="#9A9A9A" style={{ marginRight: 6 }} />
                  <TextInput
                    value={friendUsernameInput}
                    onChangeText={setFriendUsernameInput}
                    placeholder="Add friend by username"
                    autoCapitalize="none"
                    style={styles.searchInput}
                    placeholderTextColor="#9A9A9A"
                  />
                </View>

                {normalizedSearch.length > 0 && (
                  <View style={styles.searchResults}>
                    {searchMatches.length === 0 ? (
                      <Text style={styles.emptyText}>No users found.</Text>
                    ) : (
                      searchMatches.map((user) => {
                        const status = getFriendStatusForUserId(user.id);
                        return (
                          <View key={user.id} style={styles.userRow}>
                            <View style={styles.avatar}>
                              <Text style={styles.avatarText}>{getInitials(displayName(user))}</Text>
                            </View>
                            <View style={styles.userInfo}>
                              <Text style={styles.userName}>{displayName(user)}</Text>
                              <Text style={styles.userStatus}>{getStatusLabel(status)}</Text>
                            </View>

                            {status === "none" ? (
                              <PressFeedback
                                style={[styles.actionBtn, styles.acceptBtn]}
                                onPress={() => handleSendRequest(user)}
                              >
                                <Text style={styles.actionTextLight}>Send</Text>
                              </PressFeedback>
                            ) : status === "incoming" ? (
                              <PressFeedback
                                style={[styles.actionBtn, styles.acceptBtn]}
                                onPress={() => {
                                  const pending = incomingRequests.find(
                                    (r) => r.fromUserId === user.id
                                  );
                                  if (pending) handleAcceptRequest(pending.id);
                                }}
                              >
                                <Text style={styles.actionTextLight}>Accept</Text>
                              </PressFeedback>
                            ) : status === "outgoing" ? (
                              <PressFeedback
                                style={[styles.actionBtn, styles.rejectBtn]}
                                onPress={() => {
                                  const pending = outgoingRequests.find(
                                    (r) => r.toUserId === user.id
                                  );
                                  if (pending) handleCancelRequest(pending.id);
                                }}
                              >
                                <Text style={styles.actionText}>Cancel</Text>
                              </PressFeedback>
                            ) : null}
                          </View>
                        );
                      })
                    )}
                  </View>
                )}

                <Text style={styles.blockTitle}>Incoming Requests</Text>
                {incomingRequests.length === 0 ? (
                  <Text style={styles.emptyText}>No incoming requests.</Text>
                ) : (
                  incomingRequests.map((request) => (
                    <View key={request.id} style={styles.userRow}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {getInitials(getUserDisplayName(request.fromUserId))}
                        </Text>
                      </View>
                      <View style={styles.userInfo}>
                        <Text style={styles.userName}>{getUserDisplayName(request.fromUserId)}</Text>
                        <Text style={styles.userStatus}>Incoming friend request</Text>
                      </View>
                      <PressFeedback
                        style={[styles.actionBtn, styles.acceptBtn]}
                        onPress={() => handleAcceptRequest(request.id)}
                      >
                        <Text style={styles.actionTextLight}>Accept</Text>
                      </PressFeedback>
                      <PressFeedback
                        style={[styles.actionBtn, styles.rejectBtn]}
                        onPress={() => handleRejectRequest(request.id)}
                      >
                        <Text style={styles.actionText}>Reject</Text>
                      </PressFeedback>
                    </View>
                  ))
                )}

                <Text style={styles.blockTitle}>Pending Sent</Text>
                {outgoingRequests.length === 0 ? (
                  <Text style={styles.emptyText}>No pending outgoing requests.</Text>
                ) : (
                  outgoingRequests.map((request) => (
                    <View key={request.id} style={styles.userRow}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {getInitials(getUserDisplayName(request.toUserId))}
                        </Text>
                      </View>
                      <View style={styles.userInfo}>
                        <Text style={styles.userName}>{getUserDisplayName(request.toUserId)}</Text>
                        <Text style={styles.userStatus}>Request sent</Text>
                      </View>
                      <PressFeedback
                        style={[styles.actionBtn, styles.rejectBtn]}
                        onPress={() => handleCancelRequest(request.id)}
                      >
                        <Text style={styles.actionText}>Cancel</Text>
                      </PressFeedback>
                    </View>
                  ))
                )}

                <Text style={styles.blockTitle}>Your Friends</Text>
                {friends.length === 0 ? (
                  <Text style={styles.emptyText}>No friends yet.</Text>
                ) : (
                  friends.map((friendId) => (
                    <View key={friendId} style={styles.userRow}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{getInitials(getUserDisplayName(friendId))}</Text>
                      </View>
                      <View style={styles.userInfo}>
                        <Text style={styles.userName}>{getUserDisplayName(friendId)}</Text>
                        <Text style={styles.userStatus}>Friends</Text>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 28,
    maxHeight: SCREEN_H * 0.85,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  scrollArea: {
    // Bounds the scrollable area so the sheet never exceeds maxHeight,
    // while still leaving room to actually see it's scrollable.
    maxHeight: SCREEN_H * 0.85 - 90,
  },
  scrollContent: {
    paddingBottom: 12,
  },
  sheetTitle: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 18,
    color: PRIMARY_TEXT,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(63, 36, 131, 0.06)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
  },
  searchResults: {
    marginBottom: 8,
  },
  blockTitle: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 13,
    color: PRIMARY_TEXT,
    opacity: 0.8,
    marginTop: 14,
    marginBottom: 6,
  },
  emptyText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: PRIMARY_TEXT,
    opacity: 0.5,
    marginBottom: 4,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#AB99FA",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 13,
    color: "#FFFFFF",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: PRIMARY_TEXT,
  },
  userStatus: {
    fontFamily: "Agrandir-Regular",
    fontSize: 12,
    color: PRIMARY_TEXT,
    opacity: 0.6,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    marginLeft: 6,
  },
  acceptBtn: {
    backgroundColor: "#6DC96D",
  },
  rejectBtn: {
    backgroundColor: "rgba(236, 85, 94, 0.12)",
  },
  actionText: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 12,
    color: "#EC555E",
  },
  actionTextLight: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 12,
    color: "#FFFFFF",
  },
});