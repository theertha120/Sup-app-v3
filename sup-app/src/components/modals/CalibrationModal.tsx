/**
 * CalibrationModal.tsx
 *
 * 3-position s'pot calibration flow.
 *
 * Step 1 — sit upright (neutral zero reference)
 * Step 2 — lean forward as far as comfortable (sagittal ROM ceiling)
 * Step 3 — lean sideways as far as comfortable, each side (lateral ROM ceiling)
 *
 * Each step shows:
 *   - A posture diagram indicating the target position
 *   - A live angle readout from the s'pots so the user can see their movement
 *   - A 3-second countdown before capture
 *   - A "done" confirmation with redo / next step buttons
 *
 * Key fix: stepsCaptured is local state so captured buttons stay visible
 * after IMUContext clears the countdown — user can freely move after capture.
 */

import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import Svg, { Circle, Path, Line } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useIMUContext } from "../../contexts/IMUContext";
import { colours } from "../../../theme/colours";

// ── Step config ───────────────────────────────────────────────────────────────

interface StepConfig {
  step:      1 | 2 | 3;
  title:     string;
  instruction: string;
  subtext:   string;
  liveAngle: "pitchDiff" | "rollDiff" | null;
  liveLabel: string;
}

const STEPS: StepConfig[] = [
  {
    step:        1,
    title:       "step 1 of 3 — sit upright",
    instruction: "sit in your ideal upright posture and hold still.",
    subtext:     "this sets your personal zero — all scores are measured from this position.",
    liveAngle:   null,
    liveLabel:   "",
  },
  {
    step:        2,
    title:       "step 2 of 3 — lean forward",
    instruction: "slowly lean forward from your hips until you feel mild resistance in your lower back. stop there — that's your limit.",
    subtext:     "we capture this angle as your forward range ceiling. don't push into discomfort.",
    liveAngle:   "pitchDiff",
    liveLabel:   "forward lean",
  },
  {
    step:        3,
    title:       "step 3 of 3 — lean sideways",
    instruction: "lean sideways until your weight shifts heavily onto one sit bone. hold there.",
    subtext:     "repeat the same lean on both sides — we'll use the larger value.",
    liveAngle:   "rollDiff",
    liveLabel:   "lateral lean",
  },
];

// ── Posture diagrams ──────────────────────────────────────────────────────────

function UprightDiagram() {
  const c = colours.primary;
  return (
    <Svg width={120} height={165} viewBox="0 0 160 220">
      <Line x1="30" y1="148" x2="90"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Line x1="30" y1="90"  x2="30"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Path d="M 80 68 L 80 148"    stroke={c} strokeWidth={14} strokeLinecap="round" fill="none" />
      <Path d="M 80 148 L 130 155"  stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 130 155 L 130 210" stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 130 210 L 148 210" stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Path d="M 80 76 L 60 110"    stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 60 110 L 95 145"   stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 80 50 L 80 68"     stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Circle cx="80" cy="32" r="20" fill="white" stroke={c} strokeWidth={3.5} />
      <Circle cx="89" cy="34" r="2.5" fill={c} />
      <Line x1="100" y1="80"  x2="115" y2="80"  stroke="#4CAF50" strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="100" y1="108" x2="115" y2="108" stroke="#4CAF50" strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="100" y1="136" x2="115" y2="136" stroke="#4CAF50" strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="115" y1="80"  x2="115" y2="136" stroke="#4CAF50" strokeWidth={1.5} strokeLinecap="round" opacity={0.4} />
    </Svg>
  );
}

function ForwardLeanDiagram() {
  const c = "#BA7517";
  return (
    <Svg width={120} height={165} viewBox="0 0 160 220">
      <Line x1="30" y1="148" x2="90"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Line x1="30" y1="90"  x2="30"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Path d="M 100 80 Q 112 115 120 148"  stroke={c} strokeWidth={14} strokeLinecap="round" fill="none" />
      <Path d="M 120 148 L 155 155"          stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 155 155 L 155 210"          stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 155 210 L 172 210"          stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Path d="M 105 90 L 85 122"            stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 85 122 L 118 148"           stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 110 65 L 100 80"            stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Circle cx="118" cy="48" r="20" fill="white" stroke={c} strokeWidth={3.5} />
      <Circle cx="128" cy="50" r="2.5" fill={c} />
      <Line x1="80" y1="40" x2="80" y2="160" stroke={c} strokeWidth={1} strokeDasharray="4 3" opacity={0.25} />
    </Svg>
  );
}

function LateralLeanDiagram() {
  const c = "#993C56";
  return (
    <Svg width={120} height={165} viewBox="0 0 160 220">
      <Line x1="30" y1="148" x2="90"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Line x1="30" y1="90"  x2="30"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Path d="M 80 68 L 96 148"    stroke={c} strokeWidth={14} strokeLinecap="round" fill="none" />
      <Path d="M 96 148 L 144 155"  stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 144 155 L 144 210" stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 144 210 L 162 210" stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Path d="M 82 76 L 66 108"    stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 66 108 L 96 148"   stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 80 50 L 80 68"     stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Circle cx="80" cy="32" r="20" fill="white" stroke={c} strokeWidth={3.5} />
      <Circle cx="89" cy="34" r="2.5" fill={c} />
      <Line x1="80"  y1="20"  x2="80"  y2="160" stroke={c} strokeWidth={1} strokeDasharray="4 3" opacity={0.25} />
      <Line x1="50"  y1="100" x2="36"  y2="100" stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      <Line x1="110" y1="100" x2="124" y2="100" stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}

const DIAGRAMS    = [UprightDiagram, ForwardLeanDiagram, LateralLeanDiagram];
const STEP_COLORS = [colours.primary, "#BA7517", "#993C56"];

// ── Live angle readout ────────────────────────────────────────────────────────

function LiveAngleReadout({
  angleKey,
  label,
  color,
}: {
  angleKey: "pitchDiff" | "rollDiff";
  label: string;
  color: string;
}) {
  const { posture } = useIMUContext();
  const value = posture ? Math.abs(posture[angleKey]).toFixed(1) : "--";
  return (
    <View style={[live.container, { borderColor: color }]}>
      <Text style={[live.label, { color }]}>{label}</Text>
      <Text style={[live.value, { color }]}>{value}°</Text>
      <Text style={live.hint}>current angle from your s'pots</Text>
    </View>
  );
}

const live = StyleSheet.create({
  container: {
    borderWidth: 1.5, borderRadius: 16,
    paddingVertical: 12, paddingHorizontal: 20,
    alignItems: "center", marginVertical: 12,
    backgroundColor: "white",
  },
  label: { fontSize: 11, fontWeight: "600", textTransform: "lowercase", letterSpacing: 0.3 },
  value: { fontSize: 48, fontWeight: "800", lineHeight: 56 },
  hint:  { fontSize: 11, color: "#999", marginTop: 2 },
});

// ── Step progress dots ────────────────────────────────────────────────────────

function StepDots({
  currentStep,
  stepComplete,
}: {
  currentStep: 1 | 2 | 3 | null;
  stepComplete: boolean[];
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 20 }}>
      {[1, 2, 3].map((n) => {
        const done   = stepComplete[n - 1];
        const active = currentStep === n;
        const color  = STEP_COLORS[n - 1];
        return (
          <View
            key={n}
            style={{
              width: done ? 28 : 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: done || active ? color : "#E0E0E0",
              opacity: active ? 1 : done ? 0.8 : 0.4,
            }}
          />
        );
      })}
    </View>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function CalibrationModal({ visible, onClose }: Props) {
  const {
    calibration,
    clinicalBaseline,
    startCalibrationStep,
    resetCalibration,
    bothConnected,
  } = useIMUContext();

  const [viewingStep,    setViewingStep]    = useState<1 | 2 | 3>(1);

  // Local captured state — independent of IMUContext countdown timer.
  // Once a step is captured it stays captured here so the next/redo buttons
  // remain visible even after IMUContext clears countdown to null.
  // This means the user can move freely after capture without losing the UI.
  const [stepsCaptured, setStepsCaptured]  = useState<boolean[]>([false, false, false]);

  const stepConfig = STEPS[viewingStep - 1];
  const Diagram    = DIAGRAMS[viewingStep - 1];
  const stepColor  = STEP_COLORS[viewingStep - 1];

  const isRunning       = calibration.currentStep === viewingStep
                          && calibration.countdown !== null
                          && calibration.countdown > 0;

  // isDone is true for the 1.5s flash window after capture
  const isDone          = calibration.countdown === 0
                          && calibration.currentStep === viewingStep;

  // isCaptured persists locally until user navigates away or redoes the step
  const isCaptured      = stepsCaptured[viewingStep - 1];

  const stepDone        = calibration.stepComplete[viewingStep - 1];
  const allDone         = calibration.isComplete;

  // Lock in captured state locally as soon as IMUContext signals done
  useEffect(() => {
    if (isDone) {
      setStepsCaptured((prev) => {
        const updated = [...prev];
        updated[viewingStep - 1] = true;
        return updated;
      });
    }
  }, [isDone]);

  // Reset local state when modal opens fresh
  useEffect(() => {
    if (visible && !calibration.isComplete) {
      setViewingStep(1);
      setStepsCaptured([false, false, false]);
    }
  }, [visible]);

  const handleStart = () => {
    if (!bothConnected) return;
    // Clear local captured state for this step so the countdown shows again
    setStepsCaptured((prev) => {
      const updated = [...prev];
      updated[viewingStep - 1] = false;
      return updated;
    });
    startCalibrationStep(viewingStep);
  };

  const handleRedo = () => {
    // Clear local captured state for this step only
    setStepsCaptured((prev) => {
      const updated = [...prev];
      updated[viewingStep - 1] = false;
      return updated;
    });
    startCalibrationStep(viewingStep);
  };

  const handleRedoAll = () => {
    resetCalibration();
    setViewingStep(1);
    setStepsCaptured([false, false, false]);
  };

  const handleClose = () => {
    setViewingStep(1);
    setStepsCaptured([false, false, false]);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.sheet}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scroll}
          >
            {/* Header */}
            <View style={s.headerRow}>
              <Text style={s.brand}>s'pot calibration</Text>
              <Pressable onPress={handleClose} style={s.closeBtn}>
                <Ionicons name="close" size={20} color="#999" />
              </Pressable>
            </View>

            {/* ── All-done state ── */}
            {allDone ? (
              <View style={s.allDoneContainer}>
                <Ionicons name="checkmark-circle" size={56} color="#4CAF50" />
                <Text style={s.allDoneTitle}>calibration complete</Text>
                {clinicalBaseline && (
                  <View style={s.summaryCard}>
                    <Text style={s.summaryTitle}>your personal limits</Text>
                    <View style={s.summaryRow}>
                      <Text style={s.summaryLabel}>forward range</Text>
                      <Text style={s.summaryValue}>
                        {clinicalBaseline.maxForwardDeg.toFixed(1)}°
                      </Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={s.summaryLabel}>lateral range</Text>
                      <Text style={s.summaryValue}>
                        {clinicalBaseline.maxLateralDeg.toFixed(1)}°
                      </Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={s.summaryLabel}>calibrated</Text>
                      <Text style={s.summaryValue}>
                        {new Date(clinicalBaseline.capturedAt).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                )}
                <Text style={s.allDoneSub}>
                  your posture scores are now personalised to your body.
                  recalibrate every 30 days or after a posture change.
                </Text>
                <View style={s.allDoneButtons}>
                  <Pressable style={s.redoBtn} onPress={handleRedoAll}>
                    <Text style={s.redoBtnText}>redo calibration</Text>
                  </Pressable>
                  <Pressable style={s.doneBtn} onPress={handleClose}>
                    <Text style={s.doneBtnText}>done</Text>
                  </Pressable>
                </View>
              </View>

            ) : (
              <>
                {/* Step progress dots */}
                <StepDots
                  currentStep={calibration.currentStep}
                  stepComplete={calibration.stepComplete}
                />

                {/* Step title */}
                <Text style={[s.stepTitle, { color: stepColor }]}>
                  {stepConfig.title}
                </Text>

                {/* Posture diagram */}
                <View style={s.diagramWrap}>
                  <Diagram />
                </View>

                {/* Instruction */}
                <Text style={s.instruction}>{stepConfig.instruction}</Text>
                <Text style={s.subtext}>{stepConfig.subtext}</Text>

                {/* Live angle readout — steps 2 and 3 only, hidden after capture */}
                {stepConfig.liveAngle && !isCaptured && (
                  <LiveAngleReadout
                    angleKey={stepConfig.liveAngle}
                    label={stepConfig.liveLabel}
                    color={stepColor}
                  />
                )}

                {/* Checklist — step 1 only */}
                {viewingStep === 1 && !isCaptured && (
                  <View style={s.checklist}>
                    {[
                      "feet flat on the floor",
                      "back straight, shoulders relaxed",
                      "eyes level with your screen",
                      "head directly above shoulders",
                    ].map((item) => (
                      <View key={item} style={s.checkRow}>
                        <Ionicons name="checkmark-circle" size={15} color="#4CAF50" />
                        <Text style={s.checkText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Not connected warning */}
                {!bothConnected && (
                  <View style={s.warningBanner}>
                    <Ionicons name="warning-outline" size={16} color="#E65100" />
                    <Text style={s.warningText}>
                      connect both s'pots before calibrating
                    </Text>
                  </View>
                )}

                {/* ── Action area ── */}

                {/* CAPTURED — show redo / next buttons, stays visible after movement */}
                {isCaptured ? (
                  <View style={s.capturedContainer}>
                    <View style={s.capturedRow}>
                      <Ionicons name="checkmark-circle" size={28} color="#4CAF50" />
                      <View>
                        <Text style={s.capturedText}>reading saved</Text>
                        <Text style={s.capturedSub}>you can move freely now</Text>
                      </View>
                    </View>
                    <View style={s.actionRow}>
                      <Pressable style={s.backBtn} onPress={handleRedo}>
                        <Text style={s.backBtnText}>redo this step</Text>
                      </Pressable>
                      {viewingStep < 3 ? (
                        <Pressable
                          style={[s.startBtn, { flex: 2, backgroundColor: "#4CAF50" }]}
                          onPress={() => setViewingStep((v) => (v + 1) as 1 | 2 | 3)}
                        >
                          <Text style={s.startBtnText}>next step →</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          style={[s.startBtn, { flex: 2, backgroundColor: colours.primary }]}
                          onPress={handleClose}
                        >
                          <Text style={s.startBtnText}>finish calibration</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>

                /* COUNTING DOWN */
                ) : isRunning ? (
                  <View style={s.countdownWrap}>
                    <Text style={[s.countdownNumber, { color: stepColor }]}>
                      {calibration.countdown}
                    </Text>
                    <Text style={s.countdownLabel}>hold still…</Text>
                  </View>

                /* IDLE — show start button */
                ) : (
                  <View style={s.actionRow}>
                    {viewingStep > 1 && (
                      <Pressable
                        style={s.backBtn}
                        onPress={() => setViewingStep((v) => (v - 1) as 1 | 2 | 3)}
                      >
                        <Text style={s.backBtnText}>back</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={[
                        s.startBtn,
                        { backgroundColor: bothConnected ? stepColor : "#ccc" },
                        { flex: viewingStep > 1 ? 2 : 1 },
                      ]}
                      onPress={handleStart}
                      disabled={!bothConnected}
                    >
                      <Text style={s.startBtnText}>
                        {stepDone ? "redo this step" : "start — hold for 3 seconds"}
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* Keep existing calibration shortcut */}
                {clinicalBaseline && !allDone && (
                  <Pressable onPress={handleClose} style={s.skipRow}>
                    <Text style={s.skipText}>keep existing calibration</Text>
                  </Pressable>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "92%",
  },
  scroll: {
    padding: 24,
    paddingBottom: 40,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  brand:    { fontSize: 16, fontWeight: "700", color: colours.textPrimary },
  closeBtn: { padding: 4 },

  stepTitle: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: 0.2,
  },

  diagramWrap: { alignItems: "center", marginBottom: 16 },

  instruction: {
    fontSize: 15,
    color: colours.textPrimary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  subtext: {
    fontSize: 12,
    color: colours.textSecondary,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 4,
  },

  checklist: { gap: 8, marginVertical: 12 },
  checkRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  checkText: { fontSize: 13, color: colours.textPrimary },

  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF3E0",
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  warningText: { fontSize: 12, color: "#E65100", flex: 1 },

  // Countdown
  countdownWrap: { alignItems: "center", paddingVertical: 8 },
  countdownNumber: { fontSize: 80, fontWeight: "800", lineHeight: 88 },
  countdownLabel:  { fontSize: 14, color: colours.textSecondary, marginTop: 4 },

  // Captured state
  capturedContainer: { gap: 12, marginTop: 8 },
  capturedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#F0FAF4",
    borderRadius: 14,
  },
  capturedText: { fontSize: 15, fontWeight: "700", color: "#2E7D32" },
  capturedSub:  { fontSize: 12, color: "#4CAF50", marginTop: 2 },

  // Action buttons
  actionRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  backBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: colours.border,
    alignItems: "center",
  },
  backBtnText:  { fontSize: 14, fontWeight: "600", color: colours.textSecondary },
  startBtn:     { paddingVertical: 14, borderRadius: 30, alignItems: "center" },
  startBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  skipRow:  { alignItems: "center", marginTop: 16 },
  skipText: { fontSize: 13, color: colours.textSecondary },

  // All-done state
  allDoneContainer: { alignItems: "center", paddingTop: 8 },
  allDoneTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colours.textPrimary,
    marginTop: 12,
    marginBottom: 20,
  },
  allDoneSub: {
    fontSize: 13,
    color: colours.textSecondary,
    textAlign: "center",
    lineHeight: 19,
    marginVertical: 16,
  },
  summaryCard: {
    alignSelf: "stretch",
    backgroundColor: "#F5F3FF",
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: colours.textSecondary,
    textTransform: "lowercase",
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: { fontSize: 14, color: colours.textPrimary },
  summaryValue: { fontSize: 14, fontWeight: "700", color: colours.primary },

  allDoneButtons: {
    flexDirection: "row",
    gap: 10,
    alignSelf: "stretch",
    marginTop: 8,
  },
  redoBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: colours.border,
    alignItems: "center",
  },
  redoBtnText: { fontSize: 14, fontWeight: "600", color: colours.textSecondary },
  doneBtn:     { flex: 2, paddingVertical: 14, borderRadius: 30, backgroundColor: colours.primary, alignItems: "center" },
  doneBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});