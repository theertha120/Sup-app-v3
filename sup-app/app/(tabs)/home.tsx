import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Dimensions, Image } from "react-native";
import { router } from "expo-router";
import { useFonts } from "expo-font";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { displayName } from "@/src/utils/displayName";
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
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";
import { fetchDailyAiSummary } from "@/src/services/ai/dailyAiSummaryService";
import { logNavbarClick } from "@/src/services/analytics/navbarClickService";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { InfoButton, InfoModal, InfoModalEntry } from "@/src/components/ui/InfoModal";
import { SKIPPER_DISCLAIMER } from "@/src/services/ai/aiProvider";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ─── Animation timing constants ──────────────────────────────────────────────
const BUBBLE_POP_DURATION_MS   = 600;  // how long each bubble takes to pop in
const GREETING_DELAY_MS        = 400;  // delay before greeting bubble starts
const TYPEWRITER_CHAR_DELAY_MS = 150;   // delay between each typed character
const STATUS_BUBBLE_DELAY_MS   = 400;  // delay after typewriter finishes before status bubble
const ACTION_BUBBLE_DELAY_MS   = 450;  // delay after status bubble before action bubble

const SKIPPER_INFO: Record<string, InfoModalEntry> = {
  skipper: SKIPPER_DISCLAIMER,
};
// ─────────────────────────────────────────────────────────────────────────────

const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
  // return `2026-07-20`; // hardcoded for testing
};

const getPreviousDateKey = (dateKey: string) => {
  const date = new Date(dateKey + "T12:00:00"); // noon avoids DST edge cases
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
};

export default function HomeScreen() {

  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { showToast } = useToast();
  const { isAuthenticated, userId } = useAuth();
  const { tutorialStep, setTutorialStep, dismissTutorial } = useTutorial();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // ─── Bubble entrance animations ────────────────────────────────────────────
  const greetingBubbleAnim = useRef(new Animated.Value(0)).current;
  const statusBubbleAnim   = useRef(new Animated.Value(0)).current;
  const actionBubbleAnim   = useRef(new Animated.Value(0)).current;

  // Typewriter state
  const [typedName, setTypedName] = useState("");
  const [nameFullyTyped, setNameFullyTyped] = useState(false);
  const typewriterRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequenceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAnimatedRef = useRef(false);

  const popIn = (anim: Animated.Value) =>
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 9,
    });

  const runEntrySequence = useCallback((name: string) => {
    // Reset
    greetingBubbleAnim.setValue(0);
    statusBubbleAnim.setValue(0);
    actionBubbleAnim.setValue(0);
    setTypedName("");
    setNameFullyTyped(false);

    // 1. Greeting bubble pops in
    sequenceRef.current = setTimeout(() => {
      popIn(greetingBubbleAnim).start(() => {

        // 2. Type out the name character by character
        const chars = name ? `${name}!` : "hey!";
        let i = 0;
        const typeNext = () => {
          if (i <= chars.length) {
            setTypedName(chars.slice(0, i));
            i++;
            typewriterRef.current = setTimeout(typeNext, TYPEWRITER_CHAR_DELAY_MS);
          } else {
            setNameFullyTyped(true);

            // 3. Status bubble pops in after typewriter finishes
            sequenceRef.current = setTimeout(() => {
              popIn(statusBubbleAnim).start(() => {

                // 4. Action bubble pops in after status bubble
                sequenceRef.current = setTimeout(() => {
                  popIn(actionBubbleAnim).start();
                }, ACTION_BUBBLE_DELAY_MS);
              });
            }, STATUS_BUBBLE_DELAY_MS);
          }
        };
        typeNext();
      });
    }, GREETING_DELAY_MS);
  }, [greetingBubbleAnim, statusBubbleAnim, actionBubbleAnim]);

  // ── Run sequence once on screen focus when profile is loaded ───────────────
  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();

      hasAnimatedRef.current = false;

      return () => {
        // clean up timers when leaving screen
        if (typewriterRef.current) clearTimeout(typewriterRef.current);
        if (sequenceRef.current)  clearTimeout(sequenceRef.current);
      };
    }, [fadeAnim])
  );

  // Trigger entry sequence once profile is known (could be null = no user)
  useEffect(() => {
    if (isLoadingProfile) return;
    if (hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;

    const name = displayName(currentUser);
    runEntrySequence(name);
  }, [isLoadingProfile, currentUser, runEntrySequence]);
  // ─────────────────────────────────────────────────────────────────────────

  const loadProfile = useCallback(() => {
    return fetchCurrentUserProfileWithStats()
      .then((profile) => {
        setCurrentUser(profile ? userProfileToUser(profile) : null);
      })
      .catch((err) => {
        console.error("[HomeScreen] Failed to load user profile", err);
      })
      .finally(() => setIsLoadingProfile(false));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setCurrentUser(null);
      setShowProfileModal(false);
      setIsLoadingProfile(true);
      return;
    }

    loadProfile();
  }, [isAuthenticated]);

  useEffect(() => {
    const unsubscribe = subscribeToProfileUpdates((updatedProfile) => {
      if (!userId) return;
      if (updatedProfile.id !== userId) return;
      setCurrentUser(userProfileToUser(updatedProfile));
    });

    return unsubscribe;
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      loadProfile();
    }, [isAuthenticated, loadProfile])
  );

  const [aiSummary, setAiSummary] = useState<{ insight: string; concised_summary: string } | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [hasSummaryData, setHasSummaryData] = useState<boolean | null>(null); // null = unknown
  const [showSkipperInfo, setShowSkipperInfo] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const todayKey = getLocalDateKey();
    const yesterdayKey = getPreviousDateKey(todayKey);

    fetchDailyAiSummary(userId, todayKey)
      .then((summary) => {
        if (summary) return summary;
        // Fall back to yesterday's summary if today's isn't ready yet
        return fetchDailyAiSummary(userId, yesterdayKey);
      })
      .then((summary) => {
        setAiSummary(summary);
        setHasSummaryData(summary != null);
      })
      .catch(() => {
        setAiSummary(null);
        setHasSummaryData(false);
      })
      .finally(() => setIsLoadingSummary(false));
  }, [userId]);

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

  const handleUsernameChange = async (newName: string) => {
    try {
      const updatedProfile = await updateCurrentUserProfile({ name: newName });
      setCurrentUser(prev =>
        updatedProfile
          ? userProfileToUser(updatedProfile)
          : prev ? { ...prev, name: newName } : null
      );
      showToast("username updated", "success");
    } catch (err) {
      console.error("[HomeScreen] Failed to update username", err);
      showToast("couldn't update username, try again", "error");
    }
  };

  if (!fontsLoaded) {
    return null;
  }

  // Bubble animated styles
  const bubbleAnimStyle = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [
      {
        scale: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.85, 1],
        }),
      },
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  });

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Wordmark + icons */}
        <HeaderBar />

        <View style={styles.bubblesContainer}>
          {/* Greeting bubble */}
          <Animated.View style={[styles.bubble, styles.bubbleLeft, styles.shadow, bubbleAnimStyle(greetingBubbleAnim)]}>
            <Text style={styles.bubbleText}>
              {nameFullyTyped
                ? (displayName(currentUser) ? `${displayName(currentUser)}!\nyou're back :)` : "hey!\nyou're back :)")
                : (typedName
                  ? `${typedName}\nyou're back :)`
                  : "hey!\nyou're back :)")}
            </Text>
          </Animated.View>

          {/* Status bubble */}
          <Animated.View style={[styles.bubble, styles.bubbleLeft, styles.bubbleLeftLast, styles.shadow, bubbleAnimStyle(statusBubbleAnim)]}>
            <View style={styles.skipperHeaderRow}>
              <Text style={styles.bubbleText}>
                s'kipper says:
              </Text>
              <InfoButton
                onPress={() => setShowSkipperInfo(true)}
                color={PRIMARY_TEXT}
                style={styles.skipperInfoBtn}
              />
            </View>
            <Text style={styles.bubbleSubtext}>
              {isLoadingSummary
                ? "Pop on your s'pot today and give me a hot second..."
                : hasSummaryData === false
                  ? "Pop on your s'pot and sit down. I'll cook up a daily personalised insight just for you once I've seen you in action."
                  : aiSummary?.insight}
            </Text>
          </Animated.View>

          <InfoModal
            metricKey={showSkipperInfo ? "skipper" : null}
            onClose={() => setShowSkipperInfo(false)}
            metricInfo={SKIPPER_INFO}
            accentColor={PRIMARY_TEXT}
          />

          {/* Action bubble — navigate to daily summary */}
          <View style={styles.actionBubbleWrap}>
            <Animated.View style={bubbleAnimStyle(actionBubbleAnim)}>
              <Pressable
                style={[styles.bubble, styles.bubbleRight, styles.shadow]}
                onPress={() => {
                  logNavbarClick(userId, "today_summary");
                  if (tutorialStep === "data-tip") {
                    setTutorialStep("snapshot-tip");
                  } else {
                    dismissTutorial();
                  }
                  router.push("/daily");
                }}
              >
                <Text style={styles.bubbleActionText}>see today's data {'>>'}</Text>
              </Pressable>
            </Animated.View>

            {tutorialStep === "goals-tip" && (
              <View style={styles.tutorialTip}>
                <Image
                  source={require("../../assets/images/mascot.png")}
                  style={styles.tutorialTipMascot}
                  resizeMode="contain"
                />
                <View style={styles.tutorialTipTextWrap}>
                  <Text style={styles.tutorialTipText}>get daily personalised goals here every morning!</Text>
                  <Pressable onPress={() => setTutorialStep("data-tip")}>
                    <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {tutorialStep === "data-tip" && (
              <View style={[styles.tutorialTip, styles.tutorialTipBelow]}>
                <Image
                  source={require("../../assets/images/mascot.png")}
                  style={styles.tutorialTipMascot}
                  resizeMode="contain"
                />
                <View style={styles.tutorialTipTextWrap}>
                  <Text style={styles.tutorialTipText}>click on the "see today's data" button to see your posture data for today</Text>
                </View>
              </View>
            )}
          </View>
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
  skipperHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  // Overrides InfoButton's default absolute top-right positioning — sits
  // inline right next to "s'kipper says:" instead.
  skipperInfoBtn: {
    position: "relative",
    top: 0,
    right: 0,
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

  actionBubbleWrap: {
    position: "relative",
    alignItems: "flex-end",
  },
  tutorialTip: {
    position: "absolute",
    top: -50,
    right: 16,
    maxWidth: 230,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  tutorialTipBelow: {
    top: "100%",
    marginTop: -12,
  },
  tutorialTipMascot: {
    width: 30,
    height: 30,
  },
  tutorialTipTextWrap: {
    flexShrink: 1,
  },
  tutorialTipText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: "#FFFFFF",
    lineHeight: 19,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
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