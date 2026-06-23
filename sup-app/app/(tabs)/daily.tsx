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
import { useFonts } from "expo-font";
import React, { useRef, useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

// Static data — swap these out when connecting to real data
const avg_SHS_today = 72;            // 0–100 spine health score average
const tracked_any_session_today = true;
const totalTrackedMs_today = (7 * 60 + 21) * 60 * 1000; // 7 h 21 m
const streak_days = 4;
const PREV_SCORE      = 63;
const PREV_STEPS      = 6620;
const PREV_SMOVE      = 3;          // completed moves yesterday
const PREV_SESSION_MS = (6 * 60 + 45) * 60 * 1000;
const STATIC_STEPS           = 4640;
const STATIC_SMOVE_COMPLETED = 2;
const STATIC_SMOVE_TOTAL     = 5;
const STATIC_SNAPSHOT_MESSAGE_1 =
  "you have been leaning forward for too long, take a stretch break immediately";
const STATIC_SNAPSHOT_MESSAGE_2 =
  "stand up before 3:30 pm to stay ahead of posture dips and missed walking breaks";

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

// % changes per metric
const scoreChange   = Math.round(((SCORE - PREV_SCORE)                       / PREV_SCORE)      * 100);
const stepsChange   = Math.round(((STATIC_STEPS - PREV_STEPS)                / PREV_STEPS)      * 100);
const smoveChange   = Math.round(((STATIC_SMOVE_COMPLETED - PREV_SMOVE)      / PREV_SMOVE)      * 100);
const sessionChange = Math.round(((totalMins - prevSessionMins)               / prevSessionMins) * 100);

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

// Score bar: good % = score (0–100)
const SCORE_BAR_GOOD_PERCENT = Math.min(100, Math.max(0, SCORE));
// 

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const PRIMARY_TEXT = "#3F2483";

const METRIC_INFO: Record<string, { title: string; body: string }> = {
  snapshot: {
    title: "s'napshot",
    body: "A real-time summary of your posture health. The bar shows how your spine health score breaks down across your session — green is strong, yellow is fair, red needs attention. Tips below are personalised to your current posture patterns.",
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
      <Ellipse
        cx={SCREEN_W * 0.78}
        cy={SCREEN_H * 0.12}
        rx={190}
        ry={190}
        fill="rgba(225, 163, 175, 0.62)"
        filter="url(#blur1)"
      />
      <Ellipse
        cx={SCREEN_W * 0.08}
        cy={SCREEN_H * 0.45}
        rx={155}
        ry={155}
        fill="rgba(179, 163, 225, 0.62)"
        filter="url(#blur2)"
      />
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

/** Gradient score bar: green → yellow → red */
function ScoreBar() {
  const goodPct = SCORE_BAR_GOOD_PERCENT;
  const midPct  = Math.min(100 - goodPct, 20);
  const badPct  = 100 - goodPct - midPct;

  return (
    <View style={[scoreBarStyles.track, scoreBarStyles.shadow]}>
      <View style={[scoreBarStyles.segment, { flex: goodPct, backgroundColor: "#6DC96D" }]} />
      {midPct > 0 && (
        <View style={[scoreBarStyles.segment, { flex: midPct, backgroundColor: "#F5C842" }]} />
      )}
      {badPct > 0 && (
        <View style={[scoreBarStyles.segment, { flex: badPct, backgroundColor: "#E8706A" }]} />
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
    <View style={[badgeStyles.pill, { backgroundColor: isUp ? "#6DC96D" : "#E8706A" }]}>
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
    fontFamily: "Agrandir-TextBold",
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
    backgroundColor: "rgba(143, 122, 230, 0.55)",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 20,
  },
  closeBtnText: {
    fontFamily: "Agrandir-TextBold",
    fontSize: 14,
    color: "white",
  },
});

export default function DailyScreen() {
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular":  require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-TextBold": require("../../assets/fonts/Agrandir-TextBold.otf"),
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [activeInfo, setActiveInfo] = useState<string | null>(null);

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

      <InfoModal metricKey={activeInfo} onClose={() => setActiveInfo(null)} />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.logo}>
            s<Text style={styles.logoApostrophe}>'</Text>up
          </Text>
          <View style={styles.headerButtons}>
            <Pressable style={styles.iconButton} onPress={() => router.push("/sensor-setup")}>
              <Ionicons name="hardware-chip-outline" size={22} color={PRIMARY_TEXT} />
            </Pressable>
            <Pressable style={styles.iconButton}>
              <Ionicons name="flame-outline" size={22} color={PRIMARY_TEXT} />
            </Pressable>
            <View style={styles.iconButton}>
              <Ionicons name="person-circle-outline" size={22} color={PRIMARY_TEXT} />
            </View>
          </View>
        </View>

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
              {STATIC_STEPS.toLocaleString()}
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
    fontFamily: "Agrandir-TextBold",
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
    fontFamily: "Agrandir-TextBold",
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
    shadowColor: "#3F2483",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 5,
  },
  cardTitle: {
    fontFamily: "Agrandir-TextBold",
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
    fontFamily: "Agrandir-TextBold",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.75,
    marginBottom: 4,
  },
  statValue: {
    fontFamily: "Agrandir-TextBold",
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