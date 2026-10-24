// Home tab: s'kipper's greeting, today's AI insight and a link to today's data.
// The three chat bubbles animate in one after another once the profile and fonts are ready.
import PressFeedback from "@/src/components/ui/PressFeedback";
import TutorialActions from "@/src/components/onboarding/TutorialActions";
import { View, Text, StyleSheet, ScrollView, Animated, Image } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useFonts } from "expo-font";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle } from "react";
import { displayName } from "@/src/utils/displayName";
import { colours } from "../../theme/colours";
import { useAuth } from "../../src/contexts/AuthContext";
import { type User } from "../../constants/env";
import {
  fetchCurrentUserProfileWithStats,
  subscribeToProfileUpdates,
  userProfileToUser,
} from "../../src/services/user/profileService";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";
import { fetchLatestDailyAiSummary } from "@/src/services/ai/dailyAiSummaryService";
import { logNavbarClick } from "@/src/services/analytics/navbarClickService";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { InfoButton, InfoModal, InfoModalEntry } from "@/src/components/ui/InfoModal";
import { SKIPPER_DISCLAIMER } from "@/src/services/ai/aiProvider";
import { toLocalDateKey, addDaysToDateKey } from "@/src/lib/dateKey";
import { captureError } from "@/src/lib/sentry";

export { default as ErrorBoundary } from "@/src/components/ui/ScreenErrorBoundary";

// ─── Animation timing constants ──────────────────────────────────────────────
const GREETING_DELAY_MS       = 400;  // delay before greeting bubble starts
const TYPEWRITER_CHAR_DELAY_MS = 150;   // delay between each typed character
const STATUS_BUBBLE_DELAY_MS   = 400;  // delay after typewriter finishes before status bubble
const ACTION_BUBBLE_DELAY_MS   = 450;  // delay after status bubble before action bubble

const SKIPPER_INFO: Record<string, InfoModalEntry> = {
  skipper: SKIPPER_DISCLAIMER,
  // Explains the daily AI insight — mirrors generate-daily-summaries (8am SGT, last 7 days of posture_daily)
  dailyInsight: {
    title: "about your daily insight",
    body:
      "s'kipper writes this insight only once a day, at 8 am (singapore time).\n\n" +
      "what goes in: your last 7 days of s'pot data, including your posture session data, plus your daily s'up s'core " +
      "and total tracked time. if you haven't tracked in the past 7 days, no new insight is made.\n\n" +
      "what it's for: to spot trends across your week and give you a personalised focus for today. ",
  },
};
// ─────────────────────────────────────────────────────────────────────────────

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

type TypedGreetingHandle = {
  reset: () => void;
  start: (chars: string, onDone: () => void) => void;
  cancel: () => void;
};

// Owns the typewriter state so each typed character re-renders only this Text,
// not the whole home screen.
const TypedGreeting = React.forwardRef<TypedGreetingHandle, { name: string }>(
  function TypedGreeting({ name }, ref) {
    const [typedName, setTypedName] = useState("");
    const [nameFullyTyped, setNameFullyTyped] = useState(false);
    const typewriterRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancel = useCallback(() => {
      if (typewriterRef.current) clearTimeout(typewriterRef.current);
    }, []);

    useImperativeHandle(ref, () => ({
      reset: () => {
        cancel();
        setTypedName("");
        setNameFullyTyped(false);
      },
      start: (chars, onDone) => {
        let i = 0;
        const typeNext = () => {
          if (i <= chars.length) {
            setTypedName(chars.slice(0, i));
            i++;
            typewriterRef.current = setTimeout(typeNext, TYPEWRITER_CHAR_DELAY_MS);
          } else {
            setNameFullyTyped(true);
            onDone();
          }
        };
        typeNext();
      },
      cancel,
    }), [cancel]);

    useEffect(() => cancel, [cancel]);

    return (
      <Text style={styles.bubbleText}>
        {nameFullyTyped
          ? (name ? `${name}!\nyou're back :)` : "hey!\nyou're back :)")
          : (typedName
            ? `${typedName}\nyou're back :)`
            : "hey!\nyou're back :)")}
      </Text>
    );
  }
);

export default function HomeScreen() {

  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { isAuthenticated, userId } = useAuth();
  const { tutorialStep, setTutorialStep, dismissTutorial } = useTutorial();
  const scrollRef = useRef<ScrollView>(null);
  const tutorialScrollFrame = useRef<number | null>(null);
  const { bottom: bottomInset } = useSafeAreaInsets();
  // Match the floating navigation bar: 72 high, 25 above the safe area.
  const tutorialBottomClearance = 72 + 25 + bottomInset + 16;

  // Cancel a pending tutorial scroll when the step changes or the screen unmounts.
  useEffect(() => () => {
    if (tutorialScrollFrame.current !== null) {
      cancelAnimationFrame(tutorialScrollFrame.current);
      tutorialScrollFrame.current = null;
    }
  }, [tutorialStep]);

  // Scrolls the "data-tip" tutorial bubble into view on the next frame (after layout).
  const revealDataTip = () => {
    if (tutorialStep !== "data-tip") return;
    if (tutorialScrollFrame.current !== null) {
      cancelAnimationFrame(tutorialScrollFrame.current);
    }
    tutorialScrollFrame.current = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
      tutorialScrollFrame.current = null;
    });
  };

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // ─── Bubble entrance animations ────────────────────────────────────────────
  const greetingBubbleAnim = useRef(new Animated.Value(0)).current;
  const statusBubbleAnim   = useRef(new Animated.Value(0)).current;
  const actionBubbleAnim   = useRef(new Animated.Value(0)).current;
  const greetingStyle = useMemo(() => bubbleAnimStyle(greetingBubbleAnim), [greetingBubbleAnim]);
  const statusStyle   = useMemo(() => bubbleAnimStyle(statusBubbleAnim), [statusBubbleAnim]);
  const actionStyle   = useMemo(() => bubbleAnimStyle(actionBubbleAnim), [actionBubbleAnim]);

  // Typewriter state
  const greetingRef   = useRef<TypedGreetingHandle>(null);
  const sequenceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAnimatedRef = useRef(false);

  const popIn = (anim: Animated.Value) =>
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 9,
    });

  // Greeting pops in → name types out → status bubble → action bubble, each
  // step chained off the previous one's completion callback.
  const runEntrySequence = useCallback((name: string) => {
    // Reset
    greetingBubbleAnim.setValue(0);
    statusBubbleAnim.setValue(0);
    actionBubbleAnim.setValue(0);
    greetingRef.current?.reset();

    // 1. Greeting bubble pops in
    sequenceRef.current = setTimeout(() => {
      popIn(greetingBubbleAnim).start(() => {

        // 2. Type out the name character by character
        const chars = name ? `${name}!` : "hey!";
        greetingRef.current?.start(chars, () => {

          // 3. Status bubble pops in after typewriter finishes
          sequenceRef.current = setTimeout(() => {
            popIn(statusBubbleAnim).start(() => {

              // 4. Action bubble pops in after status bubble
              sequenceRef.current = setTimeout(() => {
                popIn(actionBubbleAnim).start();
              }, ACTION_BUBBLE_DELAY_MS);
            });
          }, STATUS_BUBBLE_DELAY_MS);
        });
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
        greetingRef.current?.cancel();
        if (sequenceRef.current)  clearTimeout(sequenceRef.current);
      };
    }, [fadeAnim])
  );

  // Trigger entry sequence once profile is known (could be null = no user)
  useEffect(() => {
    if (isLoadingProfile) return;
    if (!fontsLoaded) return; // TypedGreeting isn't mounted until fonts load
    if (hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;

    const name = displayName(currentUser);
    runEntrySequence(name);
  }, [isLoadingProfile, fontsLoaded, currentUser, runEntrySequence]);
  // ─────────────────────────────────────────────────────────────────────────

  // Fetches the profile for the greeting name; ends the loading state either way.
  const loadProfile = useCallback(() => {
    return fetchCurrentUserProfileWithStats()
      .then((profile) => {
        setCurrentUser(profile ? userProfileToUser(profile) : null);
      })
      .catch((err) => {
        console.error("[HomeScreen] Failed to load user profile", err);
        captureError(err, "home-profile");
      })
      .finally(() => setIsLoadingProfile(false));
  }, []);

  // Reset on sign-out only; loading is done by the focus effect below, which
  // also fires on first mount (calling it here too fetched the profile twice).
  useEffect(() => {
    if (!isAuthenticated) {
      setCurrentUser(null);
      setIsLoadingProfile(true);
    }
  }, [isAuthenticated]);

  // Picks up profile edits made elsewhere (e.g. a name change) without refetching.
  useEffect(() => {
    const unsubscribe = subscribeToProfileUpdates((updatedProfile) => {
      if (!userId) return;
      if (updatedProfile.id !== userId) return;
      setCurrentUser(userProfileToUser(updatedProfile));
    });

    return unsubscribe;
  }, [userId]);

  // Reload the profile every time Home is focused (including first mount).
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      loadProfile();
    }, [isAuthenticated, loadProfile])
  );

  const [aiSummary, setAiSummary] = useState<{ insight: string } | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [hasSummaryData, setHasSummaryData] = useState<boolean | null>(null); // null = unknown
  const [showSkipperInfo, setShowSkipperInfo] = useState(false);
  const [showDailyInsightInfo, setShowDailyInsightInfo] = useState(false);

  // On focus (not just login) so a summary generated while the app stays open,
  // or a new day, shows up without a restart.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      const todayKey = toLocalDateKey();
      const yesterdayKey = addDaysToDateKey(todayKey, -1);

      // Newest of today/yesterday — falls back to yesterday's if today's isn't ready yet
      fetchLatestDailyAiSummary(userId, [todayKey, yesterdayKey])
        .then((summary) => {
          setAiSummary(summary);
          setHasSummaryData(summary != null);
        })
        .catch((err) => {
          console.error("[HomeScreen] Failed to load daily AI summary", err);
          captureError(err, "home-ai-summary", { todayKey });
          // Keep an insight already on screen; a failed refresh shouldn't blank it.
          setHasSummaryData((prev) => prev === true);
        })
        .finally(() => setIsLoadingSummary(false));
    }, [userId])
  );

  if (!fontsLoaded) {
    return null;
  }

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={[
          styles.scrollContent,
          tutorialStep === "data-tip" && { paddingBottom: tutorialBottomClearance },
        ]}
        onContentSizeChange={revealDataTip}
        showsVerticalScrollIndicator={false}
      >
        {/* Wordmark + icons */}
        <HeaderBar />

        <View style={[
          styles.bubblesContainer,
          tutorialStep === "data-tip" && styles.bubblesWithTutorial,
        ]}>
          {/* Greeting bubble */}
          <Animated.View style={[styles.bubble, styles.bubbleLeft, styles.shadow, greetingStyle]}>
            <TypedGreeting ref={greetingRef} name={displayName(currentUser)} />
          </Animated.View>

          {/* Status bubble */}
          <Animated.View
            style={[
              styles.bubble,
              styles.bubbleLeft,
              styles.bubbleLeftLast,
              styles.shadow,
              styles.highlightable,
              tutorialStep === "goals-tip" && styles.highlighted,
              statusStyle,
            ]}
          >
            {/* Daily insight explainer — default InfoButton top-right placement */}
            <InfoButton onPress={() => setShowDailyInsightInfo(true)} color={PRIMARY_TEXT} />
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

          <InfoModal
            metricKey={showDailyInsightInfo ? "dailyInsight" : null}
            onClose={() => setShowDailyInsightInfo(false)}
            metricInfo={SKIPPER_INFO}
            accentColor={PRIMARY_TEXT}
          />

          {/* Action bubble — navigate to daily summary */}
          <View style={styles.actionBubbleWrap}>
            <Animated.View style={actionStyle}>
              <PressFeedback
                style={[
                  styles.bubble,
                  styles.bubbleRight,
                  styles.shadow,
                  styles.highlightable,
                  tutorialStep === "data-tip" && styles.highlighted,
                ]}
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
              </PressFeedback>
            </Animated.View>

            {tutorialStep === "goals-tip" && (
              <View style={styles.tutorialTip}>
                <Image
                  source={require("../../assets/images/mascot_tutorial.png")}
                  style={styles.tutorialTipMascot}
                  resizeMode="contain"
                />
                <View style={styles.tutorialTipTextWrap}>
                  <Text style={styles.tutorialTipText}>get daily personalised goals here every morning!</Text>
                  <TutorialActions>
                    <PressFeedback feedback="link" onPress={() => setTutorialStep("data-tip")}>
                      <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
                    </PressFeedback>
                  </TutorialActions>
                </View>
              </View>
            )}

            {tutorialStep === "data-tip" && (
              <View style={[styles.tutorialTip, styles.tutorialTipBelow]} onLayout={revealDataTip}>
                <Image
                  source={require("../../assets/images/mascot_tutorial.png")}
                  style={styles.tutorialTipMascot}
                  resizeMode="contain"
                />
                <View style={styles.tutorialTipTextWrap}>
                  <Text style={styles.tutorialTipText}>click on the "see today's data" button to see your posture data for today</Text>
                  <TutorialActions />
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
  bubblesWithTutorial: {
    flexBasis: "auto",
    flexShrink: 0,
  },

  bubble: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 20,
    borderRadius: 28,
  },
  highlightable: {
    borderWidth: 3,
    borderColor: "transparent",
  },
  highlighted: {
    borderColor: "#5222AE",
    shadowColor: "#5222AE",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
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
    top: -40,
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
    // Reserve real space for the message and its controls in the ScrollView.
    position: "relative",
    top: 0,
    right: 0,
    marginRight: 16,
    marginTop: 0,
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

});
