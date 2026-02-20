import { View, Text, StyleSheet, ScrollView, Pressable, Image } from "react-native";
import { router } from "expo-router";
import { useMemo } from "react";
import { colours } from "../../theme/colours";
import { useAuth } from "../../src/contexts/AuthContext";
import {
  analyzeIMUStream,
  type IMUReading,
} from "../../src/services/postureAnalysisService";

// Helper to derive status from stability score
function getPostureStatus(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Needs Attention";
}

// Helper to get encouraging message based on score
function getEncouragingMessage(score: number): string {
  if (score >= 85) return "Keep up the fantastic work!";
  if (score >= 70) return "You're doing great, stay consistent!";
  if (score >= 50) return "Small steps lead to progress!";
  return "Every effort counts, keep going!";
}

export default function HomeScreen() {
  const { logout } = useAuth();

  // Calculate posture stability score from IMU stream (same logic as stats page)
  const postureStats = useMemo(() => {
    try {
      const mockStream = require("../../src/data/mock_imu_stream.json") as IMUReading[];
      const calibration = require("../../src/data/calibration_good_posture.json") as IMUReading[] | null;
      
      if (mockStream?.length > 0) {
        return analyzeIMUStream(mockStream, calibration ?? undefined);
      }
    } catch (e) {
      // No IMU data available
    }
    return null;
  }, []);

  const hasScore = postureStats !== null;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <Image 
              source={require('../../assets/images/logo.jpg')} 
              style={styles.logo}
              resizeMode="contain"
            />
            <View style={styles.headerText}>
              <Text style={styles.greeting}>Welcome back</Text>
              <Text style={styles.subtitle}>
                We're here to support your posture today
              </Text>
            </View>
          </View>
          <Pressable style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {/* Status Card */}
      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Your posture status</Text>
        {hasScore ? (
          <>
            <Text style={styles.statusValue}>{getPostureStatus(postureStats.avgScore)}</Text>
            <Text style={styles.statusHint}>
              {postureStats.goodPosturePercent.toFixed(0)}% good posture · {(postureStats.totalMs / 60000).toFixed(1)} min tracked · {getEncouragingMessage(postureStats.avgScore)}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.statusValue}>Not yet measured</Text>
            <Text style={styles.statusHint}>
              Wear your S'pots to begin tracking
            </Text>
          </>
        )}
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
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  headerText: {
    flex: 1,
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
