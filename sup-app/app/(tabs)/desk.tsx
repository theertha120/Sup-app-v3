/**
 * desk.tsx — Desk Mode screen
 *
 * Changes in this version:
 *   - SHS score badge removed (was always showing 100, misleading)
 *   - Figure colour uses shaded greens for non-upright states so user
 *     always knows there's room to improve even when "green"
 *   - Scrollable session stats breakdown below the figure
 *     showing time per state: session / today / week filters
 *   - Calibration prompt when neutral not yet captured
 */

import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  Pressable, Platform, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colours } from "../../theme/colours";
import DeskPostureFigure from "../../src/components/desk/DeskPostureFigure";
import { DeskPostureState } from "../../src/components/desk/mockDeskPostureData";
import { useIMUContext } from "../../src/contexts/IMUContext";
import CalibrationModal from "../../src/components/modals/CalibrationModal";
import {
  useSessionStats,
  formatDuration,
  formatPercent,
  StateTimeMap,
} from "../../src/hooks/useSessionStats";
import { router } from "expo-router";

// ── Posture colour system ─────────────────────────────────────────────────────
//
// Distinct shades so the user can always tell the difference between states.
// All non-upright states use a different shade of green/amber/red so
// the figure never looks "perfect" unless truly upright.

const STATE_COLORS: Record<DeskPostureState, string> = {
  upright:      "#4CAF50", // full green — ideal
  transition:   "#8BC34A", // light green — minor drift, improve-able
  forward_lean: "#CDDC39", // yellow-green — noticeable lean, stay aware
  slouched:     "#FF9800", // amber — loading up
  severe:       "#F44336", // red — act now
  tilted_left:  "#FF9800", // amber — lateral load
  tilted_right: "#FF9800",
};

const STATE_BG_COLORS: Record<DeskPostureState, string> = {
  upright:      "#E8F5E9",
  transition:   "#F1F8E9",
  forward_lean: "#F9FBE7",
  slouched:     "#FFF3E0",
  severe:       "#FFEBEE",
  tilted_left:  "#FFF3E0",
  tilted_right: "#FFF3E0",
};

// Posture state display info
const STATE_INFO: Record<DeskPostureState, { label: string; icon: string }> = {
  upright:      { label: "good alignment",    icon: "checkmark-circle" },
  transition:   { label: "slight forward shift", icon: "arrow-forward-circle" },
  forward_lean: { label: "leaning forward",   icon: "trending-up" },
  slouched:     { label: "spine rounding",    icon: "warning" },
  severe:       { label: "high spinal load",  icon: "alert-circle" },
  tilted_left:  { label: "shifting left",     icon: "arrow-back-circle" },
  tilted_right: { label: "shifting right",    icon: "arrow-forward-circle" },
};

// Posture tips
const POSTURE_TIPS: Record<DeskPostureState, string> = {
  upright:      "keep your feet flat, shoulders relaxed, and eyes level with the screen.",
  transition:   "you're starting to drift. try a gentle chest lift to reset.",
  forward_lean: "try moving your screen closer rather than leaning in.",
  slouched:     "engage your core and roll your shoulders back and down.",
  tilted_left:  "centre your weight evenly across both sit bones.",
  tilted_right: "centre your weight evenly across both sit bones.",
  severe:       "adjust your position now — even a small shift reduces disc pressure significantly.",
};

// The order states appear in the breakdown list
const STATE_ORDER: DeskPostureState[] = [
  "upright", "transition", "forward_lean", "slouched", "severe", "tilted_left", "tilted_right",
];

// ── Intervention Modal ────────────────────────────────────────────────────────

function InterventionModal() {
  const { activeIntervention, dismissIntervention } = useIMUContext();
  if (!activeIntervention) return null;
  return (
    <Modal visible transparent animationType="slide">
      <View style={iv.overlay}>
        <View style={iv.sheet}>
          <View style={iv.iconRow}>
            <View style={iv.iconBg}>
              <Ionicons name="body-outline" size={28} color={colours.primary} />
            </View>
          </View>
          <Text style={iv.title}>{activeIntervention.title}</Text>
          <Text style={iv.body}>{activeIntervention.body}</Text>
          <View style={iv.cueCard}>
            <Ionicons name="arrow-forward-circle-outline" size={18} color={colours.primary} />
            <Text style={iv.cueText}>{activeIntervention.cue}</Text>
          </View>
          <Text style={iv.question}>did you adjust your position?</Text>
          <View style={iv.buttonRow}>
            <Pressable style={iv.notYetBtn} onPress={() => dismissIntervention(false)}>
              <Text style={iv.notYetText}>not yet</Text>
            </Pressable>
            <Pressable style={iv.movedBtn} onPress={() => dismissIntervention(true)}>
              <Text style={iv.movedText}>yes, i moved ✓</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Movement Nudge Modal ──────────────────────────────────────────────────────

function MovementNudgeModal() {
  const { shouldNudge, confirmMovement } = useIMUContext();
  if (!shouldNudge) return null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={mv.overlay}>
        <View style={mv.card}>
          <Text style={mv.emoji}>🚶</Text>
          <Text style={mv.title}>time to move</Text>
          <Text style={mv.body}>
            you've been in the same position for a while. even a small shift significantly preserves lumbar and pelvic mobility.
          </Text>
          <Text style={mv.cue}>stand up, roll your shoulders, or just shift your weight.</Text>
          <Pressable style={mv.btn} onPress={confirmMovement}>
            <Text style={mv.btnText}>yes, i moved ✓</Text>
          </Pressable>
          <Pressable style={mv.skipBtn} onPress={confirmMovement}>
            <Text style={mv.skipText}>remind me later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Stats breakdown section ───────────────────────────────────────────────────

type StatFilter = "session" | "today" | "week";

function StatsBreakdown({
  sessionStats, todayStats, weekStats,
  sessionTotalMs, todayTotalMs,
  isTracking,
}: {
  sessionStats: StateTimeMap;
  todayStats:   StateTimeMap;
  weekStats:    StateTimeMap;
  sessionTotalMs: number;
  todayTotalMs:   number;
  isTracking: boolean;
}) {
  const [filter, setFilter] = useState<StatFilter>("session");

  const stats   = filter === "session" ? sessionStats : filter === "today" ? todayStats : weekStats;
  const totalMs = filter === "session" ? sessionTotalMs : filter === "today" ? todayTotalMs
    : Object.values(weekStats).reduce((s, v) => s + (v ?? 0), 0);

  const FILTERS: { key: StatFilter; label: string }[] = [
    { key: "session", label: "this session" },
    { key: "today",   label: "today" },
    { key: "week",    label: "last 7 days" },
  ];

  return (
    <View style={st.container}>
      <Text style={st.heading}>posture breakdown</Text>

      {/* Filter pills — similar to Apple Health segment picker */}
      <View style={st.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={[st.filterPill, filter === f.key && st.filterPillActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[st.filterText, filter === f.key && st.filterTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Total tracked time */}
      <Text style={st.totalTime}>
        {isTracking || totalMs > 0
          ? `${formatDuration(totalMs)} tracked`
          : "start tracking to see your breakdown"}
      </Text>

      {/* State rows — only show states with recorded time */}
      {totalMs === 0 ? (
        <View style={st.emptyState}>
          <Ionicons name="analytics-outline" size={32} color="#ccc" />
          <Text style={st.emptyText}>
            {isTracking ? "building your session data…" : "connect your s'pots to start tracking"}
          </Text>
        </View>
      ) : (
        <View style={st.stateList}>
          {STATE_ORDER.map((stateKey) => {
            const ms = stats[stateKey] ?? 0;
            if (ms === 0 && stateKey !== "upright") return null; // hide zeroed non-upright
            const pct     = totalMs > 0 ? (ms / totalMs) : 0;
            const color   = STATE_COLORS[stateKey];
            const bgColor = STATE_BG_COLORS[stateKey];
            const info    = STATE_INFO[stateKey];

            return (
              <View key={stateKey} style={st.stateRow}>
                {/* Left — icon + label */}
                <View style={[st.stateIconBg, { backgroundColor: bgColor }]}>
                  <Ionicons name={info.icon as any} size={16} color={color} />
                </View>
                <View style={st.stateTextCol}>
                  <Text style={st.stateLabel}>{info.label}</Text>
                  {/* Progress bar */}
                  <View style={st.barBg}>
                    <View style={[st.barFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: color }]} />
                  </View>
                </View>
                {/* Right — time + % */}
                <View style={st.stateMeta}>
                  <Text style={[st.stateTime, { color }]}>{formatDuration(ms)}</Text>
                  <Text style={st.statePct}>{formatPercent(ms, totalMs)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function DeskScreen() {
  const {
    topSensor, bottomSensor,
    posture, calibration, clinicalBaseline,
    bothConnected, timeInCurrentStateMs,
    isNeutralCalibrated,
  } = useIMUContext();

  const [showCalibModal, setShowCalibModal] = useState(false);

  const currentState = (posture?.state ?? "upright") as DeskPostureState;
  const isTracking   = bothConnected && isNeutralCalibrated;

  // Figure colour — state-based shade, not score-based
  const figureColor  = isTracking ? STATE_COLORS[currentState] : STATE_COLORS["upright"];
  const currentLabel = posture?.label       ?? "waiting for s'pots…";
  const currentDesc  = posture?.description ?? "connect your s'pots via s'pot setup.";
  const timeInStateMin = (timeInCurrentStateMs / 60000).toFixed(1);

  // Session stats
  const {
    sessionStats, todayStats, weekStats,
    sessionTotalMs, todayTotalMs,
  } = useSessionStats(isTracking ? currentState : undefined);

  return (
    <SafeAreaView style={styles.safe}>
      <CalibrationModal visible={showCalibModal} onClose={() => setShowCalibModal(false)} />
      <InterventionModal />
      <MovementNudgeModal />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>desk mode</Text>
            <Text style={styles.headerSub}>
              {!bothConnected
                ? "connect s'pots via s'pot setup"
                : !isNeutralCalibrated
                  ? "calibrate to start tracking"
                  : "live posture analysis"}
            </Text>
          </View>
          {!bothConnected && (
            <Pressable style={styles.setupLink} onPress={() => router.push("/sensor-setup")}>
              <Ionicons name="hardware-chip-outline" size={16} color={colours.primary} />
              <Text style={styles.setupLinkText}>setup</Text>
            </Pressable>
          )}
        </View>

        {/* Connection pills */}
        <View style={styles.pillRow}>
          {(["top", "bottom"] as const).map((slot) => {
            const sensor    = slot === "top" ? topSensor : bottomSensor;
            const connected = sensor.state.connected;
            return (
              <View key={slot} style={[styles.pill, { backgroundColor: connected ? "#E8F5E9" : "#F5F5F5" }]}>
                <View style={[styles.pillDot, { backgroundColor: connected ? "#4CAF50" : "#ccc" }]} />
                <Text style={[styles.pillText, { color: connected ? "#2E7D32" : "#999" }]}>
                  {slot} s'pot {connected ? "connected" : "disconnected"}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Calibration banner */}
        {bothConnected && !isNeutralCalibrated && (
          <Pressable style={styles.calibrateBanner} onPress={() => setShowCalibModal(true)}>
            <Ionicons name="warning-outline" size={18} color="#E65100" />
            <View style={{ flex: 1 }}>
              <Text style={styles.calibrateBannerTitle}>calibration needed</Text>
              <Text style={styles.calibrateBannerSub}>
                complete step 1 (neutral upright) to start posture tracking
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#E65100" />
          </Pressable>
        )}

        {/* Figure card — no score badge, just state label + figure */}
        <View style={[styles.figureCard, { borderColor: figureColor + "33" }]}>

          {/* State label strip at top of card */}
          {isTracking && (
            <View style={[styles.stateLabelStrip, { backgroundColor: STATE_BG_COLORS[currentState] }]}>
              <Ionicons
                name={STATE_INFO[currentState].icon as any}
                size={14}
                color={figureColor}
              />
              <Text style={[styles.stateLabelText, { color: figureColor }]}>
                {STATE_INFO[currentState].label}
              </Text>
              {currentState !== "upright" && (
                <Text style={[styles.stateLabelHint, { color: figureColor }]}>
                  {timeInStateMin}m
                </Text>
              )}
            </View>
          )}

          {/* Figure */}
          <View style={styles.figureWrapper}>
            <DeskPostureFigure
              state={currentState}
              score={
                // Pass a pseudo-score that maps to the right colour shade
                currentState === "upright"      ? 95 :
                currentState === "transition"   ? 75 :
                currentState === "forward_lean" ? 62 :
                currentState === "tilted_left"  ? 55 :
                currentState === "tilted_right" ? 55 :
                currentState === "slouched"     ? 42 :
                20 // severe
              }
            />
          </View>

          {/* Description */}
          <View style={styles.stateInfo}>
            <Text style={styles.stateDescription}>
              {isTracking ? currentDesc : bothConnected
                ? "tap 'calibrate posture' below and complete step 1 to start tracking."
                : "connect both s'pots to begin."}
            </Text>
            {isTracking && posture && (
              <Text style={styles.debugText}>
                Δpitch {posture.pitchDiff.toFixed(1)}°  Δroll {posture.rollDiff.toFixed(1)}°
              </Text>
            )}
          </View>
        </View>

        {/* Calibrate button */}
        {bothConnected && (
          <Pressable style={styles.calibrateBtn} onPress={() => setShowCalibModal(true)}>
            <Ionicons name="sync-outline" size={16} color={colours.primary} />
            <Text style={styles.calibrateBtnText}>
              {calibration.isComplete
                ? "re-calibrate posture"
                : isNeutralCalibrated
                  ? "continue calibration"
                  : "calibrate posture"}
            </Text>
            {calibration.isComplete && (
              <View style={styles.calibratedBadge}>
                <Text style={styles.calibratedBadgeText}>✓</Text>
              </View>
            )}
          </Pressable>
        )}

        {/* Tip card */}
        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Ionicons name="bulb-outline" size={16} color={colours.primary} />
            <Text style={styles.tipTitle}>tip</Text>
          </View>
          <Text style={styles.tipText}>
            {POSTURE_TIPS[currentState]}
          </Text>
        </View>

        {/* Stats breakdown — the main new section */}
        <StatsBreakdown
          sessionStats={sessionStats}
          todayStats={todayStats}
          weekStats={weekStats}
          sessionTotalMs={sessionTotalMs}
          todayTotalMs={todayTotalMs}
          isTracking={isTracking}
        />

        {/* Raw sensor detail — keep for debugging */}
        {bothConnected && (
          <View style={styles.sensorDetailRow}>
            {[
              { label: "top s'pot", data: topSensor.latest },
              { label: "bottom s'pot", data: bottomSensor.latest },
            ].map(({ label, data }) => (
              <View key={label} style={styles.sensorDetailCard}>
                <Text style={styles.sensorDetailTitle}>{label}</Text>
                {data ? (
                  <>
                    <Text style={styles.sensorDetailValue}>pitch {data.angle.pitch.toFixed(1)}°</Text>
                    <Text style={styles.sensorDetailValue}>roll  {data.angle.roll.toFixed(1)}°</Text>
                    <Text style={styles.sensorDetailValue}>yaw   {data.angle.yaw.toFixed(1)}°</Text>
                  </>
                ) : (
                  <Text style={styles.sensorDetailValue}>waiting…</Text>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Intervention modal styles ─────────────────────────────────────────────────

const iv = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:     { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, paddingBottom: 44 },
  iconRow:   { alignItems: "center", marginBottom: 16 },
  iconBg:    { width: 56, height: 56, borderRadius: 28, backgroundColor: "#F0EDFF", alignItems: "center", justifyContent: "center" },
  title:     { fontSize: 18, fontWeight: "700", color: colours.textPrimary, marginBottom: 12, textAlign: "center" },
  body:      { fontSize: 13, color: colours.textSecondary, lineHeight: 20, marginBottom: 16, textAlign: "center" },
  cueCard:   { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F5F3FF", borderRadius: 12, padding: 14, marginBottom: 20 },
  cueText:   { fontSize: 13, color: colours.primary, flex: 1, lineHeight: 19, fontWeight: "500" },
  question:  { fontSize: 14, fontWeight: "600", color: colours.textPrimary, textAlign: "center", marginBottom: 14 },
  buttonRow: { flexDirection: "row", gap: 10 },
  notYetBtn: { flex: 1, paddingVertical: 14, borderRadius: 30, borderWidth: 1.5, borderColor: colours.border, alignItems: "center" },
  notYetText:{ fontSize: 14, fontWeight: "600", color: colours.textSecondary },
  movedBtn:  { flex: 2, paddingVertical: 14, borderRadius: 30, backgroundColor: "#4CAF50", alignItems: "center" },
  movedText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});

// ── Movement nudge modal styles ───────────────────────────────────────────────

const mv = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  card:     { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", alignItems: "center" },
  emoji:    { fontSize: 40, marginBottom: 12 },
  title:    { fontSize: 20, fontWeight: "700", color: colours.textPrimary, marginBottom: 10 },
  body:     { fontSize: 13, color: colours.textSecondary, textAlign: "center", lineHeight: 19, marginBottom: 12 },
  cue:      { fontSize: 13, fontWeight: "500", color: colours.primary, textAlign: "center", marginBottom: 20 },
  btn:      { backgroundColor: colours.primary, borderRadius: 30, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 10 },
  btnText:  { fontSize: 14, fontWeight: "700", color: "#fff" },
  skipBtn:  { paddingVertical: 8 },
  skipText: { fontSize: 13, color: colours.textSecondary },
});

// ── Stats breakdown styles ────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    alignSelf: "stretch",  // ← was missing, makes it full width like other cards
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  heading: { fontSize: 16, fontWeight: "700", color: colours.textPrimary, marginBottom: 14 },

  filterRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  filterPill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,   // ← minimal horizontal padding, let flex do the work
    borderRadius: 20,
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
  },
  filterPillActive: { backgroundColor: colours.primary },
  filterText:       { fontSize: 12, fontWeight: "600", color: colours.textSecondary, textAlign: "center" },
  filterTextActive: { color: "#fff" },

  totalTime: { fontSize: 13, color: colours.textSecondary, marginBottom: 16, textAlign: "center" },

  emptyState: { alignItems: "center", paddingVertical: 24, gap: 10 },
  emptyText:  { fontSize: 13, color: "#bbb", textAlign: "center" },

  stateList: { gap: 14 },
  stateRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  stateIconBg: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  stateTextCol: { flex: 1, gap: 4, minWidth: 0 },  // ← minWidth: 0 allows flex child to shrink
  stateLabel:   { fontSize: 13, color: colours.textPrimary, fontWeight: "500" },
  barBg:    { height: 5, backgroundColor: "#F0F0F0", borderRadius: 3, overflow: "hidden" },
  barFill:  { height: 5, borderRadius: 3 },
  stateMeta: { alignItems: "flex-end", flexShrink: 0, minWidth: 52 },
  stateTime: { fontSize: 13, fontWeight: "700" },
  statePct:  { fontSize: 11, color: colours.textSecondary },
});

// ── Screen styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colours.background },
  container: { paddingHorizontal: 20, paddingTop: 8, alignItems: "center" },

  header:        { alignSelf: "stretch", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerTitle:   { fontSize: 26, fontWeight: "700", color: colours.textPrimary },
  headerSub:     { fontSize: 14, color: colours.textSecondary, marginTop: 2 },
  setupLink:     { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: colours.primary, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  setupLinkText: { fontSize: 13, fontWeight: "600", color: colours.primary },

  pillRow: { alignSelf: "stretch", flexDirection: "row", gap: 8, marginBottom: 12 },
  pill:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText:{ fontSize: 12, fontWeight: "600" },

  calibrateBanner: {
    alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#FFF3E0", borderRadius: 14, padding: 14, marginBottom: 14,
  },
  calibrateBannerTitle: { fontSize: 13, fontWeight: "700", color: "#E65100" },
  calibrateBannerSub:   { fontSize: 12, color: "#BF360C", marginTop: 2, lineHeight: 17 },

  figureCard: {
    backgroundColor: "#fff", borderRadius: 20, alignSelf: "stretch",
    marginBottom: 16, overflow: "hidden", borderWidth: 1.5,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  stateLabelStrip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  stateLabelText: { fontSize: 14, fontWeight: "700", flex: 1 },
  stateLabelHint: { fontSize: 12, fontWeight: "500", opacity: 0.7 },

  figureWrapper:    { alignItems: "center", paddingVertical: 8 },
  stateInfo:        { paddingHorizontal: 16, paddingBottom: 16, alignItems: "center" },
  stateDescription: { fontSize: 14, color: colours.textSecondary, textAlign: "center", lineHeight: 20 },
  debugText:        { fontSize: 10, color: "#ccc", marginTop: 6, fontFamily: "monospace" },

  calibrateBtn: {
    alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderColor: colours.primary, borderRadius: 30,
    paddingVertical: 12, paddingHorizontal: 22, backgroundColor: "#fff",
    justifyContent: "center", marginBottom: 14,
  },
  calibrateBtnText:    { fontSize: 14, fontWeight: "600", color: colours.primary },
  calibratedBadge:     { backgroundColor: "#4CAF50", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  calibratedBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  tipCard:   { backgroundColor: colours.primarySoft, borderRadius: 14, padding: 14, alignSelf: "stretch", marginBottom: 16 },
  tipHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  tipTitle:  { fontSize: 13, fontWeight: "700", color: colours.primary },
  tipText:   { fontSize: 13, color: colours.textPrimary, lineHeight: 19 },

  sensorDetailRow:   { alignSelf: "stretch", flexDirection: "row", gap: 10, marginBottom: 16 },
  sensorDetailCard:  { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colours.border },
  sensorDetailTitle: { fontSize: 12, fontWeight: "700", color: colours.primary, marginBottom: 6 },
  sensorDetailValue: { fontSize: 12, color: colours.textSecondary, lineHeight: 18 },
});