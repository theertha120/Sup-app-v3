import PressFeedback from "@/src/components/ui/PressFeedback";
import TutorialActions from "@/src/components/onboarding/TutorialActions";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  Platform, Modal, Dimensions, Image,
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
import { MOVEMENT_NUDGE } from "../../src/lib/imuParser";
import CalibrationModal from "../../src/components/modals/CalibrationModal";
import { useSessionStats, formatDuration, StateTimeMap } from "../../src/hooks/useSessionStats";
import { useFocusEffect } from "expo-router";
import { router } from "expo-router";
import { aiProvider } from "../../src/services/ai";
import { supabase } from "../../src/lib/supabase";
import { useToast } from "../../src/contexts/ToastContext";
import { useTutorial } from "../../src/contexts/TutorialContext";
import { InfoButton, InfoModal, InfoModalEntry } from "../../src/components/ui/InfoModal";
import { SKIPPER_DISCLAIMER } from "../../src/services/ai/aiProvider";
import { sUpdatesService } from "../../src/services/posture/s_updatesService";
import { fetchPreviousSession } from "../../src/services/posture/postureSyncService";
import {
  compareSessions, computeSessionHighlights, SessionComparisonMetric, SessionHighlight,
} from "../../src/lib/sessionHighlights";
import { toLocalDateKey } from "../../src/lib/dateKey";

const UPDATE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours between s'update clicks

function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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
  severe:       { label: "high s'train",          icon: "alert-circle" },
  tilted_left:  { label: "shifting left",         icon: "arrow-back-circle" },
  tilted_right: { label: "shifting right",        icon: "arrow-forward-circle" },
};


const STATE_ORDER: DeskPostureState[] = [
  "upright", "transition", "forward_lean", "slouched", "severe", "tilted_left", "tilted_right",
];

const INSIGHT_BORDER: Record<"green" | "yellow" | "red", string> = {
  green:  "#4CAF50",
  yellow: "#F5C842",
  red:    "#EC555E",
};

const INSIGHT_MASCOT = {
  green:  require("../../assets/images/green_mascot.png"),
  yellow: require("../../assets/images/yellow_mascot.png"),
  red:    require("../../assets/images/red_mascot.png"),
};

// ── s'train explainer ─────────────────────────────────────────────────────────
// s'train is the branded UI name for CPL (cumulative postural load). This is
// the one required definition — reused verbatim anywhere s'train is explained.

const STRAIN_INFO: Record<string, InfoModalEntry> = {
  strain: {
    title: "what is s'train?",
    body:
      "s'train is s'up's proprietary posture-awareness indicator. it reflects the duration and " +
      "degree of posture deviation detected relative to your personal calibrated range. it does " +
      "not measure physical force, tissue strain, injury, pain, or a medical condition.",
  },
};

// Shown on the s'update and end-of-session summary pop-ups, both of which
// are s'kipper's AI-generated text — same disclaimer as the home screen's
// "s'kipper says" bubble, sourced from aiProvider.ts so the copy lives once.
const SKIPPER_INFO: Record<string, InfoModalEntry> = {
  skipper: SKIPPER_DISCLAIMER,
};

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
  const [showStrainInfo, setShowStrainInfo] = useState(false);

  // s'train bar — max display at 1500 (above that is red zone regardless)
  const cplPct    = Math.min(cpl / 1500, 1);
  const cplColor  = cpl < 600 ? "#4CAF50" : cpl < 1000 ? "#FF9800" : "#F44336";
  const cplLabel  = cpl < 600 ? "low s'train" : cpl < 1000 ? "building s'train" : "high s'train";

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

      {/* s'train bar */}
      <View style={ss.cplSection}>
        <View style={ss.cplHeader}>
          <View style={ss.cplLabelRow}>
            <Text style={ss.cplLabel}>cumulative s'train</Text>
            <InfoButton onPress={() => setShowStrainInfo(true)} style={ss.strainInfoBtn} />
          </View>
          <Text style={[ss.cplValue, { color: cplColor }]}>{cplLabel}</Text>
        </View>
        <View style={ss.cplBarBg}>
          <View style={[ss.cplBarFill, { width: `${Math.round(cplPct * 100)}%` as any, backgroundColor: cplColor }]} />
        </View>
        <Text style={ss.cplHint}>
          s'train accumulates across posture bouts — short breaks barely reset it
        </Text>
      </View>

      <InfoModal
        metricKey={showStrainInfo ? "strain" : null}
        onClose={() => setShowStrainInfo(false)}
        metricInfo={STRAIN_INFO}
      />
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
            <PressFeedback style={iv.notYetBtn} onPress={() => dismissIntervention(false)}>
              <Text style={iv.notYetText}>not yet</Text>
            </PressFeedback>
            <PressFeedback style={iv.movedBtn} onPress={() => dismissIntervention(true)}>
              <Text style={iv.movedText}>yes, i moved ✓</Text>
            </PressFeedback>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Movement Nudge Modal ──────────────────────────────────────────────────────

function MovementNudgeModal() {
  const { shouldNudge, confirmMovement, activeIntervention } = useIMUContext();
  // A posture-quality intervention takes priority — don't stack this on top
  // of it if CPL crosses a threshold around the same moment the static timer
  // elapses. InterventionModal takes over; this re-fires next time the static
  // timer elapses on its own.
  if (!shouldNudge || activeIntervention) return null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={mv.overlay}>
        <View style={mv.card}>
          <Text style={mv.emoji}>🚶</Text>
          <Text style={mv.title}>{MOVEMENT_NUDGE.title}</Text>
          <Text style={mv.body}>{MOVEMENT_NUDGE.body}</Text>
          <Text style={mv.cue}>{MOVEMENT_NUDGE.cue}</Text>
          <PressFeedback style={mv.btn} onPress={confirmMovement}>
            <Text style={mv.btnText}>yes, i moved ✓</Text>
          </PressFeedback>
        </View>
      </View>
    </Modal>
  );
}

export default function DeskScreen() {
  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
  });

  const { showToast } = useToast();
  const { tutorialStep, setTutorialStep } = useTutorial();
  const [lastUpdateClickAt, setLastUpdateClickAt] = useState<number | null>(null);

  // ── Use the global context — NOT a local hook ──────────────────────────────
  const {
    topSensor, bottomSensor,
    posture,
    bothConnected, timeInCurrentStateMs,
    sessionDurationMs, cpl,
    isNeutralCalibrated, shs,
    sessionStartTimeMs,
    endSessionKeepConnected, startNewSession,
  } = useIMUContext();
  const sessionActive = sessionStartTimeMs !== null;

  // --- State declarations ---
  const [showCalibModal, setShowCalibModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateColor, setUpdateColor] = useState<"green" | "yellow" | "red">("yellow");
  const [isLoadingUpdate, setIsLoadingUpdate] = useState(false);
  const [updateHistory, setUpdateHistory] = useState<{ text: string; color: "green" | "yellow" | "red"; time: Date }[]>([]);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [summaryColor, setSummaryColor] = useState<"green" | "yellow" | "red">("yellow");
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryComparison, setSummaryComparison] = useState<SessionComparisonMetric[] | null>(null);
  const [summaryHighlights, setSummaryHighlights] = useState<SessionHighlight[]>([]);
  const [showSkipperInfo, setShowSkipperInfo] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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

  // Load today's s'updates from Supabase on mount
  useEffect(() => {
    const loadUpdates = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
          // Load today's s'updates for display
          const todaySUpdates = await sUpdatesService.getTodaySUpdates(user.id);
          if (todaySUpdates && todaySUpdates.length > 0) {
            const converted = todaySUpdates.map(su => ({
              text: su.text,
              color: su.color as "green" | "yellow" | "red",
              time: new Date(su.created_at || new Date()),
            }));
            setUpdateHistory(converted);
          }
        }
      } catch (error) {
        console.error("[desk] Failed to load s'updates:", error);
      }
    };
    loadUpdates();
  }, []);

  const handleCloseUpdateModal = async () => {
    const newUpdate = { text: updateMessage ?? "no message recorded", color: updateColor, time: new Date() };
    setUpdateHistory(prev => [newUpdate, ...prev]);

    // Save s'update to Supabase
    if (currentUserId) {
      try {
        await sUpdatesService.saveSUpdate(
          currentUserId,
          newUpdate.text,
          newUpdate.color
        );
      } catch (error) {
        console.error("[s'update] Failed to save to Supabase:", error);
        // Still close the modal even if save fails
      }
    }

    setShowUpdateModal(false);
    setUpdateMessage(null);
    setUpdateColor("yellow");
  };

  // use the throttled posture for the figure/label to avoid flicker
  const currentState   = (displayPosture?.state ?? posture?.state ?? "upright") as DeskPostureState;
  const isTracking     = bothConnected && isNeutralCalibrated && sessionActive;
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

  const { sessionStats, sessionTotalMs, getSessionTimeline } = useSessionStats(isTracking ? currentState : undefined);

  const blobColor = updateHistory.length > 0
    ? INSIGHT_BORDER[updateHistory[0].color]
    : "rgba(163, 218, 225, 1)";

  const handleOpenUpdateModal = useCallback(async () => {
    if (lastUpdateClickAt !== null) {
      const nextAvailableAt = lastUpdateClickAt + UPDATE_COOLDOWN_MS;
      if (Date.now() < nextAvailableAt) {
        showToast(`you can s'update again at ${formatClockTime(nextAvailableAt)}`, "error");
        return;
      }
    }
    setLastUpdateClickAt(Date.now());

    setUpdateMessage(null);
    setIsLoadingUpdate(true);
    setShowUpdateModal(true);
    try {
      // Fetch today's goal summary from Supabase, falling back to the most
      // recent one available if nothing's been generated for today yet.
      let dailySummary: string | null = null;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const today = toLocalDateKey();
        console.log("[s'update] querying daily goal for user:", user.id, "date:", today);
        const { data, error } = await supabase
          .from("daily_ai_summary")
          .select("concised_summary")
          .eq("user_id", user.id)
          .eq("date", today)
          .maybeSingle();
        console.log("[s'update] daily goal result:", data?.concised_summary ?? "none", "error:", error?.message ?? "none");

        if (data?.concised_summary) {
          dailySummary = data.concised_summary;
        } else {
          const { data: latest, error: latestError } = await supabase
            .from("daily_ai_summary")
            .select("concised_summary")
            .eq("user_id", user.id)
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle();
          console.log("[s'update] fallback to latest goal:", latest?.concised_summary ?? "none", "error:", latestError?.message ?? "none");
          dailySummary = latest?.concised_summary ?? null;
        }
      }

      const result = await aiProvider.getSessionInsight({
        sessionDurationMs,
        currentState,
        timeInCurrentStateMs,
        cpl,
        sessionStats,
        previousUpdates: updateHistory.map(h => h.text),
        dailySummary,
      });
      setUpdateMessage(result.message);
      setUpdateColor(result.color);
    } catch {
      setUpdateMessage("couldn't reach s'kipper right now, try again in a moment!");
      setUpdateColor("yellow");
    } finally {
      setIsLoadingUpdate(false);
    }
  }, [sessionDurationMs, currentState, timeInCurrentStateMs, cpl, sessionStats, updateHistory, lastUpdateClickAt, showToast]);

  const handleEndSession = useCallback(async () => {
    if (!topSensor.state.connected && !bottomSensor.state.connected) return;
    setSummaryMessage(null);
    setIsLoadingSummary(true);
    setShowSummaryModal(true);

    // Highlights + previous-session comparison are computed on-device, shown
    // even if s'kipper can't be reached, and passed to it as context.
    const highlights = computeSessionHighlights(getSessionTimeline());
    const previous = sessionStartTimeMs !== null
      ? await fetchPreviousSession(currentUserId, sessionStartTimeMs)
      : null;
    const comparison = previous
      ? compareSessions(
          { durationMs: sessionTotalMs, stateTotals: sessionStats },
          { durationMs: previous.totalDurationMs, stateTotals: previous.stateTotals },
        )
      : null;
    setSummaryHighlights(highlights);
    setSummaryComparison(comparison);

    try {
      const result = await aiProvider.getSessionSummary({
        sessionDurationMs,
        cpl,
        sessionStats,
        previousUpdates: updateHistory.map(h => h.text),
        comparison,
        highlights,
      });
      setSummaryMessage(result.message);
      setSummaryColor(result.color);
    } catch {
      setSummaryMessage("great session! keep up the good work, every minute of good posture counts.");
      setSummaryColor("yellow");
    } finally {
      setIsLoadingSummary(false);
    }
  }, [topSensor.state.connected, bottomSensor.state.connected, sessionDurationMs, cpl, sessionStats, sessionTotalMs, updateHistory, getSessionTimeline, sessionStartTimeMs, currentUserId]);

  const handleCloseSummaryModal = useCallback(async () => {
    setShowSummaryModal(false);
    setSummaryMessage(null);
    setSummaryColor("yellow");
    setSummaryComparison(null);
    setSummaryHighlights([]);
    // End the session but keep the s'pots connected so it can be restarted from here.
    endSessionKeepConnected();
  }, [endSessionKeepConnected]);

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
            <Stop offset="0%"   stopColor={blobColor} stopOpacity="1" />
            <Stop offset="100%" stopColor={blobColor} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={SCREEN_W * 0.05} cy={SCREEN_H * 0.05} rx={320} ry={320} fill="url(#d1)" />
        <Ellipse cx={SCREEN_W * 0.95} cy={SCREEN_H * 0.95} rx={320} ry={320} fill="url(#d2)" />
      </Svg>
      <CalibrationModal visible={showCalibModal} onClose={() => setShowCalibModal(false)} />

      {/* s'update modal */}
      <Modal visible={showUpdateModal} transparent animationType="fade" onRequestClose={handleCloseUpdateModal}>
        <View style={su.overlay}>
          <View style={[su.card, { borderColor: INSIGHT_BORDER[updateColor] }]}>
            <PressFeedback style={su.closeBtn} onPress={handleCloseUpdateModal}>
              <Text style={su.closeText}>×</Text>
            </PressFeedback>
            <InfoButton onPress={() => setShowSkipperInfo(true)} color={colours.primary} />
            <Text style={su.title}>s'update!</Text>
            <Image source={INSIGHT_MASCOT[updateColor]} style={su.mascot} resizeMode="contain" />
            <Text style={su.body}>
              {isLoadingUpdate
                ? "s'kipper is thinking..."
                : updateMessage ?? ""}
            </Text>
          </View>
        </View>
      </Modal>

      {/* session end summary modal */}
      <Modal visible={showSummaryModal} transparent animationType="fade" onRequestClose={handleCloseSummaryModal}>
        <View style={su.overlay}>
          <View style={[su.card, { borderColor: INSIGHT_BORDER[summaryColor] }]}>
            <PressFeedback style={su.closeBtn} onPress={handleCloseSummaryModal}>
              <Text style={su.closeText}>×</Text>
            </PressFeedback>
            <InfoButton onPress={() => setShowSkipperInfo(true)} color={colours.primary} />
            <Text style={[su.title, { fontSize: 22 }]}>session end summary!</Text>
            <Image source={INSIGHT_MASCOT[summaryColor]} style={su.mascot} resizeMode="contain" />
            <ScrollView style={su.summaryScroll} showsVerticalScrollIndicator={false}>
              <Text style={su.body}>
                {isLoadingSummary
                  ? "s'kipper is reviewing your session..."
                  : summaryMessage ?? ""}
              </Text>

              {summaryHighlights.length > 0 && (
                <View style={su.summarySection}>
                  {summaryHighlights.map((h) => (
                    <Text key={h.label} style={su.highlightLine}>
                      <Text style={su.highlightLabel}>{h.label}:</Text> {h.text}
                    </Text>
                  ))}
                </View>
              )}

              {summaryComparison && (
                <View style={su.summarySection}>
                  <Text style={su.highlightLabel}>vs last session</Text>
                  {summaryComparison.map((m) => (
                    <View key={m.label} style={su.compareRow}>
                      <Text style={su.compareLabel}>{m.label}</Text>
                      <Text style={su.compareValue}>{m.current}</Text>
                      <Text
                        style={[
                          su.compareChange,
                          { color: m.improved === null ? "#888" : m.improved ? "#2E7D32" : "#C62828" },
                        ]}
                      >
                        {m.change}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <InfoModal
        metricKey={showSkipperInfo ? "skipper" : null}
        onClose={() => setShowSkipperInfo(false)}
        metricInfo={SKIPPER_INFO}
      />

      <InterventionModal />
      <MovementNudgeModal />

      <ScrollView showsVerticalScrollIndicator={false}>
        <HeaderBar />

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
          <PressFeedback style={s.calibrateBanner} onPress={() => setShowCalibModal(true)}>
            <Ionicons name="warning-outline" size={18} color="#E65100" />
            <View style={{ flex: 1 }}>
              <Text style={s.calibrateBannerTitle}>calibration needed</Text>
              <Text style={s.calibrateBannerSub}>complete step 1 to start posture tracking</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#E65100" />
          </PressFeedback>
        )}

        {tutorialStep === "figure-tip" && (
          <View style={s.tutorialTip}>
            <Image
              source={require("../../assets/images/mascot_tutorial.png")}
              style={s.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={s.tutorialTipTextWrap}>
              <Text style={s.tutorialTipText}>
                see real-time feedback on your posture here: this figure updates live to show how you're sitting right now.
              </Text>
              <TutorialActions>
                <PressFeedback feedback="link" onPress={() => setTutorialStep("supdate-tip")}>
                  <Text style={s.tutorialTipNext}>next {'>>'}</Text>
                </PressFeedback>
              </TutorialActions>
            </View>
          </View>
        )}

        {/* Figure card */}
        <View
          style={[
            s.figureCard,
            { borderColor: figureColor + "33" },
            tutorialStep === "figure-tip" && s.tutorialHighlight,
          ]}
        >
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
                : bothConnected && isNeutralCalibrated ? "session ended. tap 'start new s'ession' to keep tracking."
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
          <>
            {tutorialStep === "supdate-tip" && (
              <View style={s.tutorialTip}>
                <Image
                  source={require("../../assets/images/mascot_tutorial.png")}
                  style={s.tutorialTipMascot}
                  resizeMode="contain"
                />
                <View style={s.tutorialTipTextWrap}>
                  <Text style={s.tutorialTipText}>
                    click the 's'update' button to get a mid-session update on how you are doing overall and how close you are to your daily goal. you can use it once every 2 hours.
                  </Text>
                  <TutorialActions>
                    <PressFeedback feedback="link" onPress={() => setTutorialStep("end-session-tip")}>
                      <Text style={s.tutorialTipNext}>next {'>>'}</Text>
                    </PressFeedback>
                  </TutorialActions>
                </View>
              </View>
            )}

            {tutorialStep === "end-session-tip" && (
              <View style={s.tutorialTip}>
                <Image
                  source={require("../../assets/images/mascot_tutorial.png")}
                  style={s.tutorialTipMascot}
                  resizeMode="contain"
                />
                <View style={s.tutorialTipTextWrap}>
                  <Text style={s.tutorialTipText}>
                    click 'end session' button to end your session.
                  </Text>
                  <TutorialActions>
                    <PressFeedback feedback="link"
                      onPress={() => {
                        setTutorialStep("stats-tip");
                        router.replace("/(tabs)/stats" as any);
                      }}
                    >
                      <Text style={s.tutorialTipNext}>next {'>>'}</Text>
                    </PressFeedback>
                  </TutorialActions>
                </View>
              </View>
            )}

            <View style={s.actionRow}>
              {sessionActive || !bothConnected ? (
                <>
                  <PressFeedback
                    style={[s.updateBtn, tutorialStep === "supdate-tip" && s.tutorialHighlight]}
                    onPress={handleOpenUpdateModal}
                  >
                    <Text style={s.updateBtnText}>s'update</Text>
                  </PressFeedback>
                  <PressFeedback
                    style={[s.disconnectBtn, tutorialStep === "end-session-tip" && s.tutorialHighlight]} 
                    onPress={handleEndSession}>
                    <Text style={s.disconnectBtnText}>end s'ession</Text>
                  </PressFeedback>
                </>
              ) : (
                <PressFeedback style={s.updateBtn} onPress={startNewSession}>
                  <Text style={s.updateBtnText}>start new s'ession</Text>
                </PressFeedback>
              )}
            </View>
          </>
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

        {/* s'update history */}
        {updateHistory.length > 0 && (
          <View style={su.historySection}>
            <Text style={su.historyHeading}>s<Text style={su.historyHeadingApostrophe}>'</Text>update history</Text>
            {updateHistory.map((entry, i) => (
              <View key={i} style={su.historyItem}>
                <Image source={INSIGHT_MASCOT[entry.color]} style={su.historyMascot} resizeMode="contain" />
                <View style={[su.historyBubble, { borderWidth: 2, borderColor: INSIGHT_BORDER[entry.color] }]}>
                  <Text style={su.historyText}>{entry.text}</Text>
                  <Text style={su.historyTime}>
                    today, {entry.time.getHours()}:{String(entry.time.getMinutes()).padStart(2, "0")}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 120 }} />
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
  timeValue:   { fontSize: 22, color: colours.textPrimary, fontFamily: "Agrandir-Regular" },
  timeLabel:   { fontSize: 11, color: colours.textSecondary, marginTop: 2, fontFamily: "Agrandir-Regular" },
  timeDivider: { width: 1, height: 36, backgroundColor: "#E0E0E0" },
  cplSection:  { gap: 6 },
  cplHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cplLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cplLabel:    { fontSize: 12, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },
  cplValue:    { fontSize: 12, fontFamily: "Agrandir-Regular" },
  // Overrides InfoButton's default absolute top-right positioning — here it
  // sits inline right next to the "cumulative s'train" label instead.
  strainInfoBtn: { position: "relative", top: 0, right: 0 },
  cplBarBg:    { height: 8, backgroundColor: "#F0F0F0", borderRadius: 4, overflow: "hidden" },
  cplBarFill:  { height: 8, borderRadius: 4 },
  cplHint:     { fontSize: 11, color: "#bbb", fontFamily: "Agrandir-Regular" },
});

// ── Session breakdown styles ──────────────────────────────────────────────────

const sb = StyleSheet.create({
  container: {
    backgroundColor: "#fff", borderRadius: 20, padding: 16,
    alignSelf: "stretch", marginBottom: 16,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  header:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title:     { fontSize: 15, color: colours.textPrimary, fontFamily: "Agrandir-Regular" },
  goodPct:   { fontSize: 15, fontFamily: "Agrandir-Regular" },
  stackedBar:{ height: 10, borderRadius: 5, overflow: "hidden", flexDirection: "row", marginBottom: 14, backgroundColor: "#F0F0F0" },
  rows:      { gap: 10 },
  row:       { flexDirection: "row", alignItems: "center", gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  stateLabel:{ flex: 1, fontSize: 13, color: colours.textPrimary, fontFamily: "Agrandir-Regular" },
  statePct:  { fontSize: 13, minWidth: 36, textAlign: "right", fontFamily: "Agrandir-Regular" },
  stateTime: { fontSize: 12, color: colours.textSecondary, minWidth: 40, textAlign: "right", fontFamily: "Agrandir-Regular" },
});

// ── Intervention modal styles ─────────────────────────────────────────────────

const iv = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:     { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, paddingBottom: 44 },
  iconRow:   { alignItems: "center", marginBottom: 16 },
  iconBg:    { width: 56, height: 56, borderRadius: 28, backgroundColor: "#F0EDFF", alignItems: "center", justifyContent: "center" },
  title:     { fontSize: 18, color: colours.textPrimary, marginBottom: 12, textAlign: "center", fontFamily: "Agrandir-Regular" },
  body:      { fontSize: 13, color: colours.textSecondary, lineHeight: 20, marginBottom: 16, textAlign: "center", fontFamily: "Agrandir-Regular" },
  cueCard:   { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F5F3FF", borderRadius: 12, padding: 14, marginBottom: 20 },
  cueText:   { fontSize: 13, color: colours.primary, flex: 1, lineHeight: 19, fontFamily: "Agrandir-Regular" },
  question:  { fontSize: 14, color: colours.textPrimary, textAlign: "center", marginBottom: 14, fontFamily: "Agrandir-Regular" },
  buttonRow: { flexDirection: "row", gap: 10 },
  notYetBtn: { flex: 1, paddingVertical: 14, borderRadius: 30, borderWidth: 1.5, borderColor: colours.border, alignItems: "center" },
  notYetText:{ fontSize: 14, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },
  movedBtn:  { flex: 2, paddingVertical: 14, borderRadius: 30, backgroundColor: "#4CAF50", alignItems: "center" },
  movedText: { fontSize: 14, color: "#fff", fontFamily: "Agrandir-Regular" },
});

// ── Movement nudge styles ─────────────────────────────────────────────────────

const mv = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  card:     { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", alignItems: "center" },
  emoji:    { fontSize: 40, marginBottom: 12 },
  title:    { fontSize: 20, color: colours.textPrimary, marginBottom: 10, fontFamily: "Agrandir-Regular" },
  body:     { fontSize: 13, color: colours.textSecondary, textAlign: "center", lineHeight: 19, marginBottom: 12, fontFamily: "Agrandir-Regular" },
  cue:      { fontSize: 13, color: colours.primary, textAlign: "center", marginBottom: 20, fontFamily: "Agrandir-Regular" },
  btn:      { backgroundColor: colours.primary, borderRadius: 30, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 10 },
  btnText:  { fontSize: 14, color: "#fff", fontFamily: "Agrandir-Regular" },
});

// ── Screen styles ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#fff" },
  container: { paddingHorizontal: 20, paddingTop: 8, alignItems: "center" },

  pillRow: { alignSelf: "stretch", flexDirection: "row", gap: 8, marginBottom: 16 },
  pill:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText:{ fontSize: 12, fontFamily: "Agrandir-Regular" },

  calibrateBanner:      { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF3E0", borderRadius: 14, padding: 14, marginBottom: 14 },
  calibrateBannerTitle: { fontSize: 13, color: "#E65100", fontFamily: "Agrandir-Regular" },
  calibrateBannerSub:   { fontSize: 12, color: "#BF360C", marginTop: 2, lineHeight: 17, fontFamily: "Agrandir-Regular" },

  tutorialTip: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  tutorialTipMascot: {
    width: 34,
    height: 34,
  },
  tutorialTipTextWrap: {
    flex: 1,
  },
  tutorialTipText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
    color: "#FFFFFF",
    lineHeight: 20,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },

  figureCard: {
    backgroundColor: "#fff", borderRadius: 20, alignSelf: "stretch",
    marginBottom: 16, overflow: "hidden", borderWidth: 1.5,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  stateLabelStrip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  stateLabelText:  { fontSize: 14, flex: 1, fontFamily: "Agrandir-Regular" },
  figureWrapper:   { alignItems: "center", paddingVertical: 8 },
  stateInfo:       { paddingHorizontal: 16, paddingBottom: 16, alignItems: "center" },
  stateDescription:{ fontSize: 14, color: colours.textSecondary, textAlign: "center", lineHeight: 20, fontFamily: "Agrandir-Regular" },
  debugText:       { fontSize: 10, color: "#ccc", marginTop: 6, fontFamily: "monospace" },

  calibrateBtn: {
    alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderColor: colours.primary, borderRadius: 30,
    paddingVertical: 12, paddingHorizontal: 22, backgroundColor: "#fff",
    justifyContent: "center", marginBottom: 14,
  },
  calibrateBtnText:    { fontSize: 14, color: colours.primary, fontFamily: "Agrandir-Regular" },
  calibratedBadge:     { backgroundColor: "#4CAF50", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  calibratedBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Agrandir-Regular" },

  tipCard:   { backgroundColor: colours.primarySoft, borderRadius: 14, padding: 14, alignSelf: "stretch", marginBottom: 16 },
  tipHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  tipTitle:  { fontSize: 13, color: colours.primary, fontFamily: "Agrandir-Regular" },
  tipText:   { fontSize: 13, color: colours.textPrimary, lineHeight: 19, fontFamily: "Agrandir-Regular" },

  sensorDetailRow:   { alignSelf: "stretch", flexDirection: "row", gap: 10, marginBottom: 16 },
  sensorDetailCard:  { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colours.border },
  sensorDetailTitle: { fontSize: 12, color: colours.primary, marginBottom: 6, fontFamily: "Agrandir-GrandHeavy" },
  sensorDetailValue: { fontSize: 12, color: colours.textSecondary, lineHeight: 18, fontFamily: "Agrandir-Regular" },

  actionRow:         { alignSelf: "stretch", flexDirection: "row", gap: 12, marginBottom: 24 },

  tutorialHighlight: {
    borderWidth: 3,
    borderColor: "#5222AE",
    shadowColor: "#5222AE",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },

  updateBtn:         { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 30, backgroundColor: "#AB99FA" },
  updateBtnText:     { fontSize: 15, color: "#fff", fontFamily: "Agrandir-Regular" },

  disconnectBtn:     { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 30, borderWidth: 1.5, borderColor: "#D32F2F", backgroundColor: "#fff" },
  disconnectBtnText: { fontSize: 15, color: "#D32F2F", fontFamily: "Agrandir-Regular" },
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

const su = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    borderWidth: 2.5,
    borderColor: "#F5C842",
    padding: 24,
    width: "100%",
    alignItems: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    left: 14,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText:  { fontSize: 24, color: "#888", lineHeight: 28, fontFamily: "Agrandir-Regular" },
  title:      { fontSize: 22, color: "#AB99FA", marginBottom: 12, fontFamily: "Agrandir-GrandHeavy", textAlign: "center" },
  mascot:     { width: 160, height: 160, marginBottom: 8 },
  body:       { fontSize: 17, color: "#333", textAlign: "center", lineHeight: 25, marginBottom: 12, fontFamily: "Agrandir-Regular" },

  // end-of-session summary: highlights + previous-session comparison
  summaryScroll:  { alignSelf: "stretch", maxHeight: SCREEN_H * 0.45 },
  summarySection: { alignSelf: "stretch", borderTopWidth: 1, borderTopColor: "#EEE", paddingTop: 12, marginBottom: 12, gap: 6 },
  highlightLine:  { fontSize: 14, color: "#333", lineHeight: 20, fontFamily: "Agrandir-Regular" },
  highlightLabel: { fontSize: 14, color: "#1D014A", fontFamily: "Agrandir-GrandHeavy" },
  compareRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  compareLabel:   { flex: 1, fontSize: 14, color: "#333", fontFamily: "Agrandir-Regular" },
  compareValue:   { fontSize: 14, color: "#333", minWidth: 52, textAlign: "right", fontFamily: "Agrandir-Regular" },
  compareChange:  { fontSize: 14, minWidth: 76, textAlign: "right", fontFamily: "Agrandir-Regular" },

  historySection: { alignSelf: "stretch", marginTop: 24, marginBottom: 8 },
  historyHeading: { fontSize: 28, fontFamily: "Agrandir-GrandHeavy", color: "#1D014A", marginBottom: 14 },
  historyHeadingApostrophe: { fontFamily: "Arial" },
  historyItem:    { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  historyMascot:  { width: 70, height: 70 },
  historyBubble:  { flex: 1, backgroundColor: "#fff", borderRadius: 16, padding: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  historyText:    { fontSize: 13, color: "#333", lineHeight: 19, marginBottom: 6, fontFamily: "Agrandir-Regular" },
  historyTime:    { fontSize: 11, color: "#AB99FA", fontFamily: "Agrandir-Regular" },
});
