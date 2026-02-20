import { View, Text, StyleSheet, ScrollView, Pressable, Image, Animated } from "react-native";
import { router } from "expo-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { colours } from "../../theme/colours";
import { useAuth } from "../../src/contexts/AuthContext";
import { CURRENT_USER_ID, type User } from "../../constants/env";
import {
  fetchCurrentUserProfileWithStats,
  userProfileToUser,
} from "../../src/services/profileService";
import ProfileModal from "../../src/components/ProfileModal";
import { useMemo } from "react";
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
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, [fadeAnim])
  );

  const { logout } = useAuth();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  useEffect(() => {
    // Fetch current user profile using profileService
    fetchCurrentUserProfileWithStats()
      .then((profile) => {
        setCurrentUser(userProfileToUser(profile));
      })
      .catch((err) => {
        console.error("[HomeScreen] Failed to load user profile", err);
        // Fallback: try to get user from leaderboard if profileService fails
        // This handles cases where auth might not be fully set up yet
      })
      .finally(() => setIsLoadingProfile(false));
  }, []);

  const handleProfilePress = () => {
    setShowProfileModal(true);
  };

  const handleCloseProfile = () => {
    setShowProfileModal(false);
  };

  const handleSaveProfile = async (updatedUser: User) => {
    // Update local state with the updated user from profileService
    setCurrentUser(updatedUser);
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

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
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Enhanced Header Section */}
      <View style={styles.headerContainer}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>Welcome back!</Text>
            <Text style={styles.subtitle}>We're here to support your posture today</Text>
          </View>
          <Pressable style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>

        {/* User Profile Card */}
        <Pressable style={styles.profileCard} onPress={handleProfilePress}>
          <View style={styles.profileContent}>
            <View style={styles.avatarWrapper}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {currentUser ? getInitials(currentUser.name) : "?"}
                </Text>
              </View>
              <View style={styles.editBadge}>
                <Text style={styles.editBadgeText}>✎</Text>
              </View>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.userName}>{currentUser?.name || "Loading..."}</Text>
              <View style={styles.statsRow}>
                <View style={styles.statBadge}>
                  <Text style={styles.statBadgeText}>⚡ {currentUser?.currentStreak || 0} day streak</Text>
                </View>
                <View style={styles.statBadge}>
                  <Text style={styles.statBadgeText}>🏆 {currentUser?.weeklyTotalPoints || 0} pts</Text>
                </View>
              </View>
            </View>
          </View>
        </Pressable>
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

      {/* Profile Modal */}
      <ProfileModal
        visible={showProfileModal}
        user={currentUser}
        isCurrentUser={true}
        onClose={handleCloseProfile}
        onSave={handleSaveProfile}
        loading={isLoadingProfile}
      />
    </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EDE9FF",
  },

  headerContainer: {
    backgroundColor: "white",
    paddingBottom: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 28,
    fontWeight: "700",
    color: "#222",
  },
  subtitle: {
    marginTop: 4,
    color: "#666",
    fontSize: 14,
    lineHeight: 20,
  },
  logoutButton: {
    backgroundColor: "#F6F6FA",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  logoutText: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },

  profileCard: {
    backgroundColor: colours.primary,
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 20,
    shadowColor: colours.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  profileContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatarWrapper: {
    position: "relative",
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  avatarText: {
    color: colours.primary,
    fontSize: 24,
    fontWeight: "700",
  },
  editBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: colours.primary,
  },
  editBadgeText: {
    fontSize: 12,
    color: colours.primary,
  },
  profileInfo: {
    flex: 1,
    gap: 8,
  },
  userName: {
    fontSize: 22,
    fontWeight: "700",
    color: "white",
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  statBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },

  statusCard: {
    backgroundColor: colours.primary,
    marginHorizontal: 16,
    marginTop: 24,
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
