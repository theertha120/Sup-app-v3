/**
 * desk.tsx — Desk Mode screen
 *
 * Uses the global IMUContext for live s'pot data.
 * Score badge = SHS (Spine Health Score) — session-accumulated.
 * Figure colour = instantScore — immediate posture quality.
 * Intervention alerts shown when posture held beyond clinical threshold.
 * Movement nudge shown when static for 20+ min.
 * Calibration prompt shown when neutral offset not yet captured.
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
import { getScoreColor, getScoreLabel } from "../../src/components/desk/mockDeskPostureData";
import { useIMUContext } from "../../src/contexts/IMUContext";
import CalibrationModal from "../../src/components/modals/CalibrationModal";
import { router } from "expo-router";

// ── Posture tips ──────────────────────────────────────────────────────────────

const POSTURE_TIPS: Record<string, string> = {
  upright:      "keep your feet flat, shoulders relaxed, and eyes level with the screen.",
  transition:   "you're starting to drift. try a gentle chest lift to reset.",
  forward_lean: "try moving your screen closer rather than leaning in.",
  slouched:     "engage your core and roll your shoulders back and down.",
  tilted_left:  "centre your weight evenly across both sit bones.",
  tilted_right: "centre your weight evenly across both sit bones.",
  severe:       "adjust your position now — even a small shift reduces disc pressure significantly.",
};

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
            you've been in the same position for a while. even a small shift
            significantly preserves lumbar and pelvic mobility.
          </Text>
          <Text style={mv.cue}>
            stand up, roll your shoulders, or just shift your weight.
          </Text>
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

// ── Main screen ───────────────────────────────────────────────────────────────

export default function DeskScreen() {
  const {
    topSensor,
    bottomSensor,
    posture,
    shs,
    calibration,
    clinicalBaseline,
    bothConnected,
    timeInCurrentStateMs,
    isNeutralCalibrated,
  } = useIMUContext();

  const [showCalibModal, setShowCalibModal] = useState(false);

  const currentState = posture?.state        ?? "upright";
  const instantScore = posture?.instantScore ?? 100;
  const currentLabel = posture?.label        ?? "waiting for s'pots…";
  const currentDesc  = posture?.description  ?? "connect your s'pots via s'pot setup.";

  const shsColor     = getScoreColor(shs);
  const shsLabel     = getScoreLabel(shs);
  const timeInStateMin = (timeInCurrentStateMs / 60000).toFixed(1);

  // Whether posture tracking is live — needs both connected AND neutral calibrated
  const isTracking = bothConnected && isNeutralCalibrated;

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

        {/* s'pot connection pills */}
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

        {/* Calibration needed banner — shown when connected but no neutral yet */}
        {bothConnected && !isNeutralCalibrated && (
          <Pressable
            style={styles.calibrateBanner}
            onPress={() => setShowCalibModal(true)}
          >
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

        {/* SHS Score badge */}
        <View style={[styles.scoreBadge, { borderColor: shsColor }]}>
          <Text style={[styles.scoreNumber, { color: shsColor }]}>
            {isTracking ? shs : "--"}
          </Text>
          <Text style={[styles.scoreLabel, { color: shsColor }]}>
            {isTracking ? shsLabel : bothConnected ? "calibrate" : "connect"}
          </Text>
        </View>
        {isTracking && (
          <Text style={styles.scoreSubLabel}>spine health score</Text>
        )}

        {/* Figure card */}
        <View style={styles.figureCard}>
          <View style={styles.figureWrapper}>
            <DeskPostureFigure
              state={currentState}
              score={isTracking ? instantScore : 100}
            />
          </View>
          <View style={styles.stateInfo}>
            <Text style={[styles.stateLabel, { color: getScoreColor(instantScore) }]}>
              {isTracking ? currentLabel : bothConnected ? "calibrate to begin" : "s'pots not connected"}
            </Text>
            <Text style={styles.stateDescription}>
              {isTracking ? currentDesc : bothConnected
                ? "tap 'calibrate posture' below and complete step 1 to start tracking."
                : "connect both s'pots via s'pot setup to begin."}
            </Text>
            {/* Debug line — pitchDiff and rollDiff only, bottomAbsolutePitch removed */}
            {isTracking && posture && (
              <Text style={styles.debugText}>
                Δpitch {posture.pitchDiff.toFixed(1)}°  Δroll {posture.rollDiff.toFixed(1)}°{"  "}{timeInStateMin}min
              </Text>
            )}
          </View>
        </View>

        {/* Calibrate button */}
        {bothConnected && (
          <View style={styles.calibrateRow}>
            <Pressable
              style={[styles.calibrateBtn, { borderColor: colours.primary }]}
              onPress={() => setShowCalibModal(true)}
            >
              <Ionicons name="sync-outline" size={18} color={colours.primary} />
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
              {isNeutralCalibrated && !calibration.isComplete && (
                <View style={styles.calibratedBadge}>
                  <Text style={styles.calibratedBadgeText}>1</Text>
                </View>
              )}
            </Pressable>
          </View>
        )}

        {/* Tip card */}
        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Ionicons name="bulb-outline" size={18} color={colours.primary} />
            <Text style={styles.tipTitle}>tip</Text>
          </View>
          <Text style={styles.tipText}>
            {POSTURE_TIPS[currentState] ?? POSTURE_TIPS["upright"]}
          </Text>
        </View>

        {/* Raw sensor angle detail — useful for debugging */}
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

        <View style={{ height: 20 }} />
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

  scoreBadge: {
    width: 110, height: 110, borderRadius: 55, borderWidth: 3,
    alignItems: "center", justifyContent: "center", marginBottom: 4, backgroundColor: colours.card,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 }, android: { elevation: 3 } }),
  },
  scoreNumber:   { fontSize: 36, fontWeight: "800" },
  scoreLabel:    { fontSize: 11, fontWeight: "600", textTransform: "lowercase", letterSpacing: 0.5 },
  scoreSubLabel: { fontSize: 11, color: colours.textSecondary, marginBottom: 16 },

  figureCard: {
    backgroundColor: colours.card, borderRadius: 20, alignItems: "center",
    paddingVertical: 20, paddingHorizontal: 16, alignSelf: "stretch", marginBottom: 20,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  figureWrapper:    { height: 280, justifyContent: "center", alignItems: "center" },
  stateInfo:        { marginTop: 12, alignItems: "center" },
  stateLabel:       { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  stateDescription: { fontSize: 14, color: colours.textSecondary, textAlign: "center", lineHeight: 20 },
  debugText:        { fontSize: 10, color: "#bbb", marginTop: 6, fontFamily: "monospace" },

  calibrateRow: { alignSelf: "stretch", marginBottom: 16 },
  calibrateBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5,
    borderRadius: 30, paddingVertical: 12, paddingHorizontal: 22,
    backgroundColor: colours.card, justifyContent: "center",
  },
  calibrateBtnText:    { fontSize: 14, fontWeight: "600", color: colours.primary },
  calibratedBadge:     { backgroundColor: "#4CAF50", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  calibratedBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  tipCard:   { backgroundColor: colours.primarySoft, borderRadius: 14, padding: 16, alignSelf: "stretch", marginBottom: 24 },
  tipHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  tipTitle:  { fontSize: 14, fontWeight: "700", color: colours.primary },
  tipText:   { fontSize: 14, color: colours.textPrimary, lineHeight: 21 },

  sensorDetailRow:   { alignSelf: "stretch", flexDirection: "row", gap: 10, marginBottom: 16 },
  sensorDetailCard:  { flex: 1, backgroundColor: colours.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colours.border },
  sensorDetailTitle: { fontSize: 12, fontWeight: "700", color: colours.primary, marginBottom: 6 },
  sensorDetailValue: { fontSize: 12, color: colours.textSecondary, lineHeight: 18 },
});