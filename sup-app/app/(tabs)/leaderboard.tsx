import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useState } from "react";
import { colours } from "../../theme/colours";

// Mock leaderboard data (sorted by streak only)
const MOCK_USERS = [
  { id: 1, name: "Sarah Chen", streak: 45, weeklyAvg: 7.2, isCurrentUser: false },
  { id: 2, name: "Mike Johnson", streak: 38, weeklyAvg: 6.8, isCurrentUser: false },
  { id: 3, name: "Emma Wilson", streak: 0, weeklyAvg: 0, isCurrentUser: false },
  { id: 4, name: "Test User", streak: 28, weeklyAvg: 5.9, isCurrentUser: true },
  { id: 5, name: "Lisa Anderson", streak: 25, weeklyAvg: 5.7, isCurrentUser: false },
  { id: 6, name: "David Lee", streak: 22, weeklyAvg: 5.3, isCurrentUser: false },
  { id: 7, name: "Rachel Kim", streak: 18, weeklyAvg: 4.8, isCurrentUser: false },
  { id: 8, name: "Tom Brown", streak: 15, weeklyAvg: 4.5, isCurrentUser: false },
];

export default function LeaderboardScreen() {
  const [showInfo, setShowInfo] = useState(false);

  // Sort users by streak (descending)
  const sortedUsers = [...MOCK_USERS].sort((a, b) => b.streak - a.streak);

  const currentUser = sortedUsers.find(user => user.isCurrentUser);
  const currentUserRank = sortedUsers.findIndex(user => user.isCurrentUser) + 1;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Community Leaderboard</Text>
        <Text style={styles.headerSubtitle}>Global Community</Text>
      </View>

      {/* Your Rank Card */}
      <View style={styles.rankCard}>
        <Text style={styles.rankLabel}>Your Rank</Text>
        <Text style={styles.rankNumber}>#{currentUserRank}</Text>
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
          <Text style={styles.statValue}>{currentUser?.streak} days ⚡</Text>
        </Pressable>

        <Pressable 
          style={styles.statCard}
          onPress={() => setShowInfo(!showInfo)}
        >
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Weekly Average</Text>
            <Text style={styles.helpIcon}>?</Text>
          </View>
          <Text style={styles.statValue}>{currentUser?.weeklyAvg} hrs/day</Text>
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
              <Text style={styles.infoBold}>Weekly Average:</Text> Your average daily good posture hours over the past week
            </Text>
          </View>
        </View>
      )}

      {/* Leaderboard Header */}
      <Text style={styles.sectionTitle}>Top performers ranked by streak</Text>

      {/* Leaderboard List */}
      <View style={styles.list}>
        {sortedUsers.map((user, index) => (
          <LeaderboardRow
            key={user.id}
            rank={index + 1}
            name={user.name}
            streak={user.streak}
            weeklyAvg={user.weeklyAvg}
            isCurrentUser={user.isCurrentUser}
          />
        ))}
      </View>

      {/* Footer */}
      <Text style={styles.footerText}>
        Scores update every 24 hours • Supporting moms through recovery
      </Text>
    </ScrollView>
  );
}

interface LeaderboardRowProps {
  rank: number;
  name: string;
  streak: number;
  weeklyAvg: number;
  isCurrentUser: boolean;
}

function LeaderboardRow({ rank, name, streak, weeklyAvg, isCurrentUser }: LeaderboardRowProps) {
  return (
    <View style={[styles.row, isCurrentUser && styles.currentUserRow]}>
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
          ⚡ {streak} days • Average: {weeklyAvg} hrs/day
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F6F6FA",
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

  sectionTitle: {
    marginTop: 24,
    marginHorizontal: 16,
    fontWeight: "600",
    color: "#444",
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
