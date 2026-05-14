import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  TextInput,
} from "react-native";
import { useEffect, useState, useRef, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { colours } from "../../theme/colours";
// import leaderboardData from "../../src/data/leaderboard.json";
import { fetchLeaderboardByStreak } from "../../src/services/social/leaderboardService";
import { CURRENT_USER_ID, type User } from "../../constants/env";
import { MOCK_POSTURE_DATA } from "../../src/data/mockPostureData";
import { hasGoodPosture, updateStreak } from "../../src/services/posture/streakService";
import ProfileModal from "../../src/components/modals/ProfileModal";
import {
  subscribeToProfileUpdates,
  userProfileToUser,
} from "../../src/services/user/profileService";
import {
  acceptFriendRequest,
  ensureFriendDirectory,
  getUsernameForUser,
  getFriendsForUser,
  getIncomingPendingRequests,
  getOutgoingPendingRequests,
  rejectFriendRequest,
  sendFriendRequestByUsername,
} from "../../src/services/social/friendService";
import { UserSupsonaAvatar } from "../../src/components/supsona/SupsonaAvatar";
import { useToast } from "../../src/contexts/ToastContext";

// Animated number component for smooth transitions
function AnimatedNumber({ value, style }: { value: number; style?: any }) {
  const [displayValue, setDisplayValue] = useState(value);
  const animationRef = useRef<any>(null);

  useEffect(() => {
    // Clear any existing animation
    if (animationRef.current) {
      clearInterval(animationRef.current);
    }

    const startValue = displayValue;
    const endValue = value;
    const duration = 250; // 250ms animation
    const startTime = Date.now();

    if (startValue === endValue) return;

    animationRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease out animation
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeProgress;
      
      setDisplayValue(Math.round(current));

      if (progress >= 1) {
        setDisplayValue(endValue);
        if (animationRef.current) {
          clearInterval(animationRef.current);
          animationRef.current = null;
        }
      }
    }, 16); // ~60fps

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [value]);

  return <Text style={style}>{displayValue}</Text>;
}

export default function LeaderboardScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { showToast } = useToast();

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, [])
  );

  const [showInfo, setShowInfo] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [sortMode, setSortMode] = useState<"streak" | "weekly">("streak");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [friendUsernameInput, setFriendUsernameInput] = useState("");
  const [friendStateVersion, setFriendStateVersion] = useState(0);

  // For prototype: using Feb 27, 2026 as "today"
  const MOCK_TODAY = new Date("2026-02-27");

  const loadLeaderboard = useCallback(() => {
    fetchLeaderboardByStreak()
      .then(setUsers)
      .catch((err) => console.error("Failed to load leaderboard", err));
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToProfileUpdates((updatedProfile) => {
      const updatedUser = userProfileToUser(updatedProfile);

      setUsers((prev) => {
        const exists = prev.some((u) => u.id === updatedUser.id);
        if (!exists) return prev;
        return prev.map((u) => (u.id === updatedUser.id ? { ...u, ...updatedUser } : u));
      });

      setSelectedUser((prev) =>
        prev && prev.id === updatedUser.id ? { ...prev, ...updatedUser } : prev
      );
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (users.length === 0) return;
    ensureFriendDirectory(users);

    const currentUsername = getUsernameForUser(CURRENT_USER_ID);
    const hasAnyRequests =
      getIncomingPendingRequests(CURRENT_USER_ID).length > 0 ||
      getOutgoingPendingRequests(CURRENT_USER_ID).length > 0;

    if (!hasAnyRequests && currentUsername) {
      const demoSenders = users
        .filter((user) => user.id !== CURRENT_USER_ID)
        .slice(0, 2);

      demoSenders.forEach((sender) => {
        sendFriendRequestByUsername(sender.id, currentUsername, users);
      });
    }

    setFriendStateVersion((prev) => prev + 1);
  }, [users]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  useFocusEffect(
    useCallback(() => {
      loadLeaderboard();
    }, [loadLeaderboard])
  );

  const sortedUsers = [...users].sort((a, b) => {
    if (sortMode === "streak") {
      return b.currentStreak - a.currentStreak;
    }
    return b.weeklyTotalPoints - a.weeklyTotalPoints;
  });

  const [hasGoodPostureToday, setHasGoodPostureToday] = useState(false);
  const [currentUserWithStreak, setCurrentUserWithStreak] =
    useState<User | null>(null);

  useEffect(() => {
    // NOTE: do NOT depend on `sortedUsers` here; it's a new array every render.
    const baseUser = users.find((user) => user.id === CURRENT_USER_ID);
    if (!baseUser) {
      return;
    }

    const todayIso = MOCK_TODAY.toISOString().slice(0, 10); // Use mock date for prototype
    const todayData = MOCK_POSTURE_DATA.find((data) => {
      return data.userId === CURRENT_USER_ID && data.date === todayIso;
    });

    if (!todayData) {
      setCurrentUserWithStreak(baseUser);
      setHasGoodPostureToday(false);
      return;
    }

    const goodToday = hasGoodPosture(todayData);
    setHasGoodPostureToday(goodToday);

    // For prototype: Don't recalculate streak, use data from leaderboard.json
    setCurrentUserWithStreak(baseUser);
  }, [users]);

  const currentUser = currentUserWithStreak ??
    users.find((user) => user.id === CURRENT_USER_ID);
  const currentUserRank = currentUser
    ? sortedUsers.findIndex((user) => user.id === CURRENT_USER_ID) + 1
    : 0;

  const handleUserPress = (user: User) => {
    setSelectedUser(user);
    setShowProfileModal(true);
  };

  const handleCloseProfile = () => {
    setShowProfileModal(false);
    setSelectedUser(null);
  };

  const handleSaveProfile = async (updatedUser: User) => {
    // Update local state with the updated user from profileService
    if (selectedUser) {
      const updatedUsers = users.map((u) =>
        u.id === selectedUser.id ? updatedUser : u
      );
      setUsers(updatedUsers);
      setSelectedUser(updatedUser);
      showToast("Profile glow-up saved", "success");
    }
  };

  const refreshFriendState = () => {
    setFriendStateVersion((prev) => prev + 1);
  };

  const handleAcceptRequest = (requestId: string) => {
    const result = acceptFriendRequest(requestId, CURRENT_USER_ID);
    showToast(result.ok ? "New bestie unlocked" : result.message, result.ok ? "success" : "error");
    refreshFriendState();
  };

  const handleRejectRequest = (requestId: string) => {
    const result = rejectFriendRequest(requestId, CURRENT_USER_ID);
    showToast(result.ok ? "Request declined" : result.message, result.ok ? "success" : "error");
    refreshFriendState();
  };

  const incomingRequests = getIncomingPendingRequests(CURRENT_USER_ID);
  const outgoingRequests = getOutgoingPendingRequests(CURRENT_USER_ID);
  const friends = getFriendsForUser(CURRENT_USER_ID);
  const currentUsername = getUsernameForUser(CURRENT_USER_ID) ?? "Unknown User";
  const normalizedSearch = friendUsernameInput.trim().toLowerCase();

  const incomingFromSet = new Set(incomingRequests.map((request) => request.fromUserId));
  const outgoingToSet = new Set(outgoingRequests.map((request) => request.toUserId));
  const friendSet = new Set(friends);

  const getUserDisplayName = (userId: string): string => {
    return users.find((user) => user.id === userId)?.name ?? userId;
  };

  const getUserById = (userId: string): User | undefined => {
    return users.find((user) => user.id === userId);
  };

  const getInitials = (name: string): string => {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  };

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
              user.id !== CURRENT_USER_ID &&
              user.name.toLowerCase().startsWith(normalizedSearch)
          )
          .slice(0, 5);

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Community Leaderboard</Text>
        <Text style={styles.headerSubtitle}>Global Community</Text>
      </View>

      {/* Your Rank Card */}
      <View style={styles.rankCard}>
        <Text style={styles.rankLabel}>
          Your {sortMode === "streak" ? "Streak" : "Weekly Points"} Rank
        </Text>
        {currentUserRank === 0 ? (
          <Text style={styles.rankNumber}>—</Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={styles.rankNumber}>#</Text>
            <AnimatedNumber value={currentUserRank} style={styles.rankNumber} />
          </View>
        )}
        <Text style={styles.rankSubtext}>
          Keep going! You&apos;re doing great
        </Text>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <Pressable 
          style={styles.statCard}
          onPress={() => setShowInfo(!showInfo)}
        >
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Current Streak</Text>
            <Text style={styles.helpIcon}>?</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <AnimatedNumber value={currentUser?.currentStreak ?? 0} style={styles.statValue} />
            <Text style={styles.statValue}>
              {" "}{currentUser?.currentStreak === 1 ? "day" : "days"} ⚡
            </Text>
          </View>
        </Pressable>

        <Pressable 
          style={styles.statCard}
          onPress={() => setShowInfo(!showInfo)}
        >
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Weekly Total Points</Text>
            <Text style={styles.helpIcon}>?</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <AnimatedNumber value={currentUser?.weeklyTotalPoints ?? 0} style={styles.statValue} />
            <Text style={styles.statValue}> pts</Text>
          </View>
        </Pressable>
      </View>

      {/* Info Card */}
      {showInfo && (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Understanding your stats</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoBullet}>⚡</Text>
            <Text style={styles.infoText}>
              <Text style={styles.infoBold}>Current Streak:</Text> Consecutive days wearing your S&apos;pots
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoBullet}>📊</Text>
            <Text style={styles.infoText}>
              <Text style={styles.infoBold}>Weekly Total Points:</Text> Sum of your daily average scores over the past week
            </Text>
          </View>
        </View>
      )}

      {/* Leaderboard Header + Sort Toggle */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          Top performers ranked by{" "}
          {sortMode === "streak" ? "streak" : "weekly points"}
        </Text>

        <View style={styles.sortToggle}>
          <Pressable
            style={[
              styles.sortButton,
              sortMode === "streak" && styles.sortButtonActive,
            ]}
            onPress={() => setSortMode("streak")}
          >
            <Text
              style={[
                styles.sortButtonText,
                sortMode === "streak" && styles.sortButtonTextActive,
              ]}
            >
              Streak
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.sortButton,
              sortMode === "weekly" && styles.sortButtonActive,
            ]}
            onPress={() => setSortMode("weekly")}
          >
            <Text
              style={[
                styles.sortButtonText,
                sortMode === "weekly" && styles.sortButtonTextActive,
              ]}
            >
              Weekly Pts
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Leaderboard List */}
      <View style={styles.list}>
        {sortedUsers.map((user, index) => (
          <LeaderboardRow
            key={user.id}
            rank={index + 1}
            user={user}
            isCurrentUser={user.id === CURRENT_USER_ID}
            onPress={() => handleUserPress(user)}
          />
        ))}
      </View>

      {/* Friends */}
      <View style={styles.friendSection}>
        <Text style={styles.friendTitle}>Friends</Text>
       
        <View style={styles.friendAddRow}>
          <TextInput
            value={friendUsernameInput}
            onChangeText={setFriendUsernameInput}
            placeholder="Add friend by username"
            autoCapitalize="none"
            style={styles.friendInput}
            placeholderTextColor="#9A9A9A"
          />
        </View>

        {normalizedSearch.length > 0 && (
          <View style={styles.searchResultsContainer}>
            {searchMatches.length === 0 ? (
              <Text style={styles.friendEmptyText}>No users found.</Text>
            ) : (
              searchMatches.map((user) => {
                const status = getFriendStatusForUserId(user.id);
                return (
                  <View key={user.id} style={styles.friendUserRow}>
                    <View style={styles.friendUserAvatar}>
                      <Text style={styles.friendUserAvatarText}>{getInitials(user.name)}</Text>
                    </View>
                    <View style={styles.friendUserInfo}>
                      <Text style={styles.friendUserName}>{user.name}</Text>
                      <Text style={styles.friendUserStatus}>{getStatusLabel(status)}</Text>
                    </View>

                    {status === "none" ? (
                      <Pressable
                        style={[styles.requestActionBtn, styles.acceptBtn]}
                        onPress={() => {
                          const result = sendFriendRequestByUsername(
                            CURRENT_USER_ID,
                            user.name,
                            users
                          );
                          showToast(
                            result.ok ? "Request sent" : result.message,
                            result.ok ? "success" : "error"
                          );
                          if (result.ok) refreshFriendState();
                        }}
                      >
                        <Text style={[styles.requestActionText, styles.requestActionTextLight]}>Send</Text>
                      </Pressable>
                    ) : status === "incoming" ? (
                      <Pressable
                        style={[styles.requestActionBtn, styles.acceptBtn]}
                        onPress={() => {
                          const pending = incomingRequests.find((request) => request.fromUserId === user.id);
                          if (!pending) return;
                          handleAcceptRequest(pending.id);
                        }}
                      >
                        <Text style={[styles.requestActionText, styles.requestActionTextLight]}>Accept</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        )}

        <Text style={styles.friendBlockTitle}>Incoming Requests</Text>
        {incomingRequests.length === 0 ? (
          <Text style={styles.friendEmptyText}>No incoming requests.</Text>
        ) : (
          incomingRequests.map((request) => (
            <View key={request.id} style={styles.requestRow}>
              <View style={styles.friendUserAvatar}>
                <Text style={styles.friendUserAvatarText}>
                  {getInitials(getUserDisplayName(request.fromUserId))}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.requestName}>{getUserDisplayName(request.fromUserId)}</Text>
                <Text style={styles.requestMeta}>Incoming friend request</Text>
              </View>
              <Pressable
                style={[styles.requestActionBtn, styles.acceptBtn]}
                onPress={() => handleAcceptRequest(request.id)}
              >
                <Text style={[styles.requestActionText, styles.requestActionTextLight]}>Accept</Text>
              </Pressable>
              <Pressable
                style={[styles.requestActionBtn, styles.rejectBtn]}
                onPress={() => handleRejectRequest(request.id)}
              >
                <Text style={styles.requestActionText}>Reject</Text>
              </Pressable>
            </View>
          ))
        )}

        <Text style={styles.friendBlockTitle}>Pending Sent</Text>
        {outgoingRequests.length === 0 ? (
          <Text style={styles.friendEmptyText}>No pending outgoing requests.</Text>
        ) : (
          outgoingRequests.map((request) => (
            <View key={request.id} style={styles.friendUserRow}>
              <View style={styles.friendUserAvatar}>
                <Text style={styles.friendUserAvatarText}>
                  {getInitials(getUserDisplayName(request.toUserId))}
                </Text>
              </View>
              <View style={styles.friendUserInfo}>
                <Text style={styles.friendUserName}>{getUserDisplayName(request.toUserId)}</Text>
                <Text style={styles.friendUserStatus}>Request sent</Text>
              </View>
            </View>
          ))
        )}

        <Text style={styles.friendBlockTitle}>Your Friends</Text>
        {friends.length === 0 ? (
          <Text style={styles.friendEmptyText}>No friends yet.</Text>
        ) : (
          friends.map((friendId) => (
            <View key={friendId} style={styles.friendUserRow}>
              <View style={styles.friendUserAvatar}>
                <Text style={styles.friendUserAvatarText}>
                  {getInitials(getUserDisplayName(friendId))}
                </Text>
              </View>
              <View style={styles.friendUserInfo}>
                <Text style={styles.friendUserName}>{getUserDisplayName(friendId)}</Text>
                <Text style={styles.friendUserStatus}>Friends</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Profile Modal */}
      <ProfileModal
        visible={showProfileModal}
        user={selectedUser}
        isCurrentUser={selectedUser?.id === CURRENT_USER_ID}
        onClose={handleCloseProfile}
        onSave={handleSaveProfile}
      />

      {/* Footer */}
      <Text style={styles.footerText}>
        Scores update every 24 hours • Supporting moms through recovery
      </Text>
    </ScrollView>
    </Animated.View>
  );
}

interface LeaderboardRowProps {
  rank: number;
  user: User;
  isCurrentUser: boolean;
  onPress: () => void;
}

function LeaderboardRow({ rank, user, isCurrentUser, onPress }: LeaderboardRowProps) {
  return (
    <Pressable 
      style={[styles.row, isCurrentUser && styles.currentUserRow]} 
      onPress={onPress}
    >
      <View style={styles.rankContainer}>
        <Text style={[styles.rank, isCurrentUser && styles.currentUserText]}>
          #{rank}
        </Text>
      </View>
      
      <View style={[styles.avatar, isCurrentUser && styles.currentUserAvatar]}>
        <UserSupsonaAvatar
          avatar={user.avatar}
          name={user.name}
          size={40}
          style={styles.avatar}
          textStyle={styles.avatarText}
          defaultAvatarBackgroundColor="white"
        />
      </View>

      <View style={styles.info}>
        <Text style={[styles.name, isCurrentUser && styles.currentUserText]}>
          {user.name}
          {isCurrentUser && " (You)"}
        </Text>
        <Text style={styles.stats}>
          ⚡ {user.currentStreak} {user.currentStreak === 1 ? "day" : "days"} • Points: {user.weeklyTotalPoints} pts
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EDE9FF",
  },

  header: {
    backgroundColor: colours.primary,
    padding: 20,
    paddingTop: 56,
  },
  headerTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "600",
  },
  headerSubtitle: {
    color: "white",
    opacity: 0.8,
    marginTop: 4,
  },

  rankCard: {
    backgroundColor: colours.primary,
    margin: 16,
    padding: 20,
    borderRadius: 20,
  },
  rankLabel: {
    color: "white",
    opacity: 0.9,
  },
  rankNumber: {
    color: "white",
    fontSize: 36,
    fontWeight: "700",
    marginVertical: 4,
  },
  rankSubtext: {
    color: "white",
    opacity: 0.8,
    fontSize: 12,
  },

  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "white",
    padding: 16,
    borderRadius: 14,
  },
  statHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statLabel: {
    color: "#777",
    fontSize: 12,
  },
  helpIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colours.primary,
    color: "white",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
  },
  statValue: {
    color: colours.primary,
    fontSize: 20,
    marginTop: 4,
  },

  infoCard: {
    backgroundColor: "white",
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    borderLeftWidth: 3,
    borderLeftColor: colours.primary,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colours.primary,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  infoBullet: {
    fontSize: 14,
    marginRight: 8,
    marginTop: 1,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: "#555",
    lineHeight: 18,
  },
  infoBold: {
    fontWeight: "600",
    color: "#333",
  },

  sectionHeader: {
    marginTop: 24,
    marginHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionTitle: {
    flex: 1,
    fontWeight: "600",
    color: "#444",
  },
  sortToggle: {
    flexDirection: "row",
    backgroundColor: "#E5E5EA",
    borderRadius: 999,
    padding: 2,
  },
  sortButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  sortButtonActive: {
    backgroundColor: "white",
  },
  sortButtonText: {
    fontSize: 11,
    color: "#666",
  },
  sortButtonTextActive: {
    color: colours.primary,
    fontWeight: "600",
  },

  list: {
    padding: 16,
    gap: 12,
  },

  row: {
    backgroundColor: "white",
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rankContainer: {
    position: "relative",
    alignItems: "center",
    width: 34,
  },
  rankChangeIndicator: {
    position: "absolute",
    top: 0,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rankChangeUp: {
    backgroundColor: "#E8F5E9",
    borderWidth: 1.5,
    borderColor: "#4CAF50",
  },
  rankChangeDown: {
    backgroundColor: "#FFEBEE",
    borderWidth: 1.5,
    borderColor: "#F44336",
  },
  rankChangeText: {
    fontSize: 8,
    fontWeight: "700",
  },
  currentUserRow: {
    backgroundColor: colours.primarySoft,
    borderWidth: 2,
    borderColor: colours.primary,
  },
  rank: {
    width: 30,
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  currentUserText: {
    color: colours.primary,
    fontWeight: "700",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E5E5EA",
    justifyContent: "center",
    alignItems: "center",
  },
  currentUserAvatar: {
    backgroundColor: colours.primary,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  stats: {
    fontSize: 12,
    color: "#777",
    marginTop: 2,
  },

  footerText: {
    textAlign: "center",
    color: "#777",
    fontSize: 12,
    padding: 16,
  },
  friendSection: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "white",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  friendTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
  },
  friendSubtitle: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  friendAddRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  friendInput: {
    flex: 1,
    backgroundColor: "#F6F6FA",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#333",
  },
  friendFeedback: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: "600",
  },
  searchResultsContainer: {
    backgroundColor: "#F8F8FC",
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  friendUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F8F8FC",
    borderRadius: 10,
    padding: 10,
  },
  friendUserAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E5E5EA",
    alignItems: "center",
    justifyContent: "center",
  },
  friendUserAvatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#555",
  },
  friendUserInfo: {
    flex: 1,
  },
  friendUserName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  friendUserStatus: {
    fontSize: 12,
    color: "#777",
    marginTop: 1,
  },
  friendBlockTitle: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "700",
    color: "#444",
  },
  friendEmptyText: {
    fontSize: 12,
    color: "#777",
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F8F8FC",
    borderRadius: 10,
    padding: 10,
  },
  requestName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  requestMeta: {
    fontSize: 12,
    color: "#777",
    marginTop: 2,
  },
  requestActionBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  acceptBtn: {
    backgroundColor: colours.primary,
  },
  rejectBtn: {
    backgroundColor: "#E5E5EA",
  },
  requestActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#333",
  },
  requestActionTextLight: {
    color: "white",
  },
  friendListItem: {
    fontSize: 12,
    color: "#555",
  },
});
