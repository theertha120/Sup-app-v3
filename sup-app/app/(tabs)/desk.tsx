/**
 * desk.tsx — Desk Mode screen
 *
 * Shows live posture + current session data only.
 * Charts and historical breakdown moved to stats.tsx.
 *
 * Session data shown:
 *   - Live posture figure + state label
 *   - Session duration (time s'pots have been connected)
 *   - Time in current state
 *   - Session posture breakdown (upright %, forward %, etc.)
 *   - CPL indicator (cumulative postural load)
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  Pressable, Platform, Modal, Dimensions, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colours } from "../../theme/colours";
import { useFonts } from "expo-font";
import Svg, { Defs, RadialGradient, Stop, Ellipse } from "react-native-svg";
import HeaderBar from "@/src/components/ui/HeaderBar";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

import DeskPostureFigure from "../../src/components/desk/DeskPostureFigure";
import { DeskPostureState, getScoreColor, getScoreLabel } from "../../src/components/desk/mockDeskPostureData";
import { useIMUContext } from "../../src/contexts/IMUContext";
import CalibrationModal from "../../src/components/modals/CalibrationModal";
import { useSessionStats, formatDuration, StateTimeMap } from "../../src/hooks/useSessionStats";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";

// ── Posture colour system ─────────────────────────────────────────────────────

const STATE_COLORS: Record<DeskPostureState, string> = {
  upright:      "#4CAF50",
  transition:   "#8BC34A",
  forward_lean: "#CDDC39",
  slouched:     "#FF9800",
  severe:       "#F44336",
  tilted_left:  "#FF9800",
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

const STATE_INFO: Record<DeskPostureState, { label: string; icon: string }> = {
  upright:      { label: "good alignment",       icon: "checkmark-circle" },
  transition:   { label: "slight forward shift",  icon: "arrow-forward-circle" },
  forward_lean: { label: "leaning forward",       icon: "trending-up" },
  slouched:     { label: "spine rounding",        icon: "warning" },
  severe:       { label: "high spinal load",      icon: "alert-circle" },
  tilted_left:  { label: "shifting left",         icon: "arrow-back-circle" },
  tilted_right: { label: "shifting right",        icon: "arrow-forward-circle" },
};


const STATE_ORDER: DeskPostureState[] = [
  "upright", "transition", "forward_lean", "slouched", "severe", "tilted_left", "tilted_right",
];

// ── Session stats row ─────────────────────────────────────────────────────────

function SessionStatsRow({
  sessionDurationMs,
  timeInCurrentStateMs,
  currentState,
  cpl,
}: {
  sessionDurationMs: number;
  timeInCurrentStateMs: number;
  currentState: DeskPostureState;
  cpl: number;
}) {
  // CPL bar — max display at 1500 (above that is red zone regardless)
  const cplPct    = Math.min(cpl / 1500, 1);
  const cplColor  = cpl < 600 ? "#4CAF50" : cpl < 1000 ? "#FF9800" : "#F44336";
  const cplLabel  = cpl < 600 ? "low load" : cpl < 1000 ? "building up" : "high load";

  return (
    <View style={ss.container}>
      {/* Session duration + state time */}
      <View style={ss.timeRow}>
        <View style={ss.timeBlock}>
          <Text style={ss.timeValue}>{formatDuration(sessionDurationMs)}</Text>
          <Text style={ss.timeLabel}>session time</Text>
        </View>
        <View style={ss.timeDivider} />
        <View style={ss.timeBlock}>
          <Text style={[ss.timeValue, { color: STATE_COLORS[currentState] }]}>
            {formatDuration(timeInCurrentStateMs)}
          </Text>
          <Text style={ss.timeLabel}>in current state</Text>
        </View>
      </View>

      {/* CPL bar */}
      <View style={ss.cplSection}>
        <View style={ss.cplHeader}>
          <Text style={ss.cplLabel}>cumulative spinal load</Text>
          <Text style={[ss.cplValue, { color: cplColor }]}>{cplLabel}</Text>
        </View>
        <View style={ss.cplBarBg}>
          <View style={[ss.cplBarFill, { width: `${Math.round(cplPct * 100)}%` as any, backgroundColor: cplColor }]} />
        </View>
        <Text style={ss.cplHint}>
          accumulates across posture bouts — short breaks barely reset it
        </Text>
      </View>
    </View>
  );
}

// ── Session posture breakdown ─────────────────────────────────────────────────

function SessionBreakdown({
  sessionStats, sessionTotalMs, isTracking,
}: {
  sessionStats: StateTimeMap;
  sessionTotalMs: number;
  isTracking: boolean;
}) {
  if (!isTracking || sessionTotalMs === 0) return null;

  const uprightMs = sessionStats.upright ?? 0;
  const goodPct   = sessionTotalMs > 0 ? Math.round((uprightMs / sessionTotalMs) * 100) : 0;

  return (
    <View style={sb.container}>
      <View style={sb.header}>
        <Text style={sb.title}>session breakdown</Text>
        <Text style={[sb.goodPct, { color: goodPct >= 70 ? "#4CAF50" : goodPct >= 50 ? "#FF9800" : "#F44336" }]}>
          {goodPct}% aligned
        </Text>
      </View>

      {/* Stacked horizontal bar */}
      <View style={sb.stackedBar}>
        {STATE_ORDER.map((stateKey) => {
          const ms  = sessionStats[stateKey] ?? 0;
          const pct = sessionTotalMs > 0 ? (ms / sessionTotalMs) * 100 : 0;
          if (pct < 1) return null;
          return (
            <View
              key={stateKey}
              style={{ width: `${pct}%` as any, backgroundColor: STATE_COLORS[stateKey], height: "100%" }}
            />
          );
        })}
      </View>

      {/* State rows — only non-zero */}
      <View style={sb.rows}>
        {STATE_ORDER.map((stateKey) => {
          const ms  = sessionStats[stateKey] ?? 0;
          if (ms === 0) return null;
          const pct   = sessionTotalMs > 0 ? Math.round((ms / sessionTotalMs) * 100) : 0;
          const color = STATE_COLORS[stateKey];
          const info  = STATE_INFO[stateKey];
          return (
            <View key={stateKey} style={sb.row}>
              <View style={[sb.dot, { backgroundColor: color }]} />
              <Text style={sb.stateLabel}>{info.label}</Text>
              <Text style={[sb.statePct, { color }]}>{pct}%</Text>
              <Text style={sb.stateTime}>{formatDuration(ms)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

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

export default function DeskScreen() {
  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  // ── Use the global context — NOT a local hook ──────────────────────────────
  const {
    topSensor, bottomSensor,
    posture,
    bothConnected, timeInCurrentStateMs,
    sessionDurationMs, cpl,
    isNeutralCalibrated, shs,
    sessionStartTimeMs,
    disconnectAll,
  } = useIMUContext();

  const handleDisconnectAll = useCallback(() => {
    if (!topSensor.state.connected && !bottomSensor.state.connected) return;
    Alert.alert(
      "disconnect both s'pots?",
      "this will end the current session and disconnect both sensors. your saved pairings stay intact.",
      [
        { text: "cancel", style: "cancel" },
        { text: "disconnect", style: "destructive", onPress: async () => { try { await disconnectAll(); } catch (e) { console.warn("[Desk] Failed to disconnect:", e); } } },
      ]
    );
  }, [topSensor.state.connected, bottomSensor.state.connected, disconnectAll]);

  // --- Desk UI figure throttle: snapshot posture for figure/label only every 3 seconds ---
  const DESK_UI_UPDATE_MS = 3 * 1000; // 3 seconds
  const livePostureRef = useRef(posture);
  const [displayPosture, setDisplayPosture] = useState(posture);

  useEffect(() => { livePostureRef.current = posture; }, [posture]);

  useFocusEffect(
    useCallback(() => {
      // immediate snap on focus
      setDisplayPosture(livePostureRef.current);
    }, [])
  );

  useEffect(() => {
    // periodic snapshot for figure to reduce flicker
    const id = setInterval(() => {
      setDisplayPosture(livePostureRef.current);
    });
    return () => clearInterval(id);
  }, []);

  const [showCalibModal, setShowCalibModal] = useState(false);

  // use the throttled posture for the figure/label to avoid flicker
  const currentState   = (displayPosture?.state ?? posture?.state ?? "upright") as DeskPostureState;
  const isTracking     = bothConnected && isNeutralCalibrated;
  const figureColor    = isTracking ? STATE_COLORS[currentState] : STATE_COLORS["upright"];
  const currentDesc    = (displayPosture?.description ?? posture?.description) ?? "connect your s'pots via s'pot setup.";

  // Ensure the visible numeric 'score' shown on the avatar follows the
  // throttled `displayPosture` (so it updates with the avatar every 3 seconds).
  const displayScore = (
    (displayPosture?.state ?? posture?.state) === "upright"      ? 95 :
    (displayPosture?.state ?? posture?.state) === "transition"   ? 75 :
    (displayPosture?.state ?? posture?.state) === "forward_lean" ? 62 :
    (displayPosture?.state ?? posture?.state) === "tilted_left"  ? 55 :
    (displayPosture?.state ?? posture?.state) === "tilted_right" ? 55 :
    (displayPosture?.state ?? posture?.state) === "slouched"     ? 42 : 20
  );

  const shsColor     = getScoreColor(shs);
  const shsLabel     = getScoreLabel(shs);
  const timeInStateMin = (timeInCurrentStateMs / 60000).toFixed(2);

  const { sessionStats, sessionTotalMs } = useSessionStats(isTracking ? currentState : undefined);

  if (!fontsLoaded) return null;

  return (
    <View style={s.safe}>
      <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="d1" cx="50%" cy="50%" r="50%">
            <Stop offset="0%"   stopColor="rgba(179, 163, 225, 1)" stopOpacity="1" />
            <Stop offset="100%" stopColor="rgba(179, 163, 225, 0)" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="d2" cx="50%" cy="50%" r="50%">
            <Stop offset="0%"   stopColor="rgba(163, 218, 225, 1)" stopOpacity="1" />
            <Stop offset="100%" stopColor="rgba(163, 218, 225, 0)" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={SCREEN_W * 0.05} cy={SCREEN_H * 0.05} rx={320} ry={320} fill="url(#d1)" />
        <Ellipse cx={SCREEN_W * 0.95} cy={SCREEN_H * 0.95} rx={320} ry={320} fill="url(#d2)" />
      </Svg>
      <CalibrationModal visible={showCalibModal} onClose={() => setShowCalibModal(false)} />
      {/*<InterventionModal />*/}
      {/*<MovementNudgeModal />*/}

      <ScrollView showsVerticalScrollIndicator={false}>
        <HeaderBar suffix="it up" logoSize={28} />

        <View style={s.container}>
        {/* Connection pills */}
        <View style={s.pillRow}>
          {(["top", "bottom"] as const).map((slot) => {
            const sensor    = slot === "top" ? topSensor : bottomSensor;
            const connected = sensor.state.connected;
            return (
              <View key={slot} style={[s.pill, { backgroundColor: connected ? "#E8F5E9" : "#F5F5F5" }]}>
                <View style={[s.pillDot, { backgroundColor: connected ? "#4CAF50" : "#ccc" }]} />
                <Text style={[s.pillText, { color: connected ? "#2E7D32" : "#999" }]}>
                  {slot} s'pot {connected ? "connected" : "disconnected"}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Calibration banner */}
        {bothConnected && !isNeutralCalibrated && (
          <Pressable style={s.calibrateBanner} onPress={() => setShowCalibModal(true)}>
            <Ionicons name="warning-outline" size={18} color="#E65100" />
            <View style={{ flex: 1 }}>
              <Text style={s.calibrateBannerTitle}>calibration needed</Text>
              <Text style={s.calibrateBannerSub}>complete step 1 to start posture tracking</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#E65100" />
          </Pressable>
        )}

        {/* Figure card */}
        <View style={[s.figureCard, { borderColor: figureColor + "33" }]}>
          {isTracking && (
            <View style={[s.stateLabelStrip, { backgroundColor: STATE_BG_COLORS[currentState] }]}>
              <Ionicons name={STATE_INFO[currentState].icon as any} size={14} color={figureColor} />
              <Text style={[s.stateLabelText, { color: figureColor }]}>
                {STATE_INFO[currentState].label}
              </Text>
            </View>
          )}
          <View style={s.figureWrapper}>
            <DeskPostureFigure
              state={currentState}
              score={displayScore}
            />
          </View>
          <View style={s.stateInfo}>
            <Text style={s.stateDescription}>
              {isTracking ? currentDesc
                : bothConnected ? "tap 'calibrate posture' below and complete step 1."
                : "connect both s'pots to begin."}
            </Text>
            {isTracking && posture && (
              <Text style={s.debugText}>
                Δpitch {posture.pitchDiff.toFixed(2)}°  Δroll {posture.rollDiff.toFixed(2)}°{"  "}{timeInStateMin}min
              </Text>
            )}
          </View>
        </View>

        {/* Action buttons */}
        {(topSensor.state.connected || bottomSensor.state.connected) && (
          <View style={s.actionRow}>
            <Pressable style={s.updateBtn} onPress={() => setShowCalibModal(true)}>
              <Text style={s.updateBtnText}>s'update</Text>
            </Pressable>
            <Pressable style={s.disconnectBtn} onPress={handleDisconnectAll}>
              <Text style={s.disconnectBtnText}>end s'ession</Text>
            </Pressable>
          </View>
        )}

        {/* Session stats — only when tracking */}
        {isTracking && (
          <SessionStatsRow
            sessionDurationMs={sessionDurationMs}
            timeInCurrentStateMs={timeInCurrentStateMs}
            currentState={currentState}
            cpl={cpl}
          />
        )}

        {/* Session posture breakdown */}
        <SessionBreakdown
          sessionStats={sessionStats}
          sessionTotalMs={sessionTotalMs}
          isTracking={isTracking}
        />

        {/* Raw sensor debug */}
        {bothConnected && (
          <View style={s.sensorDetailRow}>
            {[
              { label: "top s'pot",    data: topSensor.latest },
              { label: "bottom s'pot", data: bottomSensor.latest },
            ].map(({ label, data }) => (
              <View key={label} style={s.sensorDetailCard}>
                <Text style={s.sensorDetailTitle}>{label}</Text>
                {data ? (
                  <>
                    <Text style={s.sensorDetailValue}>pitch {data.angle.pitch.toFixed(2)}°</Text>
                    <Text style={s.sensorDetailValue}>roll  {data.angle.roll.toFixed(2)}°</Text>
                    <Text style={s.sensorDetailValue}>yaw   {data.angle.yaw.toFixed(2)}°</Text>
                  </>
                ) : (
                  <Text style={s.sensorDetailValue}>waiting…</Text>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 32 }} />
        </View>
      </ScrollView>
    </View>
  );
}

// ── Session stats styles ──────────────────────────────────────────────────────

const ss = StyleSheet.create({
  container: {
    backgroundColor: "#fff", borderRadius: 20, padding: 16,
    alignSelf: "stretch", marginBottom: 16,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  timeRow:     { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  timeBlock:   { flex: 1, alignItems: "center" },
  timeValue:   { fontSize: 22, fontWeight: "800", color: colours.textPrimary },
  timeLabel:   { fontSize: 11, color: colours.textSecondary, marginTop: 2 },
  timeDivider: { width: 1, height: 36, backgroundColor: "#E0E0E0" },
  cplSection:  { gap: 6 },
  cplHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cplLabel:    { fontSize: 12, color: colours.textSecondary },
  cplValue:    { fontSize: 12, fontWeight: "700" },
  cplBarBg:    { height: 8, backgroundColor: "#F0F0F0", borderRadius: 4, overflow: "hidden" },
  cplBarFill:  { height: 8, borderRadius: 4 },
  cplHint:     { fontSize: 11, color: "#bbb" },
});

// ── Session breakdown styles ──────────────────────────────────────────────────

const sb = StyleSheet.create({
  container: {
    backgroundColor: "#fff", borderRadius: 20, padding: 16,
    alignSelf: "stretch", marginBottom: 16,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  header:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title:     { fontSize: 15, fontWeight: "700", color: colours.textPrimary },
  goodPct:   { fontSize: 15, fontWeight: "800" },
  stackedBar:{ height: 10, borderRadius: 5, overflow: "hidden", flexDirection: "row", marginBottom: 14, backgroundColor: "#F0F0F0" },
  rows:      { gap: 10 },
  row:       { flexDirection: "row", alignItems: "center", gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  stateLabel:{ flex: 1, fontSize: 13, color: colours.textPrimary },
  statePct:  { fontSize: 13, fontWeight: "700", minWidth: 36, textAlign: "right" },
  stateTime: { fontSize: 12, color: colours.textSecondary, minWidth: 40, textAlign: "right" },
});

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

// ── Movement nudge styles ─────────────────────────────────────────────────────

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

// ── Screen styles ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#fff" },
  container: { paddingHorizontal: 20, paddingTop: 8, alignItems: "center" },

  pillRow: { alignSelf: "stretch", flexDirection: "row", gap: 8, marginBottom: 16 },
  pill:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText:{ fontSize: 12, fontWeight: "600" },

  calibrateBanner:      { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF3E0", borderRadius: 14, padding: 14, marginBottom: 14 },
  calibrateBannerTitle: { fontSize: 13, fontWeight: "700", color: "#E65100" },
  calibrateBannerSub:   { fontSize: 12, color: "#BF360C", marginTop: 2, lineHeight: 17 },

  figureCard: {
    backgroundColor: "#fff", borderRadius: 20, alignSelf: "stretch",
    marginBottom: 16, overflow: "hidden", borderWidth: 1.5,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  stateLabelStrip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  stateLabelText:  { fontSize: 14, fontWeight: "700", flex: 1 },
  figureWrapper:   { alignItems: "center", paddingVertical: 8 },
  stateInfo:       { paddingHorizontal: 16, paddingBottom: 16, alignItems: "center" },
  stateDescription:{ fontSize: 14, color: colours.textSecondary, textAlign: "center", lineHeight: 20 },
  debugText:       { fontSize: 10, color: "#ccc", marginTop: 6, fontFamily: "monospace" },

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

  actionRow:         { alignSelf: "stretch", flexDirection: "row", gap: 12, marginBottom: 24 },

  updateBtn:         { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 30, backgroundColor: "#AB99FA" },
  updateBtnText:     { fontSize: 15, fontWeight: "700", color: "#fff" },

  disconnectBtn:     { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 30, borderWidth: 1.5, borderColor: "#D32F2F", backgroundColor: "#fff" },
  disconnectBtnText: { fontSize: 15, fontWeight: "700", color: "#D32F2F" },
});

const dbg = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 10,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 50,
  },
  line: { color: "#fff", fontSize: 11, fontWeight: "600" },
});