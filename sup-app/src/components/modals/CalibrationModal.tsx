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
  Modal, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIMUContext } from "../../contexts/IMUContext";
import { colours } from "../../../theme/colours";
import CalibrationFigure from "./CalibrationFigure";
import {
  UPRIGHT, FORWARD_LEAN, BACKWARD_LEAN, TILTED_RIGHT, TILTED_LEFT, Joints,
} from "../desk/DeskPostureFigure";

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
// Animated stick-figure demos (CalibrationFigure) replace the old static
// hand-drawn SVGs — each one loops upright → target pose → upright so the
// motion itself is the instruction. Target poses are shared with
// DeskPostureFigure's joint system rather than redefined here.

const CALIBRATION_TARGETS: Joints[] = [
  UPRIGHT,
  FORWARD_LEAN,
  BACKWARD_LEAN,
  TILTED_RIGHT,
  TILTED_LEFT,
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

function StepDots({ viewingStep, stepComplete, onSelect }: {
  viewingStep: number;
  stepComplete: boolean[];
  onSelect: (step: 1 | 2 | 3 | 4 | 5) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", marginBottom: 20 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const done   = stepComplete[n - 1];
        const active = viewingStep === n;
        const color  = STEP_COLORS[n];
        return (
          <Pressable
            key={n}
            onPress={() => onSelect(n as 1 | 2 | 3 | 4 | 5)}
            hitSlop={8}
            style={{ paddingVertical: 6 }}
          >
            <View style={{
              width: done ? 24 : 8, height: 8, borderRadius: 4,
              backgroundColor: done || active ? color : "#E0E0E0",
              opacity: active ? 1 : done ? 0.8 : 0.4,
            }} />
          </Pressable>
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
    startCalibrationStep, resetCalibration, bothConnected, sensorsReady,
  } = useIMUContext();

  // Calibration can't meaningfully start until real data is flowing from
  // both s'pots — starting a step's 3s sampling window before then risks
  // capturing zero packets and silently failing (see IMUContext.tsx).
  const canCalibrate = bothConnected && sensorsReady;

  const [viewingStep,    setViewingStep]    = useState<1|2|3|4|5>(1);
  const [stepsCaptured, setStepsCaptured]  = useState<boolean[]>([false,false,false,false,false]);
  // True while dipping into a single step's edit view from the "all done"
  // summary screen (via "recalibrate a specific step") — lets the render
  // fall through to the normal per-step UI instead of the summary, without
  // otherwise disturbing calibration.isComplete (redoing one already-done
  // step doesn't un-complete the others).
  const [reviewingSteps, setReviewingSteps] = useState(false);

  const stepConfig    = STEPS[viewingStep - 1];
  const diagramTarget = CALIBRATION_TARGETS[viewingStep - 1];
  const stepColor     = STEP_COLORS[viewingStep];

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
    if (visible) setReviewingSteps(false);
  }, [visible]);

  const handleStart = () => {
    if (!canCalibrate) return;
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
    setReviewingSteps(false);
    onClose();
  };

  const goNext = () => {
    if (viewingStep < 5) setViewingStep((v) => (v + 1) as 1|2|3|4|5);
    else if (reviewingSteps) setReviewingSteps(false); // step 5's "finish" while reviewing → back to summary
  };

  const goBack = () => {
    if (viewingStep > 1) setViewingStep((v) => (v - 1) as 1|2|3|4|5);
  };

  // Jump directly to any step — from the tappable step dots, or from the
  // "recalibrate a specific step" picker on the all-done summary. Blocked
  // while a capture is actively running, same as the existing back/next
  // buttons (which are hidden, not just disabled, during a countdown).
  const jumpToStep = (step: 1 | 2 | 3 | 4 | 5) => {
    if (isRunning) return;
    setViewingStep(step);
  };

  const startReviewingStep = (step: 1 | 2 | 3 | 4 | 5) => {
    setReviewingSteps(true);
    setViewingStep(step);
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
            {allDone && !reviewingSteps ? (
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

                <Text style={s.recalOneLabel}>or recalibrate just one step:</Text>
                <View style={s.recalOneRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      style={[s.recalOneChip, { borderColor: STEP_COLORS[n] }]}
                      onPress={() => startReviewingStep(n as 1 | 2 | 3 | 4 | 5)}
                    >
                      <Text style={[s.recalOneChipText, { color: STEP_COLORS[n] }]}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

            ) : (
              <>
                {reviewingSteps && (
                  <Pressable onPress={() => setReviewingSteps(false)} style={s.backToSummary} hitSlop={8}>
                    <Ionicons name="arrow-back" size={14} color={colours.primary} />
                    <Text style={s.backToSummaryText}>back to summary</Text>
                  </Pressable>
                )}

                <StepDots
                  viewingStep={viewingStep}
                  stepComplete={calibration.stepComplete}
                  onSelect={jumpToStep}
                />

                <Text style={[s.stepTitle, { color: stepColor }]}>
                  {stepConfig.title}
                </Text>

                <View style={{ opacity: canCalibrate ? 1 : 0.4 }} pointerEvents={canCalibrate ? "auto" : "none"}>
                  <View style={s.diagramWrap}>
                    <CalibrationFigure target={diagramTarget} color={stepColor} />
                  </View>

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
                </View>

                {!bothConnected ? (
                  <View style={s.warningBanner}>
                    <Ionicons name="warning-outline" size={16} color="#E65100" />
                    <Text style={s.warningText}>connect both s'pots before calibrating</Text>
                  </View>
                ) : !sensorsReady && (
                  <View style={s.waitingBanner}>
                    <ActivityIndicator size="small" color={colours.primary} />
                    <Text style={s.waitingText}>waiting for your s'pots to get ready…</Text>
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
                        <Pressable style={[s.startBtn, { backgroundColor: "#4CAF50" }]} onPress={goNext}>
                          <Text style={s.startBtnText}>next step →</Text>
                        </Pressable>
                      ) : reviewingSteps ? (
                        <Pressable style={[s.startBtn, { backgroundColor: colours.primary }]} onPress={() => setReviewingSteps(false)}>
                          <Text style={s.startBtnText}>back to summary</Text>
                        </Pressable>
                      ) : (
                        <Pressable style={[s.startBtn, { backgroundColor: colours.primary }]} onPress={handleClose}>
                          <Text style={s.startBtnText}>finish ✓</Text>
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
                        { backgroundColor: canCalibrate ? stepColor : "#ccc" },
                        { flex: viewingStep > 1 ? 2 : 1 },
                      ]}
                      onPress={handleStart}
                      disabled={!canCalibrate}
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
  waitingBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F5F3FF", borderRadius: 10, padding: 12, marginBottom: 12 },
  waitingText:   { fontSize: 12, color: colours.textSecondary, flex: 1 },

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

  // minHeight + justifyContent keep both buttons in a row the same height even
  // if one's text wraps to two lines on a narrower device or with larger
  // accessibility text — was the cause of the mismatched/"broken"-looking
  // buttons (a 1:2 flex split forced "redo this step" to wrap while its
  // similarly-long neighbour didn't, at fixed heights that no longer matched).
  actionRow:    { flexDirection: "row", gap: 10, marginTop: 12, alignItems: "stretch" },
  backBtn:      { flex: 1, minHeight: 50, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 30, borderWidth: 1.5, borderColor: colours.border, alignItems: "center", justifyContent: "center" },
  backBtnText:  { fontSize: 14, fontWeight: "600", color: colours.textSecondary, textAlign: "center" },
  startBtn:     { flex: 1, minHeight: 50, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  startBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", textAlign: "center" },

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

  allDoneButtons: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 8, alignItems: "stretch" },
  redoBtn:     { flex: 1, minHeight: 50, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 30, borderWidth: 1.5, borderColor: colours.border, alignItems: "center", justifyContent: "center" },
  redoBtnText: { fontSize: 14, fontWeight: "600", color: colours.textSecondary, textAlign: "center" },
  doneBtn:     { flex: 1, minHeight: 50, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 30, backgroundColor: colours.primary, alignItems: "center", justifyContent: "center" },
  doneBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", textAlign: "center" },

  recalOneLabel: { fontSize: 12, color: colours.textSecondary, textAlign: "center", marginTop: 18 },
  recalOneRow:   { flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 10 },
  recalOneChip:  { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  recalOneChipText: { fontSize: 14, fontWeight: "700" },

  backToSummary:     { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginBottom: 8 },
  backToSummaryText: { fontSize: 13, fontWeight: "600", color: colours.primary },
});