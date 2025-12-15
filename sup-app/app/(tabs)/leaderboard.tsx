import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colours } from "../../theme/colours";

export default function LeaderboardScreen() {
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Community Leaderboard</Text>
        <Text style={styles.headerSubtitle}>Global community</Text>
      </View>

      {/* Your Rank Card */}
      <View style={styles.rankCard}>
        <Text style={styles.rankLabel}>Your Rank</Text>
        <Text style={styles.rankNumber}>#—</Text>
        <Text style={styles.rankSubtext}>
          Ranking will appear once you start
        </Text>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Current Streak</Text>
          <Text style={styles.statValue}>—</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Score</Text>
          <Text style={styles.statValue}>—</Text>
        </View>
      </View>

      {/* Leaderboard Header */}
      <Text style={styles.sectionTitle}>Top performers</Text>

      {/* Skeleton List */}
      <View style={styles.list}>
        {[...Array(6)].map((_, i) => (
          <LeaderboardSkeletonRow key={i} />
        ))}
      </View>

      {/* Footer */}
      <Text style={styles.footerText}>
        Scores update every 24 hours • Supporting moms through recovery
      </Text>
    </ScrollView>
  );
}

function LeaderboardSkeletonRow() {
  return (
    <View style={styles.skeletonRow}>
      <View style={styles.skeletonRank} />
      <View style={styles.skeletonAvatar} />

      <View style={styles.skeletonInfo}>
        <View style={styles.skeletonLineShort} />
        <View style={styles.skeletonLineLong} />
      </View>

      <View style={styles.skeletonScore} />
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
  statLabel: {
    color: "#777",
    fontSize: 12,
  },
  statValue: {
    color: colours.primary,
    fontSize: 20,
    marginTop: 4,
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

  /* Skeleton styles */
  skeletonRow: {
    backgroundColor: "white",
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  skeletonRank: {
    width: 20,
    height: 14,
    backgroundColor: "#E5E5EA",
    borderRadius: 4,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E5E5EA",
  },
  skeletonInfo: {
    flex: 1,
    gap: 6,
  },
  skeletonLineShort: {
    width: "40%",
    height: 10,
    backgroundColor: "#E5E5EA",
    borderRadius: 4,
  },
  skeletonLineLong: {
    width: "70%",
    height: 10,
    backgroundColor: "#E5E5EA",
    borderRadius: 4,
  },
  skeletonScore: {
    width: 40,
    height: 12,
    backgroundColor: "#E5E5EA",
    borderRadius: 4,
  },

  footerText: {
    textAlign: "center",
    color: "#777",
    fontSize: 12,
    padding: 16,
  },
});
