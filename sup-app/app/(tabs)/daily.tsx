import PressFeedback from "@/src/components/ui/PressFeedback";
import TutorialActions from "@/src/components/onboarding/TutorialActions";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  Dimensions,
  Modal,
  TouchableWithoutFeedback,
  Image,
} from "react-native";
import Svg, { Defs, Filter, FeGaussianBlur, Ellipse } from "react-native-svg";
import { router, useFocusEffect } from "expo-router";
import { useFonts } from "expo-font";
import React, { useRef, useCallback, useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useStepCount } from "../../src/hooks/useStepCount";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";
import { useAuth } from "@/src/contexts/AuthContext";
import { useToast } from "@/src/contexts/ToastContext";
import { type User } from "../../constants/env";
import {
  fetchCurrentUserProfileWithStats,
  subscribeToProfileUpdates,
  userProfileToUser,
  updateCurrentUserProfile,
} from "../../src/services/user/profileService";
import {
  fetchDailyPosturePair,
  type DailyPosturePair,
  type DailyPostureRow,
} from "../../src/services/posture/postureSyncService";
import { getCachedDailyPair, setCachedDailyPair } from "@/src/services/posture/dailyPostureCache";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { colours } from "@/theme/colours";
import { InfoButton, InfoModal } from "@/src/components/ui/InfoModal";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const PRIMARY_TEXT = "#1D014A";
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, "0");
const day = String(now.getDate()).padStart(2, "0");
const TODAY_KEY = `${year}-${month}-${day}`;
// const TODAY_KEY = `2026-07-15`; // hardcoded for testing

const SEGMENT_COLORS: Record<string, string> = {
  upright:  "#6DC96D",
  forward_lean: "#FFD600",
  slouched:  "#F5A623",
  severe: "#EC555E",
  tilted_left:   "#F5A623",
  tilted_right:  "#F5A623",
};

function ScoreBar({ postureAverages }: { postureAverages: Record<string, number> }) {
  const segments = Object.entries(postureAverages).map(([key, pct]) => ({
      pct,
      color: SEGMENT_COLORS[key] ?? "#ccc",
    })
  );

  return (
    <View style={[scoreBarStyles.track, scoreBarStyles.shadow]}>
      {segments.map(({ pct, color }, i) =>
        pct > 0 ? (
          <View
            key={i}
            style={[scoreBarStyles.segment, { flex: pct, backgroundColor: color }]}
          />
        ) : null
      )}
    </View>
  );
}

const scoreBarStyles = StyleSheet.create({
  track: {
    flexDirection: "row",
    height: 18,
    borderRadius: 9,
    overflow: "hidden",
    marginVertical: 12,
  },
  shadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  segment: {
    height: "100%",
  },
});

/** Small pill badge for % changes */
function ChangeBadge({ value }: { value: number }) {
  const isUp = value >= 0;
  return (
    <View style={[badgeStyles.pill, { backgroundColor: isUp ? "#6DC96D" : "#EC555E" }]}>
      <Text style={badgeStyles.text}>
        {isUp ? "↑" : "↓"}{Math.abs(value)}%
      </Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    position: "absolute",
    top: -10,
    right: -10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    zIndex: 1,
  },
  text: {
    color: "white",
    fontSize: 11,
    fontWeight: "700",
  },
});

// InfoButton / InfoModal now live in src/components/ui/InfoModal.tsx — shared
// with desk.tsx's s'train explainer so every metric popup consistently
// includes a "view sources & methodology" link.

/** Posture breakdown list shown inside the snapshot card */
function PostureBreakdown({ stats }: { stats: { label: string; value: string; color?: string }[] }) {
  return (
    <View style={breakdownStyles.container}>
      {stats.map((stat, i) => (
        <View
          key={stat.label}
          style={[
            breakdownStyles.row,
            i === stats.length - 1 && { borderBottomWidth: 0 },
          ]}
        >
          <View style={breakdownStyles.labelRow}>
            {stat.color && (
              <View style={[breakdownStyles.dot, { backgroundColor: stat.color }]} />
            )}
            <Text style={breakdownStyles.label}>{stat.label}</Text>
          </View>
          <Text style={breakdownStyles.value}>{stat.value}</Text>
        </View>
      ))}
    </View>
  );
}

const breakdownStyles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 16,
    backgroundColor: "rgba(63, 36, 131, 0.06)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(63, 36, 131, 0.08)",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: PRIMARY_TEXT,
    opacity: 0.75,
  },
  value: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 13,
    color: PRIMARY_TEXT,
  },
});

export default function DailyScreen() {
  const { isAuthenticated, userId } = useAuth();
  const { showToast } = useToast();
  const { tutorialStep, setTutorialStep } = useTutorial();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [streakDays, setStreakDays] = useState<number | null>(null);
  const [weeklyAvgPoints, setWeeklyAvgPoints] = useState<number | null>(null);

  const [dailyPair, setDailyPair] = useState<DailyPosturePair>({ today: null, previous: null });
  const [isLoadingDaily, setIsLoadingDaily] = useState(true);

  const [fontsLoaded] = useFonts({
    "Agrandir-Regular":  require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [activeInfo, setActiveInfo] = useState<string | null>(null);

  const loadDailyPosture = useCallback(async (background = false) => {
    if (!userId) return;
    if (!background) setIsLoadingDaily(true);
 
    // show cached data immediately so UI and AI prompt unblock right away
    const cached = await getCachedDailyPair(userId, TODAY_KEY);
    if (cached) {
      setDailyPair(cached);
      setIsLoadingDaily(false);
    }
 
    // fetch fresh in background regardless
    fetchDailyPosturePair(userId, TODAY_KEY)
      .then((fresh) => {
        setDailyPair(fresh);
        setCachedDailyPair(userId, TODAY_KEY, fresh);
      })
      .catch((err) => console.error("[DailyScreen] fetchDailyPosturePair failed", err))
      .finally(() => setIsLoadingDaily(false));
  }, [userId]);
 
  const loadProfile = useCallback(() => {
    return fetchCurrentUserProfileWithStats()
      .then((profile) => {
        setCurrentUser(profile ? userProfileToUser(profile) : null);
        setStreakDays(profile?.currentStreak ?? null);
        setWeeklyAvgPoints(profile?.weeklyAvgPoints ?? null);
      })
      .catch((err) => {
        console.error("[DailyScreen] Failed to load user profile", err);
      })
      .finally(() => setIsLoadingProfile(false));
  }, []);
 
  // initial load: run all fetches in parallel
  useEffect(() => {
    if (!isAuthenticated) {
      setCurrentUser(null);
      setIsLoadingProfile(true);
      setDailyPair({ today: null, previous: null });
      return;
    }
 
    Promise.all([
      loadProfile(),
      loadDailyPosture(),
    ]);
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
      loadDailyPosture(true);
    }, [isAuthenticated, loadProfile, loadDailyPosture])
  );

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

  const handleUsernameChange = async (newName: string) => {
    try {
      const updatedProfile = await updateCurrentUserProfile({ username: newName });
      if (updatedProfile) {
        setCurrentUser(userProfileToUser(updatedProfile));
      }
      showToast("Username updated", "success");
    } catch (err) {
      console.error("[DailyScreen] Failed to update username", err);
      showToast("Couldn't update username, try again", "error");
    }
  };

  const { today, previous } = dailyPair;

  // Current day
  const totalDeskMs = today?.totalDeskMs ?? 0;
  const supScore = today?.supScore ?? 0;
  const stateTotals = today?.stateTotals ?? {};

  // Previous day
  const prevSupScore = previous?.supScore ?? 0;
  const prevTotalDeskMs = previous?.totalDeskMs ?? 0;

  console.log("[DailyScreen] dailyPair", dailyPair);

  const sessionHours = Math.floor(totalDeskMs / 3_600_000);
  const sessionMinutes = Math.floor((totalDeskMs % 3_600_000) / 60_000);
  const prevSessionMins = prevTotalDeskMs / 60000;

  // % changes per metric (computed here so they use live step data)
  const scoreChange   = Math.round(((supScore - prevSupScore) / prevSupScore) * 100);
  const sessionChange = Math.round(((totalDeskMs - prevTotalDeskMs) / prevTotalDeskMs) * 100);
  const showBadges = today != null && previous != null;

  const STATE_TOTALS = {
    upright: stateTotals.upright ?? 0,
    forward_lean: stateTotals.forward_lean ?? 0,
    slouched: stateTotals.slouched ?? 0,
    severe: stateTotals.severe ?? 0,
    tilted_left: stateTotals.tilted_left ?? 0,
    tilted_right: stateTotals.tilted_right ?? 0,
  };
  // normalise scores to out of 100%
  const TOTAL = Object.values(STATE_TOTALS).reduce((sum, v) => sum + v, 0);
  const POSTURE_AVERAGES = (
    Object.fromEntries(
      Object.entries(STATE_TOTALS).map(([key, val]) => [
        key,
        (val / TOTAL) * 100,
      ])
    )
  ) as Record<keyof typeof STATE_TOTALS, number>;

  // after normalising, if any of the posture averages are NaN (due to TOTAL being 0), set them to 0
  for (const key in POSTURE_AVERAGES) {
    const postureKey = key as keyof typeof POSTURE_AVERAGES;
    if (isNaN(POSTURE_AVERAGES[postureKey])) {
      POSTURE_AVERAGES[postureKey] = 0;
    }
  }

  const POSTURE_STATS = [
    { label: "Upright",      value: `${POSTURE_AVERAGES.upright.toFixed(1)}%`,      color: "#6DC96D" },
    { label: "Forward Lean", value: `${POSTURE_AVERAGES.forward_lean.toFixed(1)}%`, color: "#F5C842" },
    { label: "Slouched",     value: `${POSTURE_AVERAGES.slouched.toFixed(1)}%`,     color: "#F5A623" },
    { label: "Severe",       value: `${POSTURE_AVERAGES.severe.toFixed(1)}%`,       color: "#E8706A" },
    { label: "Tilted Left",  value: `${POSTURE_AVERAGES.tilted_left.toFixed(1)}%`,  color: "#F5A623" },
    { label: "Tilted Right", value: `${POSTURE_AVERAGES.tilted_right.toFixed(1)}%`, color: "#F5A623" },
  ];

  const METRIC_INFO: Record<string, { title: string; body: string }> = {
    snapshot: {
      title: "s'napshot",
      body: `a real-time summary of today's posture activity. the bar shows your average posture quality across today's sessions.\ntips below are personalised to your current posture patterns.\n\ngo into desk mode to see the data from each session.`,
    },
    session: {
      title: "s'ession",
      body: "total time tracked in active posture sessions today. longer sessions unlock more duration points toward your s'core.",
    },
    score: {
      title: "s'core",
      body:
        "your overall daily posture score out of 100, made up of three parts:\n\n• quality (up to 50 pts) — based on your average posture quality for the day.\n• showing up (up to 30 pts) — 15 pts for tracking at least one session, plus up to 15 more for session length.\n• streak (up to 20 pts) — 3 pts for every consecutive day you keep it going.",
    },
  };

  if (!fontsLoaded) return null;

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <InfoModal
        metricKey={activeInfo}
        onClose={() => setActiveInfo(null)}
        metricInfo={METRIC_INFO}
        accentColor={PRIMARY_TEXT}
      />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <HeaderBar />

        {/* Section label with back arrow */}
        <View style={styles.sectionRow}>
          <PressFeedback feedback="scale" onPress={() => router.back()} style={styles.backArrow} hitSlop={8}>
            <Ionicons name="arrow-back" size={20} color={PRIMARY_TEXT} />
          </PressFeedback>
          <Text style={styles.sectionLabel}>today:</Text>
        </View>

        {tutorialStep === "snapshot-tip" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../assets/images/mascot_tutorial.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>
                here's your snapshot, the % of time you spent in each posture state today.
              </Text>
              <TutorialActions>
                <PressFeedback feedback="link" onPress={() => setTutorialStep("snapshot-tip-stats")}>
                  <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
                </PressFeedback>
              </TutorialActions>
            </View>
          </View>
        )}

        {/* S'napshot card */}
        <View
          style={[
            styles.card,
            styles.shadow,
            styles.highlightable,
            tutorialStep === "snapshot-tip" && styles.highlighted,
          ]}
        >
          <InfoButton onPress={() => setActiveInfo("snapshot")} color={PRIMARY_TEXT} />
          <Text style={styles.statLabel}>s'napshot</Text>
          <ScoreBar postureAverages={POSTURE_AVERAGES} />
          <PostureBreakdown stats={POSTURE_STATS} />
        </View>

        {tutorialStep === "snapshot-tip-stats" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../assets/images/mascot_tutorial.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>
                here's your total session time and s'up score for today's s'pot sessions.
              </Text>
              <TutorialActions>
                <PressFeedback feedback="link"
                  onPress={() => {
                    setTutorialStep("settings-tip");
                    router.push("/settings");
                  }}
                >
                  <Text style={styles.tutorialTipNext}>got it</Text>
                </PressFeedback>
              </TutorialActions>
            </View>
          </View>
        )}

        {/* Stats grid */}
        <View style={styles.grid}>
          {/* S'ession */}
          <View
            style={[
              styles.card,
              styles.gridCell,
              styles.shadow,
              styles.highlightable,
              tutorialStep === "snapshot-tip-stats" && styles.highlighted,
            ]}
          >
            <InfoButton onPress={() => setActiveInfo("session")} color={PRIMARY_TEXT} />
            {showBadges && <ChangeBadge value={sessionChange} />}
            <Text style={styles.statLabel}>s'ession</Text>
            <Text style={styles.statValue}>
              {sessionHours}h {sessionMinutes}m
            </Text>
          </View>

          {/* S'core */}
          <View
            style={[
              styles.card,
              styles.gridCell,
              styles.shadow,
              styles.highlightable,
              tutorialStep === "snapshot-tip-stats" && styles.highlighted,
            ]}
          >
            <InfoButton onPress={() => setActiveInfo("score")} color={PRIMARY_TEXT} />
            {showBadges && <ChangeBadge value={scoreChange} />}
            <Text style={styles.statLabel}>s'core</Text>
            <Text style={styles.statValue}>{supScore}</Text>
          </View>
        </View>

      </ScrollView>
    </Animated.View>
  );
}

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
    paddingBottom: 8,
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

  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  backArrow: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionLabel: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 20,
    color: PRIMARY_TEXT,
  },

  tutorialTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  tutorialTipMascot: {
    width: 34,
    height: 34,
  },
  tutorialTipTextWrap: {
    flex: 1,
  },
  tutorialTipText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
    color: "#FFFFFF",
    lineHeight: 20,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },

  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 20,
    borderRadius: 28,
    position: "relative",
  },
  shadow: {
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 5,
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
  snapshotMessage: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
    textAlign: "center",
    lineHeight: 20,
    opacity: 0.9,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    gap: 14,
    marginBottom: 16,
  },
  gridCell: {
    marginHorizontal: 0,
    marginBottom: 0,
    width: (SCREEN_W - 20 * 2 - 14) / 2,
    alignItems: "center",
  },
  statLabel: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.75,
    marginBottom: 4,
    textAlign: "center",
  },
  statValue: {
    fontFamily: "Agrandir-Regular",
    fontSize: 30,
    color: PRIMARY_TEXT,
    lineHeight: 36,
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
