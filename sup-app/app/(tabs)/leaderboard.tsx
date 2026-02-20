import { View, Text, StyleSheet, ScrollView, Pressable, Animated } from "react-native";
import { useEffect, useState, useRef, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { colours } from "../../theme/colours";
// import leaderboardData from "../../src/data/leaderboard.json";
import { fetchLeaderboardByStreak } from "../../src/services/leaderboardService";
import { CURRENT_USER_ID, type User } from "../../constants/env";
import { MOCK_POSTURE_DATA } from "../../src/data/mockPostureData";
import { hasGoodPosture, updateStreak } from "../../src/services/streakService";
import ProfileModal from "../../src/components/ProfileModal";
import { userProfileToUser } from "../../src/services/profileService";

export default function LeaderboardScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    fetchLeaderboardByStreak()
      .then(setUsers)
      .catch((err) => console.error("Failed to load leaderboard", err));
  }, []);

  const sortedUsers = [...users].sort((a, b) => {
    if (sortMode === "streak") {
      return b.currentStreak - a.currentStreak;
    }
    return b.weeklyTotalPoints - a.weeklyTotalPoints;
  });

  // Rank is always based on streak, regardless of current display filter.
  const streakSortedUsers = [...users].sort(
    (a, b) => b.currentStreak - a.currentStreak
  );

  const [hasGoodPostureToday, setHasGoodPostureToday] = useState(false);
  const [currentUserWithStreak, setCurrentUserWithStreak] =
    useState<User | null>(null);

  useEffect(() => {
    // NOTE: do NOT depend on `sortedUsers` here; it's a new array every render.
    const baseUser = users.find((user) => user.id === CURRENT_USER_ID);
    if (!baseUser) {
      return;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
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

    const updatedUser = updateStreak(baseUser, todayData);
    setCurrentUserWithStreak(updatedUser);
  }, [users]);

  const currentUser = currentUserWithStreak ??
    users.find((user) => user.id === CURRENT_USER_ID);
  const currentUserRank = currentUser
    ? streakSortedUsers.findIndex((user) => user.id === CURRENT_USER_ID) + 1
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
    }
  };

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
        <Text style={styles.rankLabel}>Your Streak Rank</Text>
        <Text style={styles.rankNumber}>{currentUserRank === 0 ? "—" : `#${currentUserRank}`}</Text>
        <Text style={styles.rankSubtext}>
          Keep going! You're doing great
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
          <Text style={styles.statValue}>
            {currentUser?.currentStreak ?? "0"}{" "}
            {currentUser?.currentStreak === 1 ? "day" : "days"} ⚡
          </Text>
        </Pressable>

        <Pressable 
          style={styles.statCard}
          onPress={() => setShowInfo(!showInfo)}
        >
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Weekly Total Points</Text>
            <Text style={styles.helpIcon}>?</Text>
          </View>
          <Text style={styles.statValue}>
            {currentUser?.weeklyTotalPoints ?? "0"} pts
          </Text>
        </Pressable>
      </View>

      {/* Info Card */}
      {showInfo && (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Understanding your stats</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoBullet}>⚡</Text>
            <Text style={styles.infoText}>
              <Text style={styles.infoBold}>Current Streak:</Text> Consecutive days wearing your S'pots
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
          {hasGoodPostureToday ? " • Good posture today ✅" : ""}
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
            name={user.name}
            streak={user.currentStreak}
            weeklyPoints={user.weeklyTotalPoints}
            isCurrentUser={user.id === CURRENT_USER_ID}
            onPress={() => handleUserPress(user)}
          />
        ))}
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
  name: string;
  streak: number;
  weeklyPoints: number;
  isCurrentUser: boolean;
  onPress: () => void;
}

function LeaderboardRow({ rank, name, streak, weeklyPoints, isCurrentUser, onPress }: LeaderboardRowProps) {
  return (
    <Pressable 
      style={[styles.row, isCurrentUser && styles.currentUserRow]} 
      onPress={onPress}
    >
      <Text style={[styles.rank, isCurrentUser && styles.currentUserText]}>
        #{rank}
      </Text>
      
      <View style={[styles.avatar, isCurrentUser && styles.currentUserAvatar]}>
        <Text style={styles.avatarText}>
          {name.split(' ').map(n => n[0]).join('')}
        </Text>
      </View>

      <View style={styles.info}>
        <Text style={[styles.name, isCurrentUser && styles.currentUserText]}>
          {name}
          {isCurrentUser && " (You)"}
        </Text>
        <Text style={styles.stats}>
          ⚡ {streak} {streak === 1 ? 'day' : 'days'} • Points: {weeklyPoints} pts
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
});
