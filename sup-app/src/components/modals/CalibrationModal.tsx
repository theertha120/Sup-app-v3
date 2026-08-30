/**
 * CalibrationModal.tsx
 *
 * 5-position s'pot calibration flow.
 *
 * Step 1 — neutral upright (zero reference)
 * Step 2 — max forward lean (sagittal ROM ceiling, forward)
 * Step 3 — max backward lean (hyperextension ceiling)
 * Step 4 — max right lateral lean (right ROM ceiling)
 * Step 5 — max left lateral lean (left ROM ceiling — often asymmetric)
 *
 * Key behaviours:
 *   - stepsCaptured is local state so buttons stay visible after IMUContext
 *     clears countdown — user can move freely after capture.
 *   - Live angle readout during movement steps so user sees their angle in real time.
 *   - Averaged over 3 seconds per step for robustness.
 */

import React, { useState, useEffect } from "react";
import {
  Modal, View, Text, Pressable, StyleSheet, ScrollView,
} from "react-native";
import Svg, { Circle, Path, Line } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useIMUContext } from "../../contexts/IMUContext";
import { colours } from "../../../theme/colours";

// ── Step config ───────────────────────────────────────────────────────────────

interface StepConfig {
  step:        1 | 2 | 3 | 4 | 5;
  title:       string;
  instruction: string;
  subtext:     string;
  liveAngle:   "pitchDiff" | "rollDiff" | null;
  liveLabel:   string;
}

const STEPS: StepConfig[] = [
  {
    step:        1,
    title:       "step 1 of 5 — sit upright",
    instruction: "sit in your ideal upright posture and hold still.",
    subtext:     "this sets your personal zero — all scores are measured from this position.",
    liveAngle:   null,
    liveLabel:   "",
  },
  {
    step:        2,
    title:       "step 2 of 5 — lean forward",
    instruction: "slowly lean forward from your hips until you feel mild resistance in your lower back. stop there — that's your limit.",
    subtext:     "we capture this as your forward range ceiling. don't push into discomfort.",
    liveAngle:   "pitchDiff",
    liveLabel:   "forward lean",
  },
  {
    step:        3,
    title:       "step 3 of 5 — lean backward",
    instruction: "gently lean your upper body backward until you feel your lower back beginning to arch. hold there.",
    subtext:     "this sets your backward extension ceiling. don't push into discomfort.",
    liveAngle:   "pitchDiff",
    liveLabel:   "backward lean",
  },
  {
    step:        4,
    title:       "step 4 of 5 — lean right",
    instruction: "lean your upper body to the right until your weight shifts heavily onto your right sit bone. hold there.",
    subtext:     "we capture your right lateral range. keep your pelvis level on the seat.",
    liveAngle:   "rollDiff",
    liveLabel:   "right lean",
  },
  {
    step:        5,
    title:       "step 5 of 5 — lean left",
    instruction: "lean your upper body to the left until your weight shifts heavily onto your left sit bone. hold there.",
    subtext:     "your left and right ranges are often different — we measure both separately.",
    liveAngle:   "rollDiff",
    liveLabel:   "left lean",
  },
];

const STEP_COLORS: Record<number, string> = {
  1: colours.primary,
  2: "#BA7517",
  3: "#7B5EA7",
  4: "#993C56",
  5: "#1D7A6E",
};

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

function BackwardLeanDiagram() {
  const c = "#7B5EA7";
  return (
    <Svg width={120} height={165} viewBox="0 0 160 220">
      <Line x1="30" y1="148" x2="90"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Line x1="30" y1="90"  x2="30"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      {/* Spine leaning backward */}
      <Path d="M 62 75 Q 70 115 76 148"  stroke={c} strokeWidth={14} strokeLinecap="round" fill="none" />
      <Path d="M 76 148 L 124 155"        stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 124 155 L 124 210"       stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 124 210 L 142 210"       stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Path d="M 65 85 L 48 118"          stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 48 118 L 76 148"         stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 58 60 L 62 75"           stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Circle cx="52" cy="42" r="20" fill="white" stroke={c} strokeWidth={3.5} />
      <Circle cx="62" cy="44" r="2.5" fill={c} />
      <Line x1="80" y1="40" x2="80" y2="160" stroke={c} strokeWidth={1} strokeDasharray="4 3" opacity={0.25} />
    </Svg>
  );
}

function RightLeanDiagram() {
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
      <Circle cx="88" cy="32" r="20" fill="white" stroke={c} strokeWidth={3.5} />
      <Circle cx="97" cy="34" r="2.5" fill={c} />
      <Line x1="80" y1="20" x2="80" y2="160" stroke={c} strokeWidth={1} strokeDasharray="4 3" opacity={0.25} />
      <Line x1="110" y1="100" x2="126" y2="100" stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
    </Svg>
  );
}

function LeftLeanDiagram() {
  const c = "#1D7A6E";
  return (
    <Svg width={120} height={165} viewBox="0 0 160 220">
      <Line x1="30" y1="148" x2="90"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Line x1="30" y1="90"  x2="30"  y2="148" stroke={c} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Path d="M 80 68 L 64 148"    stroke={c} strokeWidth={14} strokeLinecap="round" fill="none" />
      <Path d="M 64 148 L 112 155"  stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 112 155 L 112 210" stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 112 210 L 130 210" stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Path d="M 78 76 L 62 108"    stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 62 108 L 64 148"   stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 80 50 L 80 68"     stroke={c} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Circle cx="72" cy="32" r="20" fill="white" stroke={c} strokeWidth={3.5} />
      <Circle cx="81" cy="34" r="2.5" fill={c} />
      <Line x1="80" y1="20" x2="80" y2="160" stroke={c} strokeWidth={1} strokeDasharray="4 3" opacity={0.25} />
      <Line x1="50" y1="100" x2="34" y2="100" stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
    </Svg>
  );
}

const DIAGRAMS = [
  UprightDiagram,
  ForwardLeanDiagram,
  BackwardLeanDiagram,
  RightLeanDiagram,
  LeftLeanDiagram,
];

// ── Live angle readout ────────────────────────────────────────────────────────

function LiveAngleReadout({ angleKey, label, color }: {
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

function StepDots({ currentStep, stepComplete }: {
  currentStep: number | null;
  stepComplete: boolean[];
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", marginBottom: 20 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const done   = stepComplete[n - 1];
        const active = currentStep === n;
        const color  = STEP_COLORS[n];
        return (
          <View key={n} style={{
            width: done ? 24 : 8, height: 8, borderRadius: 4,
            backgroundColor: done || active ? color : "#E0E0E0",
            opacity: active ? 1 : done ? 0.8 : 0.4,
          }} />
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
    calibration, clinicalBaseline,
    startCalibrationStep, resetCalibration, bothConnected,
  } = useIMUContext();

  const [viewingStep,    setViewingStep]    = useState<1|2|3|4|5>(1);
  const [stepsCaptured, setStepsCaptured]  = useState<boolean[]>([false,false,false,false,false]);

  const stepConfig = STEPS[viewingStep - 1];
  const Diagram    = DIAGRAMS[viewingStep - 1];
  const stepColor  = STEP_COLORS[viewingStep];

  const isRunning  = calibration.currentStep === viewingStep
                     && calibration.countdown !== null
                     && calibration.countdown > 0;
  const isDone     = calibration.countdown === 0
                     && calibration.currentStep === viewingStep;
  const isCaptured = stepsCaptured[viewingStep - 1];
  const stepDone   = calibration.stepComplete[viewingStep - 1];
  const allDone    = calibration.isComplete;
  // Only ever set for steps 2/4 — the lean was too small to reliably tell
  // which way this s'pot kit is mounted (see IMUContext.tsx's startCalibrationStep).
  const lowConfidence = calibration.lowConfidenceStep === viewingStep;

  useEffect(() => {
    if (isDone) {
      setStepsCaptured((prev) => {
        const u = [...prev]; u[viewingStep - 1] = true; return u;
      });
    }
  }, [isDone]);

  useEffect(() => {
    if (visible && !calibration.isComplete) {
      setViewingStep(1);
      setStepsCaptured([false,false,false,false,false]);
    }
  }, [visible]);

  const handleStart = () => {
    if (!bothConnected) return;
    setStepsCaptured((prev) => { const u=[...prev]; u[viewingStep-1]=false; return u; });
    startCalibrationStep(viewingStep);
  };

  const handleRedo = () => {
    setStepsCaptured((prev) => { const u=[...prev]; u[viewingStep-1]=false; return u; });
    startCalibrationStep(viewingStep);
  };

  const handleRedoAll = () => {
    resetCalibration();
    setViewingStep(1);
    setStepsCaptured([false,false,false,false,false]);
  };

  const handleClose = () => {
    setViewingStep(1);
    setStepsCaptured([false,false,false,false,false]);
    onClose();
  };

  const goNext = () => {
    if (viewingStep < 5) setViewingStep((v) => (v + 1) as 1|2|3|4|5);
  };

  const goBack = () => {
    if (viewingStep > 1) setViewingStep((v) => (v - 1) as 1|2|3|4|5);
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.sheet}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

            {/* Header */}
            <View style={s.headerRow}>
              <Text style={s.brand}>s'pot calibration</Text>
              <Pressable onPress={handleClose} style={s.closeBtn}>
                <Ionicons name="close" size={20} color="#999" />
              </Pressable>
            </View>

            {/* All-done */}
            {allDone ? (
              <View style={s.allDoneContainer}>
                <Ionicons name="checkmark-circle" size={56} color="#4CAF50" />
                <Text style={s.allDoneTitle}>calibration complete</Text>
                {clinicalBaseline && (
                  <View style={s.summaryCard}>
                    <Text style={s.summaryTitle}>your personal ranges</Text>
                    {[
                      { label: "forward range",  value: clinicalBaseline.maxForwardDeg.toFixed(1)  },
                      { label: "backward range", value: clinicalBaseline.maxBackwardDeg.toFixed(1) },
                      { label: "right range",    value: clinicalBaseline.maxRightDeg.toFixed(1)    },
                      { label: "left range",     value: clinicalBaseline.maxLeftDeg.toFixed(1)     },
                      { label: "calibrated",     value: new Date(clinicalBaseline.capturedAt).toLocaleDateString() },
                    ].map((row) => (
                      <View key={row.label} style={s.summaryRow}>
                        <Text style={s.summaryLabel}>{row.label}</Text>
                        <Text style={s.summaryValue}>{row.value}{row.label !== "calibrated" ? "°" : ""}</Text>
                      </View>
                    ))}
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
                <StepDots
                  currentStep={calibration.currentStep}
                  stepComplete={calibration.stepComplete}
                />

                <Text style={[s.stepTitle, { color: stepColor }]}>
                  {stepConfig.title}
                </Text>

                <View style={s.diagramWrap}><Diagram /></View>

                <Text style={s.instruction}>{stepConfig.instruction}</Text>
                <Text style={s.subtext}>{stepConfig.subtext}</Text>

                {stepConfig.liveAngle && !isCaptured && (
                  <LiveAngleReadout
                    angleKey={stepConfig.liveAngle}
                    label={stepConfig.liveLabel}
                    color={stepColor}
                  />
                )}

                {viewingStep === 1 && !isCaptured && (
                  <View style={s.checklist}>
                    {["feet flat on the floor","back straight, shoulders relaxed","eyes level with your screen","head directly above shoulders"].map((item) => (
                      <View key={item} style={s.checkRow}>
                        <Ionicons name="checkmark-circle" size={15} color="#4CAF50" />
                        <Text style={s.checkText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {!bothConnected && (
                  <View style={s.warningBanner}>
                    <Ionicons name="warning-outline" size={16} color="#E65100" />
                    <Text style={s.warningText}>connect both s'pots before calibrating</Text>
                  </View>
                )}

                {/* Action area */}
                {isCaptured ? (
                  <View style={s.capturedContainer}>
                    {lowConfidence ? (
                      <View style={s.capturedRowWarning}>
                        <Ionicons name="warning-outline" size={28} color="#E65100" />
                        <View style={{ flex: 1 }}>
                          <Text style={s.capturedTextWarning}>that lean looked pretty small</Text>
                          <Text style={s.capturedSubWarning}>
                            we couldn't clearly tell which way your s'pots are facing from that —
                            redo this step and lean further so we can tell for sure.
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View style={s.capturedRow}>
                        <Ionicons name="checkmark-circle" size={28} color="#4CAF50" />
                        <View>
                          <Text style={s.capturedText}>reading saved</Text>
                          <Text style={s.capturedSub}>you can move freely now</Text>
                        </View>
                      </View>
                    )}
                    <View style={s.actionRow}>
                      <Pressable style={s.backBtn} onPress={handleRedo}>
                        <Text style={s.backBtnText}>redo this step</Text>
                      </Pressable>
                      {viewingStep < 5 ? (
                        <Pressable style={[s.startBtn, { flex: 2, backgroundColor: "#4CAF50" }]} onPress={goNext}>
                          <Text style={s.startBtnText}>next step →</Text>
                        </Pressable>
                      ) : (
                        <Pressable style={[s.startBtn, { flex: 2, backgroundColor: colours.primary }]} onPress={handleClose}>
                          <Text style={s.startBtnText}>finish calibration</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>

                ) : isRunning ? (
                  <View style={s.countdownWrap}>
                    <Text style={[s.countdownNumber, { color: stepColor }]}>
                      {calibration.countdown}
                    </Text>
                    <Text style={s.countdownLabel}>hold still…</Text>
                  </View>

                ) : (
                  <View style={s.actionRow}>
                    {viewingStep > 1 && (
                      <Pressable style={s.backBtn} onPress={goBack}>
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
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:   { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%" },
  scroll:  { padding: 24, paddingBottom: 40 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  brand:     { fontSize: 16, fontWeight: "700", color: colours.textPrimary },
  closeBtn:  { padding: 4 },

  stepTitle:   { fontSize: 14, fontWeight: "600", textAlign: "center", marginBottom: 16, letterSpacing: 0.2 },
  diagramWrap: { alignItems: "center", marginBottom: 16 },
  instruction: { fontSize: 15, color: colours.textPrimary, textAlign: "center", lineHeight: 22, marginBottom: 8 },
  subtext:     { fontSize: 12, color: colours.textSecondary, textAlign: "center", lineHeight: 18, marginBottom: 4 },

  checklist: { gap: 8, marginVertical: 12 },
  checkRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  checkText: { fontSize: 13, color: colours.textPrimary },

  warningBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF3E0", borderRadius: 10, padding: 10, marginBottom: 12 },
  warningText:   { fontSize: 12, color: "#E65100", flex: 1 },

  countdownWrap:   { alignItems: "center", paddingVertical: 8 },
  countdownNumber: { fontSize: 80, fontWeight: "800", lineHeight: 88 },
  countdownLabel:  { fontSize: 14, color: colours.textSecondary, marginTop: 4 },

  capturedContainer: { gap: 12, marginTop: 8 },
  capturedRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: "#F0FAF4", borderRadius: 14,
  },
  capturedText: { fontSize: 15, fontWeight: "700", color: "#2E7D32" },
  capturedSub:  { fontSize: 12, color: "#4CAF50", marginTop: 2 },

  capturedRowWarning: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: "#FFF3E0", borderRadius: 14,
  },
  capturedTextWarning: { fontSize: 15, fontWeight: "700", color: "#E65100" },
  capturedSubWarning:  { fontSize: 12, color: "#B25400", marginTop: 2, lineHeight: 17 },

  actionRow:    { flexDirection: "row", gap: 10, marginTop: 12 },
  backBtn:      { flex: 1, paddingVertical: 14, borderRadius: 30, borderWidth: 1.5, borderColor: colours.border, alignItems: "center" },
  backBtnText:  { fontSize: 14, fontWeight: "600", color: colours.textSecondary },
  startBtn:     { paddingVertical: 14, borderRadius: 30, alignItems: "center" },
  startBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  skipRow:  { alignItems: "center", marginTop: 16 },
  skipText: { fontSize: 13, color: colours.textSecondary },

  allDoneContainer: { alignItems: "center", paddingTop: 8 },
  allDoneTitle: { fontSize: 22, fontWeight: "700", color: colours.textPrimary, marginTop: 12, marginBottom: 20 },
  allDoneSub:   { fontSize: 13, color: colours.textSecondary, textAlign: "center", lineHeight: 19, marginVertical: 16 },

  summaryCard:  { alignSelf: "stretch", backgroundColor: "#F5F3FF", borderRadius: 16, padding: 16, gap: 10 },
  summaryTitle: { fontSize: 12, fontWeight: "600", color: colours.textSecondary, marginBottom: 4 },
  summaryRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontSize: 14, color: colours.textPrimary },
  summaryValue: { fontSize: 14, fontWeight: "700", color: colours.primary },

  allDoneButtons: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 8 },
  redoBtn:     { flex: 1, paddingVertical: 14, borderRadius: 30, borderWidth: 1.5, borderColor: colours.border, alignItems: "center" },
  redoBtnText: { fontSize: 14, fontWeight: "600", color: colours.textSecondary },
  doneBtn:     { flex: 2, paddingVertical: 14, borderRadius: 30, backgroundColor: colours.primary, alignItems: "center" },
  doneBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});