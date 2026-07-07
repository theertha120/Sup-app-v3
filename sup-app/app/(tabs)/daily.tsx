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

// Static data — swap these out when connecting to real data
const avg_SHS_today = 72;            // 0–100 spine health score average
const tracked_any_session_today = true;
const totalTrackedMs_today = (7 * 60 + 21) * 60 * 1000; // 7 h 21 m
const streak_days = 4;
const weekly = 420 // TO PULL FROM SUPABASE
const PREV_SCORE      = 63;
// const PREV_STEPS      = 6620;
const PREV_SMOVE      = 3;          // completed moves yesterday
const PREV_SESSION_MS = (6 * 60 + 45) * 60 * 1000;
// const STATIC_STEPS           = 4640;
const STATIC_SMOVE_COMPLETED = 2;
const STATIC_SMOVE_TOTAL     = 5;
const STATIC_SNAPSHOT_MESSAGE_1 =
  "you have been leaning forward for too long, take a stretch break immediately";
const STATIC_SNAPSHOT_MESSAGE_2 =
  "stand up before 3:30 pm to stay ahead of posture dips and missed walking breaks";
const SESSION_DATA = {
  session1: {
    goodAlignment:   18,
    leaningForward:   2,
    spineRounding:    2,
    highSpinalLoad:   5,
    shiftingLeft:     2,
    shiftingRight:   72,
  },
  session2: {
    goodAlignment:   20,
    leaningForward:   3,
    spineRounding:    3,
    highSpinalLoad:   4,
    shiftingLeft:     3,
    shiftingRight:   68,
  },
};

// Derived values 
const quality_score   = (avg_SHS_today / 100) * 50;
const base_points     = tracked_any_session_today ? 15 : 0;
const totalMins       = totalTrackedMs_today / 60000;
const duration_points = totalMins >= 120 ? 15 : totalMins >= 60 ? 10 : totalMins >= 30 ? 5 : 0;
const showing_up_score = base_points + duration_points;
const streak_score    = Math.min(20, streak_days * 3);
const SCORE           = Math.round(quality_score + showing_up_score + streak_score);

const sessionHours   = Math.floor(totalTrackedMs_today / 3_600_000);
const sessionMinutes = Math.floor((totalTrackedMs_today % 3_600_000) / 60_000);
const prevSessionMins = PREV_SESSION_MS / 60000;

const sessions = Object.values(SESSION_DATA);

function rawAvg(key: keyof typeof SESSION_DATA.session1): number {
  return sessions.reduce((sum, s) => sum + s[key], 0) / sessions.length;
}
const RAW_AVERAGES = {
  goodAlignment:  rawAvg("goodAlignment"),   // 19
  leaningForward: rawAvg("leaningForward"),  // 2.5
  spineRounding:  rawAvg("spineRounding"),   // 2.5
  highSpinalLoad: rawAvg("highSpinalLoad"),  // 4.5
  shiftingLeft:   rawAvg("shiftingLeft"),    // 2.5
  shiftingRight:  rawAvg("shiftingRight"),   // 70
};

// normalise average scores to out of 100%
const RAW_TOTAL = Object.values(RAW_AVERAGES).reduce((sum, v) => sum + v, 0); // 101
const POSTURE_AVERAGES = (
  Object.fromEntries(
    Object.entries(RAW_AVERAGES).map(([key, val]) => [
      key,
      (val / RAW_TOTAL) * 100,  // e.g. 19/101*100 ≈ 18.81
    ])
  )
) as Record<keyof typeof RAW_AVERAGES, number>;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const PRIMARY_TEXT = "#1D014A";

const METRIC_INFO: Record<string, { title: string; body: string; stats?: { label: string; value: string; color?: string }[] }> = {
  snapshot: {
    title: "s'napshot",
    body: `A real-time summary of your posture health. The bar shows how your spine health score averaged across your sessions today.\nTips below are personalised to your current posture patterns.\n\nGo into Desk Mode to see the data from each session.`,
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
    body: "Total time tracked in active posture sessions today. Longer sessions unlock more duration points toward your s'core.",
  },
  score: {
    title: "s'core",
    body:
      "Your overall daily posture score out of 100, made up of three parts:\n\n• Quality (up to 50 pts) — based on your average spine health score.\n• Showing up (up to 30 pts) — 15 pts for tracking at least one session, plus up to 15 more for session length.\n• Streak (up to 20 pts) — 3 pts per consecutive day, capped at 20.",
  },
  smove: {
    title: "s'move",
    body: "Movement breaks completed vs. your daily target. Each s'move is a short guided stretch or walk break. Hitting your target helps offset the effects of prolonged sitting.",
  },
  steps: {
    title: "s'teps",
    body: "Total steps taken today, synced from your device. Regular movement throughout the day supports spinal decompression and reduces postural fatigue.",
  },
};

const SEGMENT_COLORS: Record<keyof typeof POSTURE_AVERAGES, string> = {
  goodAlignment:  "#6DC96D",  // green
  leaningForward: "#FFD600",  // yellow
  spineRounding:  "#F5A623",  // orange
  highSpinalLoad: "#EC555E",  // red
  shiftingLeft:   "#F5A623",  // orange
  shiftingRight:  "#F5A623",  // orange
};

type Segment = { pct: number; color: string };

function ScoreBar() {
  const segments: Segment[] = (
    Object.keys(POSTURE_AVERAGES) as Array<keyof typeof POSTURE_AVERAGES>
  ).map((key) => ({
    pct:   POSTURE_AVERAGES[key],
    color: SEGMENT_COLORS[key],
  }));

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
}: {
  metricKey: string | null;
  onClose: () => void;
}) {
  if (!metricKey) return null;
  const info = METRIC_INFO[metricKey];
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
  const { logout, isAuthenticated, userId } = useAuth();
  const { showToast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  const loadProfile = () => {
    fetchCurrentUserProfileWithStats()
      .then((profile) => {
        setCurrentUser(profile ? userProfileToUser(profile) : null);
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
  
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular":  require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [activeInfo, setActiveInfo] = useState<string | null>(null);
  const { todaySteps, yesterdaySteps, isLoading } = useStepCount();

  const STATIC_STEPS = todaySteps;
  const PREV_STEPS   = yesterdaySteps;

  // % changes per metric (computed here so they use live step data)
  const scoreChange   = Math.round(((SCORE - PREV_SCORE)                  / PREV_SCORE)      * 100);
  const stepsChange   = PREV_STEPS > 0
    ? Math.round(((STATIC_STEPS - PREV_STEPS) / PREV_STEPS) * 100)
    : 0;
  const smoveChange   = Math.round(((STATIC_SMOVE_COMPLETED - PREV_SMOVE) / PREV_SMOVE)      * 100);
  const sessionChange = Math.round(((totalMins - prevSessionMins)          / prevSessionMins) * 100);

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

  const handleSettingsPress = () => {
    router.push("/settings");
  };

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

  const handleLogout = () => {
    logout();
    router.replace("/home");
  };

  if (!fontsLoaded) return null;

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <InfoModal metricKey={activeInfo} onClose={() => setActiveInfo(null)} />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <HeaderBar
          onSettingsPress={handleSettingsPress}
          streakDays={streak_days}
          username={currentUser?.name ?? "you"}
          onUsernameChange={handleUsernameChange}
          onLogOut={() => handleLogout()} // or your signOut() call
          weeklyPoints={weekly} // swap for real value when leaderboard is wired up
        />

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
          <ScoreBar />
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
            <Text style={styles.statValue}>{SCORE}</Text>
          </View>

          {/* S'move */}
          <View style={[styles.card, styles.gridCell, styles.shadow]}>
            <InfoButton onPress={() => setActiveInfo("smove")} />
            {topTwoKeys.has("smove") && <ChangeBadge value={smoveChange} />}
            <Text style={styles.statLabel}>s'move</Text>
            <Text style={styles.statValue}>
              {STATIC_SMOVE_COMPLETED}/{STATIC_SMOVE_TOTAL}
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