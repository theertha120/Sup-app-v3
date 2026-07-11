import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Dimensions } from "react-native";
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
  updateCurrentUserProfile,
} from "../../src/services/user/profileService";
import ProfileModal from "../../src/components/modals/ProfileModal";
import { UserSupsonaAvatar } from "../../src/components/supsona/SupsonaAvatar";
import { useToast } from "../../src/contexts/ToastContext";
import CoachingSetupModal from "../../src/components/onboarding/CoachingSetupModal";
import { fetchCurrentBehaviorProfile } from "../../src/services/user/behaviorProfileService";
import BackgroundBlobs from "./backgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";
import {
  fetchDailyPosturePair,
  type DailyPosturePair,
  type DailyPostureRow,
} from "../../src/services/posture/postureSyncService";
import { usePostureInsight } from "@/src/hooks/usePostureInsight";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

export default function HomeScreen() {

  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { showToast } = useToast();
  const { isAuthenticated, userId } = useAuth();

  const TODAY_KEY = "2026-07-07"; // UPDATE TO CURRENT DATE LATER!
  const [dailyPair, setDailyPair] = useState<DailyPosturePair>({ today: null, previous: null });
  const [isLoadingDaily, setIsLoadingDaily] = useState(true);

  const loadDailyPosture = useCallback(() => {
    if (!userId) return;
    setIsLoadingDaily(true);
    fetchDailyPosturePair(userId, TODAY_KEY)
      .then(setDailyPair)
      .catch((err) => console.error("[HomeScreen] fetchDailyPosturePair failed", err))
      .finally(() => setIsLoadingDaily(false));
  }, [userId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setDailyPair({ today: null, previous: null });
      return;
    }
    loadDailyPosture();
  }, [isAuthenticated, loadDailyPosture]);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      loadDailyPosture();
    }, [isAuthenticated, loadDailyPosture])
  );

  const { today } = dailyPair;
  const stateTotals = today?.stateTotals ?? {};
  console.log("[HomeScreen] stateTotals:", stateTotals);

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
  const { response, isLoading, isError, fallback } = usePostureInsight({
    promptType: "home",
    isDataReady: !isLoadingDaily,
    uprightMinutesDaily:      Math.round((stateTotals?.upright ?? 0) / 60000),
    slouchedMinutesDaily:     Math.round((stateTotals?.slouched ?? 0) / 60000),
    severeMinutesDaily:       Math.round((stateTotals?.severe ?? 0) / 60000),
    forwardLeanMinutesDaily:  Math.round((stateTotals?.forward_lean ?? 0) / 60000),
    tiltedLeftMinutesDaily:   Math.round((stateTotals?.tilted_left ?? 0) / 60000),
    tiltedRightMinutesDaily:  Math.round((stateTotals?.tilted_right ?? 0) / 60000),
    supScoreDaily:            today?.supScore ?? 0,
    totalTrackedMinutesDaily: Math.round((today?.totalDeskMs ?? 0) / 60000),
  });

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
    showToast("profile glow-up saved", "success");
  };

  const handleCoachingSetupComplete = () => {
    setShowCoachingSetupModal(false);
    showToast("coaching setup saved", "success");
  };

  const handleCoachingSetupSkip = () => {
    setShowCoachingSetupModal(false);
    showToast("using default coaching setup", "success");
  };

  const handleUsernameChange = async (newName: string) => {
    try {
      const updatedProfile = await updateCurrentUserProfile({ name: newName });
      if (updatedProfile) {
        setCurrentUser(userProfileToUser(updatedProfile));
      }
      showToast("username updated", "success");
    } catch (err) {
      console.error("[HomeScreen] Failed to update username", err);
      showToast("couldn't update username, try again", "error");
    }
  };

  if (!fontsLoaded) {
    return null;
  }

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Wordmark + icons */}
        <HeaderBar />

        <View style={styles.bubblesContainer}>
          {/* Greeting bubble */}
          <View style={[styles.bubble, styles.bubbleLeft, styles.shadow]}>
            <Text style={styles.bubbleText}>
              {currentUser?.name ? `${currentUser.name}!` : "hey!"}{"\n"}you're back :)
            </Text>
          </View>

          {/* Status bubble */}
          <View style={[styles.bubble, styles.bubbleLeft, styles.bubbleLeftLast, styles.shadow]}>
            <Text style={styles.bubbleHeadline}>
              s'kipper says:
            </Text>
            <Text style={styles.bubbleSubtext}>
              {isLoading
                ? "pop on your s'pot today and give me a hot second..."
                : isError
                ? fallback
                : response}
            </Text>
          </View>

          {/* Action bubble — navigate to daily summary */}
          <Pressable
            style={[styles.bubble, styles.bubbleRight, styles.shadow]}
            onPress={() => router.push("/daily")}
          >
            <Text style={styles.bubbleActionText}>see today's data {'>>'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Animated.View>
  );
}

const PRIMARY_TEXT = "#1D014A";

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  bubblesContainer: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 40,
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
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 50,
  },
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

  bubble: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 20,
    borderRadius: 28,
  },
  shadow: {
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 5,
  },
  bubbleLeft: {
    alignSelf: "stretch",
  },
  bubbleLeftLast: {
    borderBottomLeftRadius: 6,
  },
  bubbleRight: {
    alignSelf: "flex-end",
    backgroundColor: "#AB99FA",
  },
  bubbleText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 24,
    lineHeight: 30,
    color: PRIMARY_TEXT,
    fontWeight: "600",
  },
  bubbleHeadline: {
    fontFamily: "Agrandir-Regular",
    fontSize: 22,
    fontWeight: "700",
    color: PRIMARY_TEXT,
    marginBottom: 8,
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