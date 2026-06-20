import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Dimensions } from "react-native";
import Svg, { Defs, Filter, FeGaussianBlur, Ellipse } from "react-native-svg";
import { router } from "expo-router";
import { useFonts } from "expo-font";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { colours } from "../../theme/colours";
import { useAuth } from "../../src/contexts/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import { type User } from "../../constants/env";
import {
  fetchCurrentUserProfileWithStats,
  subscribeToProfileUpdates,
  userProfileToUser,
} from "../../src/services/user/profileService";
import ProfileModal from "../../src/components/modals/ProfileModal";
import { UserSupsonaAvatar } from "../../src/components/supsona/SupsonaAvatar";
import { useToast } from "../../src/contexts/ToastContext";
import CoachingSetupModal from "../../src/components/onboarding/CoachingSetupModal";
import { fetchCurrentBehaviorProfile } from "../../src/services/user/behaviorProfileService";

import { useIMUContext } from "../../src/contexts/IMUContext";
import { useSessionStats } from "../../src/hooks/useSessionStats";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

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

/**
 * Three large, soft, Gaussian-blurred ellipses sitting behind all content.
 * Uses react-native-svg's feGaussianBlur filter, which is the closest
 * equivalent to the `filter: blur(25px)` values from the Figma file —
 * plain RN Views/StyleSheet can't produce a true blur on their own.
 */
function BackgroundBlobs() {
  return (
    <Svg
      width={SCREEN_W}
      height={SCREEN_H}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        <Filter id="blur1" x="-50%" y="-50%" width="200%" height="200%">
          <FeGaussianBlur in="SourceGraphic" stdDeviation="25" />
        </Filter>
        <Filter id="blur2" x="-50%" y="-50%" width="200%" height="200%">
          <FeGaussianBlur in="SourceGraphic" stdDeviation="25" />
        </Filter>
        <Filter id="blur3" x="-50%" y="-50%" width="200%" height="200%">
          <FeGaussianBlur in="SourceGraphic" stdDeviation="25" />
        </Filter>
      </Defs>

      {/* Pink ellipse — upper right */}
      <Ellipse
        cx={SCREEN_W * 0.78}
        cy={SCREEN_H * 0.12}
        rx={190}
        ry={190}
        fill="rgba(225, 163, 175, 0.62)"
        filter="url(#blur1)"
      />

      {/* Purple ellipse — left, mid height */}
      <Ellipse
        cx={SCREEN_W * 0.08}
        cy={SCREEN_H * 0.45}
        rx={155}
        ry={155}
        fill="rgba(179, 163, 225, 0.62)"
        filter="url(#blur2)"
      />

      {/* Cyan ellipse — lower right */}
      <Ellipse
        cx={SCREEN_W * 0.85}
        cy={SCREEN_H * 0.82}
        rx={178}
        ry={178}
        fill="rgba(163, 218, 225, 0.62)"
        filter="url(#blur3)"
      />
    </Svg>
  );
}

export default function HomeScreen() {
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-TextBold": require("../../assets/fonts/Agrandir-TextBold.otf"),
  });


  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { showToast } = useToast();
  const { isAuthenticated, userId } = useAuth();

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

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCoachingSetupModal, setShowCoachingSetupModal] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  const loadProfile = () => {
    fetchCurrentUserProfileWithStats()
      .then((profile) => {
        setCurrentUser(profile ? userProfileToUser(profile) : null);
      })
      .catch((err) => {
        console.error("[HomeScreen] Failed to load user profile", err);
      })
      .finally(() => setIsLoadingProfile(false));
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setCurrentUser(null);
      setShowProfileModal(false);
      setShowCoachingSetupModal(false);
      setIsLoadingProfile(true);
      return;
    }

    loadProfile();

    fetchCurrentBehaviorProfile()
      .then((profile) => {
        setShowCoachingSetupModal(profile == null);
      })
      .catch((err) => {
        console.warn("[HomeScreen] Skipping behavior profile check", err);
        setShowCoachingSetupModal(false);
      });
  }, [isAuthenticated]);

  useEffect(() => {
    const unsubscribe = subscribeToProfileUpdates((updatedProfile) => {
      if (!userId) return;
      if (updatedProfile.id !== userId) return;
      setCurrentUser(userProfileToUser(updatedProfile));
    });

    return unsubscribe;
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;

      // Refetch when returning from e.g. Supsona Builder so avatar updates
      loadProfile();
    }, [isAuthenticated])
  );

  const handleProfilePress = () => {
    setShowProfileModal(true);
  };

  const handleCloseProfile = () => {
    setShowProfileModal(false);
  };

  const handleSaveProfile = async (updatedUser: User) => {
    setCurrentUser(updatedUser);
    showToast("Profile glow-up saved", "success");
  };

  const handleCoachingSetupComplete = () => {
    setShowCoachingSetupModal(false);
    showToast("Coaching setup saved", "success");
  };

  const handleCoachingSetupSkip = () => {
    setShowCoachingSetupModal(false);
    showToast("Using default coaching setup", "success");
  };

  const handleSettingsPress = () => {
    router.push("/settings");
  };

  const { posture, bothConnected, isNeutralCalibrated } = useIMUContext();
  const currentState = (posture?.state ?? "upright") as any;
  const isTracking = bothConnected && isNeutralCalibrated;

  const { sessionStats, sessionTotalMs } = useSessionStats(isTracking ? currentState : undefined);

  const MIN_MS = 5 * 60_000; // 5 minutes
  const liveAvgScore = sessionTotalMs > 0 ? Math.round(((sessionStats.upright ?? 0) / sessionTotalMs) * 100) : 0;
  const liveGoodPosturePercent = sessionTotalMs > 0 ? ((sessionStats.upright ?? 0) / sessionTotalMs) * 100 : 0;

  const [displaySessionTotalMs, setDisplaySessionTotalMs] = useState<number>(sessionTotalMs);
  const [displayAvgScore, setDisplayAvgScore] = useState<number>(liveAvgScore);
  const [displayGoodPosturePercent, setDisplayGoodPosturePercent] = useState<number>(liveGoodPosturePercent);

  const hasData = displaySessionTotalMs > 0;
  const hasEnoughData = displaySessionTotalMs >= MIN_MS;

  if (!fontsLoaded) {
    return null;
  }

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Wordmark + icons */}
        <View style={styles.topBar}>
          <Text style={styles.logo}>
            s<Text style={styles.logoApostrophe}>’</Text>up
          </Text>
          <View style={styles.headerButtons}>
            <Pressable style={styles.iconButton} onPress={() => router.push("/sensor-setup")}>
              <Ionicons name="hardware-chip-outline" size={22} color="#3F2483" />
            </Pressable>
            <Pressable style={styles.iconButton} onPress={handleSettingsPress}>
              <Ionicons name="settings-outline" size={22} color="#3F2483" />
            </Pressable>
          </View>
        </View>

        {/* Greeting bubble */}
        <View style={[styles.bubble, styles.bubbleLeft]}>
          <Text style={styles.bubbleText}>
            {currentUser?.name ? `${currentUser.name}!` : "hey!"}{"\n"}you're back :)
          </Text>
        </View>

        {/* Profile / stats bubble */}
        <Pressable style={[styles.bubble, styles.bubbleLeft]} onPress={handleProfilePress}>
          <View style={styles.profileContent}>
            <View style={styles.avatarWrapper}>
              <UserSupsonaAvatar
                avatar={currentUser?.avatar}
                name={currentUser?.name ?? ""}
                size={56}
                style={styles.avatar}
                textStyle={styles.avatarText}
                defaultAvatarBackgroundColor="white"
              />
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

        {/* Status bubble */}
        <View style={[styles.bubble, styles.bubbleLeft]}>
          <Text style={styles.bubbleLabel}>Your posture status</Text>
          {hasEnoughData ? (
            <>
              <Text style={styles.bubbleHeadline}>{getPostureStatus(displayAvgScore)}</Text>
              <Text style={styles.bubbleSubtext}>
                {Math.round(displayGoodPosturePercent)}% good posture · {(displaySessionTotalMs / 60000).toFixed(2)} min tracked{"\n"}
                {getEncouragingMessage(displayAvgScore)}
              </Text>
            </>
          ) : hasData ? (
            <>
              <Text style={styles.bubbleHeadline}>Not enough data</Text>
              <Text style={styles.bubbleSubtext}>Use your s'pots to get insights</Text>
            </>
          ) : (
            <>
              <Text style={styles.bubbleHeadline}>Not yet measured</Text>
              <Text style={styles.bubbleSubtext}>
                Wear your s'pots for 30 minutes to get your new plan.
              </Text>
            </>
          )}
        </View>

        {/* Reminder bubble */}
        <View style={[styles.bubble, styles.bubbleLeft, styles.bubbleLeftLast]}>
          <Text style={styles.bubbleLabel}>Gentle reminder</Text>
          <Text style={styles.bubbleSubtext}>
            Try rolling your shoulders back and down while breathing slowly.
          </Text>
          <Pressable style={styles.promptButton} onPress={() => router.push("/posture-tip")}>
            <Text style={styles.promptButtonText}>view posture tip</Text>
          </Pressable>
        </View>

        {/* Action bubble — right aligned like "see all data >>" */}
        <Pressable
          style={[styles.bubble, styles.bubbleRight]}
          onPress={() => router.push("/stats")}
        >
          <Text style={styles.bubbleActionText}>see all data {'>>'}</Text>
        </Pressable>

        <Pressable
          style={[styles.bubble, styles.bubbleRight]}
          onPress={() => router.push("/leaderboard")}
        >
          <Text style={styles.bubbleActionText}>community {'>>'}</Text>
        </Pressable>

        {/* Reassurance */}
        <Text style={styles.footer}>
          Recovery takes time. Small adjustments make a difference.
        </Text>

        <ProfileModal
          visible={showProfileModal}
          user={currentUser}
          isCurrentUser={true}
          onClose={handleCloseProfile}
          onSave={handleSaveProfile}
          loading={isLoadingProfile}
        />

        <CoachingSetupModal
          visible={showCoachingSetupModal}
          onComplete={handleCoachingSetupComplete}
        />
      </ScrollView>
    </Animated.View>
  );
}

const PRIMARY_TEXT = "#3F2483";

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  logo: {
    color: PRIMARY_TEXT,
    fontFamily: "Agrandir-TextBold",
    fontSize: 50,
  },
  // The apostrophe glyph in Agrandir doesn't match the brand mark, so it's
  // rendered in Arial per the Figma spec while the rest of the wordmark
  // stays in Agrandir.
  logoApostrophe: {
    fontFamily: "Arial",
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: 20,
  },

  // Chat-bubble card shared styles
  bubble: {
    backgroundColor: "rgba(255,255,255,0.55)",
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 20,
    borderRadius: 28,
  },
  bubbleLeft: {
    alignSelf: "stretch",
  },
  // Only the last white bubble in the stack gets the sharp "tail" corner.
  bubbleLeftLast: {
    borderBottomLeftRadius: 6,
  },
  bubbleRight: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(143, 122, 230, 0.55)",
  },
  bubbleText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 24,
    lineHeight: 30,
    color: PRIMARY_TEXT,
    fontWeight: "600",
  },
  bubbleLabel: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.8,
    marginBottom: 6,
  },
  bubbleHeadline: {
    fontFamily: "Agrandir-Regular",
    fontSize: 26,
    fontWeight: "700",
    color: PRIMARY_TEXT,
    marginBottom: 6,
  },
  bubbleSubtext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.85,
    lineHeight: 20,
  },
  bubbleActionText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },

  promptButton: {
    alignSelf: "flex-start",
    marginTop: 14,
    backgroundColor: "transparent",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: PRIMARY_TEXT,
  },
  promptButtonText: {
    fontFamily: "Agrandir-Regular",
    color: PRIMARY_TEXT,
    fontSize: 13,
    fontWeight: "600",
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
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: colours.primary,
    fontSize: 22,
    fontWeight: "700",
  },
  editBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: PRIMARY_TEXT,
  },
  editBadgeText: {
    fontSize: 11,
    color: PRIMARY_TEXT,
  },
  profileInfo: {
    flex: 1,
    gap: 8,
  },
  userName: {
    fontFamily: "Agrandir-Regular",
    fontSize: 20,
    fontWeight: "700",
    color: PRIMARY_TEXT,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statBadge: {
    backgroundColor: "rgba(63, 36, 131, 0.12)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  statBadgeText: {
    fontFamily: "Agrandir-Regular",
    color: PRIMARY_TEXT,
    fontSize: 12,
    fontWeight: "600",
  },

  footer: {
    fontFamily: "Agrandir-Regular",
    textAlign: "center",
    color: PRIMARY_TEXT,
    opacity: 0.7,
    fontSize: 12,
    padding: 24,
  },
});