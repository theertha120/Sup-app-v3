import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Dimensions,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from "react-native";
import Svg, { Defs, Filter, FeGaussianBlur, Ellipse } from "react-native-svg";
import { router } from "expo-router";
import { isLoading, useFonts } from "expo-font";
import React, { useRef, useCallback, useState, useEffect } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useStepCount } from "../../src/hooks/useStepCount";
import BackgroundBlobs from "./backgroundBlobs";
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

// CHECK IF S'MOVE IS CORRECT LOGIC 
// AND REMOVE STEPS? THEN JUST GREATEST CHANGE WILL HAVE CHANGE BADGE? OR ALL METRICS WILL HV CHANGE BADGE?
// AND ask theertha UPDATE FOR 2 CONSEC DAYS
// check abt snapshot message if also ai driven
// SNAPSHOT COMPONENTS
// SUP SCORE VS AVG SCORE
// HOW IS STREAK UPDATED? SHLD 1 STREAK BE ORANGE OR JUST PURPLE/GREY
// IF PRVS DAY or CURR DAY is null then change badge shld just show arrow but no number? OR just hide the badge entirely?
const STATIC_SNAPSHOT_MESSAGE_1 =
  "you have been leaning forward for too long, take a stretch break immediately";
const STATIC_SNAPSHOT_MESSAGE_2 =
  "stand up before 3:30 pm to stay ahead of posture dips and missed walking breaks";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const PRIMARY_TEXT = "#1D014A";
const TODAY_KEY = new Date().toISOString().split("T")[0]; // TO USE FOR PRODUCTION, CURRENTLY HARDCODED FOR TESTING

const SEGMENT_COLORS: Record<string, string> = {
  goodAlignment:  "#6DC96D",  // green
  leaningForward: "#FFD600",  // yellow
  spineRounding:  "#F5A623",  // orange
  highSpinalLoad: "#EC555E",  // red
  shiftingLeft:   "#F5A623",  // orange
  shiftingRight:  "#F5A623",  // orange
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

/** Tiny '?' button */
function InfoButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={infoStyles.button} onPress={onPress} hitSlop={8}>
      <Text style={infoStyles.label}>?</Text>
    </TouchableOpacity>
  );
}

const infoStyles = StyleSheet.create({
  button: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(63, 36, 131, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: PRIMARY_TEXT,
    lineHeight: 14,
  },
});

/** Info popup modal */
function InfoModal({
  metricKey,
  onClose,
  metricInfo
}: {
  metricKey: string | null;
  onClose: () => void;
  metricInfo?: Record<string, { title: string; body: string; stats?: { label: string; value: string; color?: string }[] }>;
}) {
  if (!metricKey) return null;
  const info = metricInfo?.[metricKey];
  if (!info) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={modalStyles.overlay}>
          <TouchableWithoutFeedback>
            <View style={modalStyles.sheet}>
              <Text style={modalStyles.title}>{info.title}</Text>
              <Text style={modalStyles.body}>{info.body}</Text>
              
              {info.stats && (
                <View style={modalStyles.statsContainer}>
                  {info.stats.map((stat) => (
                    <View
                      key={stat.label}
                      style={[
                        modalStyles.statRow,
                        info.stats && stat === info.stats[info.stats.length - 1] && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={modalStyles.statLabelRow}>
                        {stat.color && (
                          <View style={[modalStyles.dot, { backgroundColor: stat.color }]} />
                        )}
                        <Text style={modalStyles.statLabel}>{stat.label}</Text>
                      </View>
                      <Text style={modalStyles.statValue}>{stat.value}</Text>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose}>
                <Text style={modalStyles.closeBtnText}>got it</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  sheet: {
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: 28,
    padding: 28,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 20,
    color: PRIMARY_TEXT,
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
    lineHeight: 22,
    opacity: 0.85,
    textAlign: "center",
  },
  closeBtn: {
    marginTop: 20,
    alignSelf: "center",
    backgroundColor: "#AB99FA",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 20,
  },
  closeBtnText: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: "white",
  },
  statsContainer: {
    marginTop: 16,
    width: "100%",
    borderRadius: 16,
    backgroundColor: "rgba(63, 36, 131, 0.06)",
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(63, 36, 131, 0.08)",
  },
  statLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statLabel: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: PRIMARY_TEXT,
    opacity: 0.75,
  },
  statValue: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 13,
    color: PRIMARY_TEXT,
  },
});

export default function DailyScreen() {
  const { isAuthenticated, userId } = useAuth();
  const { showToast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [streakDays, setStreakDays] = useState<number | null>(null);
  const [weeklyAvgPoints, setWeeklyAvgPoints] = useState<number | null>(null);

  const TODAY_KEY = "2026-07-07"; // UPDATE TO CURRENT DATE LATER!
  const [dailyPair, setDailyPair] = useState<DailyPosturePair>({ today: null, previous: null });
  const [isLoadingDaily, setIsLoadingDaily] = useState(true);

  const loadProfile = () => {
    fetchCurrentUserProfileWithStats()
      .then((profile) => {
        setCurrentUser(profile ? userProfileToUser(profile) : null);
        setStreakDays(profile?.currentStreak ?? null);
        setWeeklyAvgPoints(profile?.weeklyAvgPoints ?? null);
      })
      .catch((err) => {
        console.error("[DailyScreen] Failed to load user profile", err);
      })
      .finally(() => setIsLoadingProfile(false));
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setCurrentUser(null);
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
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      loadProfile();
    }, [isAuthenticated])
  );

  const handleUsernameChange = async (newName: string) => {
    try {
      const updatedProfile = await updateCurrentUserProfile({ name: newName });
      if (updatedProfile) {
        setCurrentUser(userProfileToUser(updatedProfile));
      }
      showToast("Username updated", "success");
    } catch (err) {
      console.error("[DailyScreen] Failed to update username", err);
      showToast("Couldn't update username, try again", "error");
    }
  };
  
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular":  require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const loadDailyPosture = useCallback(() => {
    if (!userId) return;
    setIsLoadingDaily(true);
    fetchDailyPosturePair(userId, TODAY_KEY)
      .then(setDailyPair)
      .catch((err) => console.error("[DailyScreen] fetchDailyPosturePair failed", err))
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

  const { today, previous } = dailyPair;

  // Current day
  const totalDeskMs = today?.totalDeskMs ?? 0;
  const sessionCount = today?.sessionCount ?? 0;
  const interventionCount = today?.interventionCount ?? 0;
  const supScore = today?.supScore ?? 0;
  const stateTotals = today?.stateTotals ?? {};
  const goodPostureMins = today?.goodPostureMinutes ?? 0;
  const badPostureMins = today?.badPostureMinutes ?? 0;

  // Previous day
  const prevSupScore = previous?.supScore ?? 0;
  const prevTotalDeskMs = previous?.totalDeskMs ?? 0;
  const prevInterventionCount = previous?.interventionCount ?? 0;

  console.log("[DailyScreen] dailyPair", dailyPair);

  const sessionHours = Math.floor(totalDeskMs / 3_600_000);
  const sessionMinutes = Math.floor((totalDeskMs % 3_600_000) / 60_000);
  const prevSessionMins = prevTotalDeskMs / 60000;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [activeInfo, setActiveInfo] = useState<string | null>(null);
  const { todaySteps, yesterdaySteps, isLoading } = useStepCount();
  const STATIC_STEPS = todaySteps;
  const PREV_STEPS   = yesterdaySteps;

  // % changes per metric (computed here so they use live step data)
  const scoreChange   = Math.round(((supScore - prevSupScore)                  / prevSupScore)      * 100);
  const stepsChange   = PREV_STEPS > 0
    ? Math.round(((STATIC_STEPS - PREV_STEPS) / PREV_STEPS) * 100)
    : 0;
  const smoveChange   = Math.round(((interventionCount - prevInterventionCount) / prevInterventionCount) * 100);
  const sessionChange = Math.round(((totalDeskMs - prevTotalDeskMs) / prevTotalDeskMs) * 100);

  // Pick the 2 metrics with the largest absolute % change
  const allChanges: { key: string; value: number }[] = [
    { key: "session", value: sessionChange },
    { key: "score",   value: scoreChange   },
    { key: "smove",   value: smoveChange   },
    { key: "steps",   value: stepsChange   },
  ];
  const topTwoKeys = new Set(
    [...allChanges]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 2)
      .map((c) => c.key)
  );

  // TO UPDATE
  const STATE_TOTALS = {
    goodAlignment: stateTotals.upright ?? 0,
    leaningForward: stateTotals.forward_lean ?? 0,
    spineRounding: stateTotals.severe ?? 0,
    highSpinalLoad: stateTotals.severe ?? 0,
    shiftingLeft: stateTotals.tilted_left ?? 0,
    shiftingRight: stateTotals.tilted_right ?? 0,
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

  const METRIC_INFO: Record<string, { title: string; body: string; stats?: { label: string; value: string; color?: string }[] }> = {
    snapshot: {
      title: "s'napshot",
      body: `a real-time summary of your posture health. the bar shows how your spine health score averaged across your sessions today.\ntips below are personalised to your current posture patterns.\n\ngo into Desk Mode to see the data from each session.`,
      stats: [
        { label: "good alignment",  value: `${POSTURE_AVERAGES.goodAlignment.toFixed(1)}%`,  color: "#6DC96D" },
        { label: "leaning forward", value: `${POSTURE_AVERAGES.leaningForward.toFixed(1)}%`, color: "#F5C842" },
        { label: "spine rounding",  value: `${POSTURE_AVERAGES.spineRounding.toFixed(1)}%`,  color: "#F5A623" },
        { label: "high spinal load",value: `${POSTURE_AVERAGES.highSpinalLoad.toFixed(1)}%`, color: "#E8706A" },
        { label: "shifting left",   value: `${POSTURE_AVERAGES.shiftingLeft.toFixed(1)}%`,   color: "#F5A623" },
        { label: "shifting right",  value: `${POSTURE_AVERAGES.shiftingRight.toFixed(1)}%`,  color: "#F5A623" },
      ],
    },
    session: {
      title: "s'ession",
      body: "total time tracked in active posture sessions today. longer sessions unlock more duration points toward your s'core.",
    },
    score: {
      title: "s'core",
      body:
        "your overall daily posture score out of 100, made up of three parts:\n\n• quality (up to 50 pts) — based on your average spine health score.\n• showing up (up to 30 pts) — 15 pts for tracking at least one session, plus up to 15 more for session length.\n• streak (up to 20 pts) — 3 pts per consecutive day, capped at 20.",
    },
    smove: {
      title: "s'move",
      body: "movement breaks completed vs. your daily target. each s'move is a short guided stretch or walk break. hitting your target helps offset the effects of prolonged sitting.",
    },
    steps: {
      title: "s'teps",
      body: "total steps taken today, synced from your device. regular movement throughout the day supports spinal decompression and reduces postural fatigue.",
    },
  };

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

  if (!fontsLoaded) return null;

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <InfoModal metricKey={activeInfo} onClose={() => setActiveInfo(null)} metricInfo={METRIC_INFO} />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <HeaderBar />

        {/* Section label with back arrow */}
        <View style={styles.sectionRow}>
          <Pressable onPress={() => router.back()} style={styles.backArrow} hitSlop={8}>
            <Ionicons name="arrow-back" size={20} color={PRIMARY_TEXT} />
          </Pressable>
          <Text style={styles.sectionLabel}>today:</Text>
        </View>

        {/* S'napshot card */}
        <View style={[styles.card, styles.shadow]}>
          <InfoButton onPress={() => setActiveInfo("snapshot")} />
          <Text style={styles.cardTitle}>s'napshot</Text>
          <ScoreBar postureAverages={POSTURE_AVERAGES} />
          <Text style={styles.snapshotMessage}>{STATIC_SNAPSHOT_MESSAGE_1}</Text>
          <Text style={[styles.snapshotMessage, { marginTop: 8 }]}>
            {STATIC_SNAPSHOT_MESSAGE_2}
          </Text>
        </View>

        {/* Stats grid */}
        <View style={styles.grid}>
          {/* S'ession */}
          <View style={[styles.card, styles.gridCell, styles.shadow]}>
            <InfoButton onPress={() => setActiveInfo("session")} />
            {topTwoKeys.has("session") && <ChangeBadge value={sessionChange} />}
            <Text style={styles.statLabel}>s'ession</Text>
            <Text style={styles.statValue}>
              {sessionHours}h {sessionMinutes}m
            </Text>
          </View>

          {/* S'core */}
          <View style={[styles.card, styles.gridCell, styles.shadow]}>
            <InfoButton onPress={() => setActiveInfo("score")} />
            {topTwoKeys.has("score") && <ChangeBadge value={scoreChange} />}
            <Text style={styles.statLabel}>s'core</Text>
            <Text style={styles.statValue}>{supScore}</Text>
          </View>

          {/* S'move */}
          <View style={[styles.card, styles.gridCell, styles.shadow]}>
            <InfoButton onPress={() => setActiveInfo("smove")} />
            {topTwoKeys.has("smove") && <ChangeBadge value={smoveChange} />}
            <Text style={styles.statLabel}>s'move</Text>
            <Text style={styles.statValue}>
              {interventionCount}/{sessionCount}
            </Text>
          </View>

          {/* S'teps */}
          <View style={[styles.card, styles.gridCell, styles.shadow]}>
            <InfoButton onPress={() => setActiveInfo("steps")} />
            {topTwoKeys.has("steps") && <ChangeBadge value={stepsChange} />}
            <Text style={styles.statLabel}>s'teps</Text>
            <Text style={styles.statValue}>
                {isLoading ? "—" : STATIC_STEPS.toLocaleString()}
            </Text>
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
  cardTitle: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 16,
    color: PRIMARY_TEXT,
    textAlign: "center",
    marginBottom: 2,
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