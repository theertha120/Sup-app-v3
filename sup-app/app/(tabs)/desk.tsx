import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  Pressable, Platform, ActivityIndicator, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Path, Line } from "react-native-svg";
import { colours } from "../../theme/colours";
import DeskPostureFigure from "../../src/components/DeskPostureFigure";
import { getScoreColor, getScoreLabel } from "../../src/data/mockDeskPostureData";
import { useIMUContext } from "../../src/contexts/IMUContext";
import { router } from "expo-router";

const POSTURE_TIPS: Record<string, string> = {
  upright:      "Keep your feet flat, shoulders relaxed, and eyes level with the screen.",
  forward_lean: "Sit back into your chair. Move your screen closer if needed.",
  slouched:     "Engage your core and roll your shoulders back and down.",
  tilted_left:  "Centre your weight evenly across both sit bones.",
  tilted_right: "Centre your weight evenly across both sit bones.",
};

function IdealPostureDiagram() {
  const accent = colours.primary;
  return (
    <Svg width={160} height={220} viewBox="0 0 160 220">
      <Line x1="30" y1="148" x2="90"  y2="148" stroke={accent} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Line x1="30" y1="90"  x2="30"  y2="148" stroke={accent} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Path d="M 80 68 L 80 148"  stroke={accent} strokeWidth={14} strokeLinecap="round" fill="none" />
      <Path d="M 80 148 L 130 155" stroke={accent} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 130 155 L 130 210" stroke={accent} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 130 210 L 148 210" stroke={accent} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Path d="M 80 76 L 60 110"  stroke={accent} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 60 110 L 95 145" stroke={accent} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 80 50 L 80 68"   stroke={accent} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Circle cx="80" cy="32" r="20" fill="white" stroke={accent} strokeWidth={3.5} />
      <Circle cx="89" cy="34" r="2.5" fill={accent} />
      <Line x1="100" y1="80"  x2="115" y2="80"  stroke="#4CAF50" strokeWidth={2} strokeLinecap="round" />
      <Line x1="100" y1="108" x2="115" y2="108" stroke="#4CAF50" strokeWidth={2} strokeLinecap="round" />
      <Line x1="100" y1="136" x2="115" y2="136" stroke="#4CAF50" strokeWidth={2} strokeLinecap="round" />
      <Line x1="115" y1="80"  x2="115" y2="136" stroke="#4CAF50" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}

function CalibrationModal({
  visible, countdown, onStart, onClose,
}: {
  visible: boolean;
  countdown: number | null;
  onStart: () => void;
  onClose: () => void;
}) {
  const isRunning = countdown !== null && countdown > 0;
  const isDone    = countdown === 0;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={modal.overlay}>
        <View style={modal.card}>
          <Text style={modal.title}>Calibrate Posture</Text>
          <Text style={modal.subtitle}>
            Sit in your ideal upright posture, then tap Start.
            Hold still for 3 seconds while we record your baseline.
          </Text>
          <View style={modal.figureWrap}><IdealPostureDiagram /></View>
          <View style={modal.checklist}>
            {["Feet flat on the floor","Back straight, shoulders relaxed","Eyes level with screen","Head directly above shoulders"].map((item) => (
              <View key={item} style={modal.checkRow}>
                <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
                <Text style={modal.checkText}>{item}</Text>
              </View>
            ))}
          </View>
          {isDone ? (
            <View style={modal.doneRow}>
              <Ionicons name="checkmark-circle" size={32} color="#4CAF50" />
              <Text style={modal.doneText}>Calibration saved!</Text>
            </View>
          ) : isRunning ? (
            <View style={modal.countdownRow}>
              <Text style={modal.countdownNumber}>{countdown}</Text>
              <Text style={modal.countdownLabel}>Hold still…</Text>
            </View>
          ) : (
            <View style={modal.buttonRow}>
              <Pressable style={modal.cancelBtn} onPress={onClose}>
                <Text style={modal.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={modal.startBtn} onPress={onStart}>
                <Text style={modal.startText}>Start calibration</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export default function DeskScreen() {
  // ── Use the global context — NOT a local hook ──────────────────────────────
  const {
    topSensor, bottomSensor, posture,
    calibrationCountdown, isCalibrated,
    bothConnected, startCalibration,
  } = useIMUContext();

  const [showCalibModal, setShowCalibModal] = useState(false);

  React.useEffect(() => {
    if (calibrationCountdown === 0) {
      setTimeout(() => setShowCalibModal(false), 1500);
    }
  }, [calibrationCountdown]);

  const currentState = posture?.state       ?? "upright";
  const currentScore = posture?.score       ?? 0;
  const currentLabel = posture?.label       ?? "Waiting for sensors…";
  const currentDesc  = posture?.description ?? "Connect sensors in S'pot Setup.";
  const accentColor  = getScoreColor(currentScore);
  const scoreLabel   = getScoreLabel(currentScore);

  return (
    <SafeAreaView style={styles.safe}>
      <CalibrationModal
        visible={showCalibModal}
        countdown={calibrationCountdown}
        onStart={startCalibration}
        onClose={() => setShowCalibModal(false)}
      />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Desk Mode</Text>
            <Text style={styles.headerSub}>
              {bothConnected ? "Live posture analysis" : "Connect sensors via S'pot Setup"}
            </Text>
          </View>
          {/* Quick link to sensor setup */}
          {!bothConnected && (
            <Pressable
              style={styles.setupLink}
              onPress={() => router.push("/sensor-setup")}
            >
              <Ionicons name="hardware-chip-outline" size={16} color={colours.primary} />
              <Text style={styles.setupLinkText}>Setup</Text>
            </Pressable>
          )}
        </View>

        {/* Sensor status pills */}
        <View style={styles.pillRow}>
          {(["top", "bottom"] as const).map((slot) => {
            const sensor    = slot === "top" ? topSensor : bottomSensor;
            const connected = sensor.state.connected;
            const label     = slot === "top" ? "Upper" : "Lower";
            return (
              <View
                key={slot}
                style={[styles.pill, { backgroundColor: connected ? "#E8F5E9" : "#F5F5F5" }]}
              >
                <View style={[styles.pillDot, { backgroundColor: connected ? "#4CAF50" : "#ccc" }]} />
                <Text style={[styles.pillText, { color: connected ? "#2E7D32" : "#999" }]}>
                  {label} {connected ? "connected" : "disconnected"}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Score badge */}
        <View style={[styles.scoreBadge, { borderColor: accentColor }]}>
          <Text style={[styles.scoreNumber, { color: accentColor }]}>
            {bothConnected ? currentScore : "--"}
          </Text>
          <Text style={[styles.scoreLabel, { color: accentColor }]}>
            {bothConnected ? scoreLabel : "Connect"}
          </Text>
        </View>

        {/* Figure card */}
        <View style={styles.figureCard}>
          <View style={styles.figureWrapper}>
            <DeskPostureFigure state={currentState} score={bothConnected ? currentScore : 50} />
          </View>
          <View style={styles.stateInfo}>
            <Text style={[styles.stateLabel, { color: accentColor }]}>{currentLabel}</Text>
            <Text style={styles.stateDescription}>{currentDesc}</Text>
            {bothConnected && posture && (
              <Text style={styles.debugText}>
                Δpitch {posture.pitchDiff.toFixed(1)}°  Δroll {posture.rollDiff.toFixed(1)}°
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
                {isCalibrated ? "Re-calibrate posture" : "Calibrate posture"}
              </Text>
              {isCalibrated && (
                <View style={styles.calibratedBadge}>
                  <Text style={styles.calibratedBadgeText}>✓</Text>
                </View>
              )}
            </Pressable>
          </View>
        )}

        {/* Tip card */}
        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Ionicons name="bulb-outline" size={18} color={colours.primary} />
            <Text style={styles.tipTitle}>Tip</Text>
          </View>
          <Text style={styles.tipText}>{POSTURE_TIPS[currentState]}</Text>
        </View>

        {/* Sensor angle detail */}
        {bothConnected && (
          <View style={styles.sensorDetailRow}>
            {[
              { label: "Upper back", data: topSensor.latest },
              { label: "Lower back", data: bottomSensor.latest },
            ].map(({ label, data }) => (
              <View key={label} style={styles.sensorDetailCard}>
                <Text style={styles.sensorDetailTitle}>{label}</Text>
                {data ? (
                  <>
                    <Text style={styles.sensorDetailValue}>Pitch {data.angle.pitch.toFixed(1)}°</Text>
                    <Text style={styles.sensorDetailValue}>Roll  {data.angle.roll.toFixed(1)}°</Text>
                    <Text style={styles.sensorDetailValue}>Yaw   {data.angle.yaw.toFixed(1)}°</Text>
                  </>
                ) : (
                  <Text style={styles.sensorDetailValue}>Waiting…</Text>
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

const modal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 24 },
  card:    { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", alignItems: "center" },
  title:    { fontSize: 20, fontWeight: "700", color: colours.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 13, color: colours.textSecondary, textAlign: "center", lineHeight: 19, marginBottom: 16 },
  figureWrap:  { marginBottom: 16, alignItems: "center" },
  checklist:   { alignSelf: "stretch", marginBottom: 24, gap: 8 },
  checkRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  checkText:   { fontSize: 13, color: colours.textPrimary },
  countdownRow:    { alignItems: "center", marginBottom: 8 },
  countdownNumber: { fontSize: 72, fontWeight: "800", color: colours.primary, lineHeight: 80 },
  countdownLabel:  { fontSize: 14, color: colours.textSecondary, marginTop: 4 },
  doneRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  doneText: { fontSize: 18, fontWeight: "700", color: "#4CAF50" },
  buttonRow:  { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  cancelBtn:  { flex: 1, paddingVertical: 14, borderRadius: 30, borderWidth: 1.5, borderColor: colours.border, alignItems: "center" },
  cancelText: { fontSize: 14, fontWeight: "600", color: colours.textSecondary },
  startBtn:   { flex: 2, paddingVertical: 14, borderRadius: 30, backgroundColor: colours.primary, alignItems: "center" },
  startText:  { fontSize: 14, fontWeight: "700", color: "#fff" },
});

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colours.background },
  container: { paddingHorizontal: 20, paddingTop: 8, alignItems: "center" },

  header:     { alignSelf: "stretch", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerTitle: { fontSize: 26, fontWeight: "700", color: colours.textPrimary },
  headerSub:   { fontSize: 14, color: colours.textSecondary, marginTop: 2 },
  setupLink:   { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: colours.primary, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  setupLinkText: { fontSize: 13, fontWeight: "600", color: colours.primary },

  pillRow: { alignSelf: "stretch", flexDirection: "row", gap: 8, marginBottom: 16 },
  pill:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: "600" },

  scoreBadge: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 3,
    alignItems: "center", justifyContent: "center", marginBottom: 20, backgroundColor: colours.card,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 }, android: { elevation: 3 } }),
  },
  scoreNumber: { fontSize: 34, fontWeight: "800" },
  scoreLabel:  { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },

  figureCard: {
    backgroundColor: colours.card, borderRadius: 20, alignItems: "center",
    paddingVertical: 20, paddingHorizontal: 16, alignSelf: "stretch", marginBottom: 20,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  figureWrapper:    { height: 280, justifyContent: "center", alignItems: "center" },
  stateInfo:        { marginTop: 12, alignItems: "center" },
  stateLabel:       { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  stateDescription: { fontSize: 14, color: colours.textSecondary, textAlign: "center", lineHeight: 20 },
  debugText:        { fontSize: 11, color: colours.textSecondary, marginTop: 6, fontFamily: "monospace" },

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

  sensorDetailRow:  { alignSelf: "stretch", flexDirection: "row", gap: 10, marginBottom: 16 },
  sensorDetailCard: { flex: 1, backgroundColor: colours.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colours.border },
  sensorDetailTitle: { fontSize: 12, fontWeight: "700", color: colours.primary, marginBottom: 6 },
  sensorDetailValue: { fontSize: 12, color: colours.textSecondary, lineHeight: 18 },
});