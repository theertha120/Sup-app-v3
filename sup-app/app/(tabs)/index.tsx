import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { colours } from "../../theme/colours";
import { useAuth } from "../../src/contexts/AuthContext";

export default function HomeScreen() {
  const { logout } = useAuth();

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>Welcome back</Text>
            <Text style={styles.subtitle}>
              We're here to support your posture today
            </Text>
          </View>
          <Pressable style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {/* Status Card */}
      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Your posture status</Text>
        <Text style={styles.statusValue}>Not yet measured</Text>
        <Text style={styles.statusHint}>
          Wear your S’pots to begin tracking
        </Text>
      </View>

      {/* Prompt Card */}
      <View style={styles.promptCard}>
        <Text style={styles.promptTitle}>Gentle reminder</Text>
        <Text style={styles.promptText}>
          Try rolling your shoulders back and down while breathing slowly.
        </Text>

        <Pressable
          style={styles.promptButton}
          onPress={() => router.push("/modal")}
        >
          <Text style={styles.promptButtonText}>View posture tip</Text>
        </Pressable>
      </View>

      {/* Quick Actions */}
      <View style={styles.actions}>
        <Pressable
          style={styles.actionCard}
          onPress={() => router.push("/stats")}
        >
          <Text style={styles.actionTitle}>View stats</Text>
          <Text style={styles.actionSub}>Track your progress</Text>
        </Pressable>

        <Pressable
          style={styles.actionCard}
          onPress={() => router.push("/leaderboard")}
        >
          <Text style={styles.actionTitle}>Community</Text>
          <Text style={styles.actionSub}>See how others are doing</Text>
        </Pressable>
      </View>

      {/* Reassurance */}
      <Text style={styles.footer}>
        Recovery takes time. Small adjustments make a difference.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F6F6FA",
  },

  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  greeting: {
    fontSize: 24,
    fontWeight: "600",
    color: "#222",
  },
  subtitle: {
    marginTop: 6,
    color: "#666",
  },
  logoutButton: {
    backgroundColor: colours.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  logoutText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
  },

  statusCard: {
    backgroundColor: colours.primary,
    marginHorizontal: 16,
    padding: 24,
    borderRadius: 24,
  },
  statusTitle: {
    color: "white",
    opacity: 0.9,
  },
  statusValue: {
    color: "white",
    fontSize: 28,
    fontWeight: "700",
    marginVertical: 6,
  },
  statusHint: {
    color: "white",
    opacity: 0.8,
    fontSize: 12,
  },

  promptCard: {
    backgroundColor: "white",
    margin: 16,
    padding: 20,
    borderRadius: 20,
  },
  promptTitle: {
    fontWeight: "600",
    marginBottom: 6,
  },
  promptText: {
    color: "#555",
    marginBottom: 16,
  },
  promptButton: {
    alignSelf: "flex-start",
    backgroundColor: colours.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  promptButtonText: {
    color: "white",
    fontSize: 14,
  },

  actions: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 12,
  },
  actionCard: {
    flex: 1,
    backgroundColor: "white",
    padding: 16,
    borderRadius: 16,
  },
  actionTitle: {
    fontWeight: "600",
    color: "#333",
  },
  actionSub: {
    fontSize: 12,
    color: "#777",
    marginTop: 4,
  },

  footer: {
    textAlign: "center",
    color: "#777",
    fontSize: 12,
    padding: 24,
  },
});
