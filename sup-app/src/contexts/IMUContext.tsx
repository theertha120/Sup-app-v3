/**
 * IMUContext.tsx
 *
 * Global singleton context for s'pot BLE state.
 *
 * Cumulative Postural Load (CPL) model — replaces per-state timers:
 *
 *   Based on Solomonow et al. (Spine 2003) and Kang & Mirka (2024):
 *   Short neutral breaks do NOT reset spinal creep. Creep developed
 *   during loading accumulates across multiple bouts with insufficient
 *   recovery between them. Recovery requires ~3x the loading duration.
 *
 *   CPL formula (runs every second):
 *     Non-neutral: CPL += STATE_WEIGHT[state]  (0.2–1.0 based on severity)
 *     Neutral:     CPL -= 0.15                 (slow recovery, 3:1 ratio)
 *     CPL clamped to [0, ∞)
 *
 *   This means a 1-minute neutral break after 5 minutes of slouching
 *   only reduces CPL by ~9 seconds of equivalent load — the next
 *   bad posture bout picks up from nearly the same level. This correctly
 *   models the cumulative tissue damage mechanism.
 *
 *   Intervention fires when CPL crosses a threshold:
 *     slouched/severe:  CPL ≥ 1200 (≈ 20 min equivalent at full weight)
 *     forward_lean:     CPL ≥ 900  (≈ 15 min equivalent)
 *     lateral:          CPL ≥ 900
 *
 * Other features:
 *   - EMA smoothing (α=0.15) on raw angles before classification
 *   - UI throttle (500ms) to prevent figure jitter
 *   - Neutral offset applied immediately after calibration step 1
 *   - Session start time tracked for desk time display
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Device } from "react-native-ble-plx";
import { bleService, SensorSlot, SensorState } from "../services/BLEService";
import {
  parseIMUPacket,
  classifySpinePosture,
  ParsedIMU,
  ClinicalBaseline,
  NeutralOffset,
  PostureState,
  PostureSeverity,
  POSTURE_LABELS,
  POSTURE_CUES,
  INTERVENTION_MESSAGES,
  SHS_RATES,
  SHS_GRACE_PERIODS_MS,
} from "../lib/imuParser";
import { DeskPostureState } from "../components/desk/mockDeskPostureData";

// ── Storage keys ──────────────────────────────────────────────────────────────

const BASELINE_STORAGE_KEY       = "sup_clinical_baseline_v2";
const NEUTRAL_OFFSET_STORAGE_KEY = "sup_neutral_offset_v1";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATIC_NUDGE_THRESHOLD_MS = 1 * 60 * 1000; // 1 min testing → 20 * 60 * 1000 prod
const SHS_TICK_MS               = 1_000;
const DISPLAY_TICK_MS           = 10_000;
const EMA_ALPHA                 = 0.15;
const UI_THROTTLE_MS            = 500;

// ── Cumulative Postural Load (CPL) ────────────────────────────────────────────
//
// Weight per second in each state (Solomonow et al. 2003 / Kang & Mirka 2024).
// upright recovers at 0.15/s regardless of state.
// Non-neutral states accumulate; recovery is ~3× slower than loading.

const CPL_WEIGHTS: Record<PostureState, number> = {
  upright:       0,    // neutral — handled by recovery rate
  transition:    0.2,  // early flexion — low accumulation
  forward_lean:  0.6,  // lumbar flexion, muscle fatigue
  slouched:      1.0,  // significant disc compression
  severe:        1.5,  // passive ligament zone — accumulates fastest
  tilted_left:   0.7,  // asymmetric disc loading
  tilted_right:  0.7,
};
const CPL_RECOVERY_RATE = 0.15; // pts/sec during neutral

// CPL thresholds for intervention (seconds of equivalent full-weight loading)
const CPL_THRESHOLDS: Partial<Record<PostureState, number>> = {
  forward_lean:  900,   // ≈ 15 min at full weight
  slouched:      1200,  // ≈ 20 min (McGill ligament creep threshold)
  severe:        300,   // ≈ 5 min — urgent
  tilted_left:   900,
  tilted_right:  900,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IMUSensorData {
  latest: ParsedIMU | null;
  state: SensorState;
}

export interface PostureResult {
  state: DeskPostureState;
  instantScore: number;
  severity: PostureSeverity;
  label: string;
  description: string;
  pitchDiff: number;
  rollDiff: number;
}

export interface CalibrationState {
  currentStep: 1 | 2 | 3 | 4 | 5 | null;
  countdown: number | null;
  stepComplete: boolean[];
  isComplete: boolean;
}

export interface InterventionAlert {
  state: PostureState;
  title: string;
  body: string;
  cue: string;
  /** CPL value when alert fired — for display */
  cplAtAlert: number;
}

export interface IMUContextValue {
  topSensor: IMUSensorData;
  bottomSensor: IMUSensorData;
  posture: PostureResult | null;
  bothConnected: boolean;
  /** Percent 0-100 derived from live top-sensor sagittal offset vs neutral (null if unavailable) */
  neckAlignmentPercent: number | null;
  /** Percent 0-100 derived from inter-s'pot lateral diff (null if unavailable) */
  shoulderBalancePercent: number | null;
  /** Time-weighted upper-back support percent (0-100) computed from per-packet instant scores */
  upperBackPercent: number | null;

  discoveredDevices: Device[];
  isScanning: boolean;
  scan: () => Promise<void>;
  connect: (device: Device, slot: SensorSlot) => Promise<void>;
  disconnect: (slot: SensorSlot) => Promise<void>;
  disconnectAll: () => Promise<void>;

  calibration: CalibrationState;
  clinicalBaseline: ClinicalBaseline | null;
  isNeutralCalibrated: boolean;
  startCalibrationStep: (step: 1 | 2 | 3 | 4 | 5) => void;
  resetCalibration: () => void;

  shs: number;
  /**
   * Cumulative Postural Load (0–∞).
   * Accumulates across multiple bad posture bouts.
   * Short neutral breaks barely dent it (3:1 recovery ratio).
   * Use for intervention threshold checks and UI display.
   */
  cpl: number;
  timeInCurrentStateMs: number;
  /** How long the s'pots have been connected this session (ms) */
  sessionDurationMs: number;
  /** Session start timestamp (ms since epoch) — null if not started */
  sessionStartTimeMs: number | null;
  shouldNudge: boolean;
  activeIntervention: InterventionAlert | null;
  confirmMovement: () => void;
  dismissIntervention: (moved: boolean) => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const defaultSensorState: SensorState = {
  connected: false,
  deviceId: null,
  deviceName: null,
};

const defaultSensorData: IMUSensorData = {
  latest: null,
  state: defaultSensorState,
};

const defaultCalibration: CalibrationState = {
  currentStep: null, countdown: null,
  stepComplete: [false, false, false, false, false],
  isComplete: false,
};

interface EMAState {
  topRoll: number; topPitch: number;
  bottomRoll: number; bottomPitch: number;
  initialised: boolean;
}

// ── Context ───────────────────────────────────────────────────────────────────

const IMUContext = createContext<IMUContextValue | null>(null);

export function IMUProvider({ children }: { children: React.ReactNode }) {
  const [topData,    setTopData]    = useState<IMUSensorData>(defaultSensorData);
  const [bottomData, setBottomData] = useState<IMUSensorData>(defaultSensorData);
  const [posture,    setPosture]    = useState<PostureResult | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<Device[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationState>(defaultCalibration);
  const [clinicalBaseline, setClinicalBaseline] = useState<ClinicalBaseline | null>(null);
  const [isNeutralCalibrated, setIsNeutralCalibrated] = useState(false);

  const [shs,                  setShs]                  = useState(100);
  const [cpl,                  setCpl]                  = useState(0);
  const [timeInCurrentStateMs, setTimeInCurrentStateMs] = useState(0);
  const [sessionDurationMs,    setSessionDurationMs]    = useState(0);
  const [sessionStartTimeMs,   setSessionStartTimeMs]   = useState<number | null>(null);
  const [shouldNudge,          setShouldNudge]          = useState(false);
  const [activeIntervention,   setActiveIntervention]   = useState<InterventionAlert | null>(null);
  const [neckAlignmentPercent, setNeckAlignmentPercent] = useState<number | null>(null);
  const [shoulderBalancePercent, setShoulderBalancePercent] = useState<number | null>(null);
  const [upperBackPercent, setUpperBackPercent] = useState<number | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────

  const topLatestRef     = useRef<ParsedIMU | null>(null);
  const bottomLatestRef  = useRef<ParsedIMU | null>(null);
  const neutralOffsetRef = useRef<NeutralOffset | null>(null);
  const baselineRef      = useRef<ClinicalBaseline | null>(null);

  const emaRef = useRef<EMAState>({
    topRoll: 0, topPitch: 0, bottomRoll: 0, bottomPitch: 0, initialised: false,
  });
  const lastUIUpdateRef         = useRef<number>(0);
  const lastClassificationRef   = useRef<ReturnType<typeof classifySpinePosture> | null>(null);

  const stateStartTimeRef       = useRef<number>(Date.now());
  const lastPostureStateRef     = useRef<PostureState | null>(null);
  const interventionFiredRef    = useRef(false);
  const staticNudgeFiredRef     = useRef(false);
  const staticStartTimeRef      = useRef<number>(Date.now());
  const sessionStartTimeRef     = useRef<number | null>(null); // set on first packet after connect
  const shsRef                  = useRef(100);
  const cplRef                  = useRef(0);
  const shsIntervalRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayIntervalRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  // Upper-back accumulators for time-weighted averaging
  const upperSumScoreMsRef      = useRef<number>(0);
  const upperSumMsRef           = useRef<number>(0);
  const lastPacketTimestampRef  = useRef<number | null>(null);

  const captureRef = useRef<{
    neutral: NeutralOffset | null;
    maxForward: number | null; maxBackward: number | null;
    maxRight: number | null;   maxLeft: number | null;
  }>({ neutral: null, maxForward: null, maxBackward: null, maxRight: null, maxLeft: null });

  // ── Load persisted data on mount ──────────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(BASELINE_STORAGE_KEY).then((raw) => {
      if (!raw) return;
      const saved: ClinicalBaseline = JSON.parse(raw);
      baselineRef.current      = saved;
      neutralOffsetRef.current = saved.neutral;
      setClinicalBaseline(saved);
      setIsNeutralCalibrated(true);
      setCalibration((prev) => ({
        ...prev, stepComplete: [true, true, true, true, true], isComplete: true,
      }));
    }).catch((e) => console.warn("[IMUContext] Failed to load baseline:", e));

    AsyncStorage.getItem(NEUTRAL_OFFSET_STORAGE_KEY).then((raw) => {
      if (!raw) return;
      const saved: NeutralOffset = JSON.parse(raw);
      if (!neutralOffsetRef.current) {
        neutralOffsetRef.current = saved;
        setIsNeutralCalibrated(true);
        setCalibration((prev) => {
          const updated = [...prev.stepComplete]; updated[0] = true;
          return { ...prev, stepComplete: updated };
        });
      }
    }).catch((e) => console.warn("[IMUContext] Failed to load neutral offset:", e));
  }, []);

  // ── SHS + CPL accumulation — ticks every second ───────────────────────────
  //
  // CPL model (Solomonow et al. 2003):
  //   Non-neutral: CPL += weight/sec  (depends on state severity)
  //   Neutral:     CPL -= 0.15/sec   (slow 3:1 recovery ratio)
  //
  // This means brief neutral breaks barely reduce CPL, correctly modelling
  // how spinal creep accumulates across multiple loading bouts.

  useEffect(() => {
    shsIntervalRef.current = setInterval(() => {
      const state = lastPostureStateRef.current;
      if (!state) return;

      // ── SHS ──
      const rate        = SHS_RATES[state] ?? 0;
      const gracePeriod = SHS_GRACE_PERIODS_MS[state] ?? 0;
      const stateElapsed = Date.now() - stateStartTimeRef.current;
      if (rate > 0 || stateElapsed >= gracePeriod) {
        const newShs = Math.max(0, Math.min(100, shsRef.current + rate));
        shsRef.current = newShs;
        setShs(Math.round(newShs));
      }

      // ── CPL ──
      let newCpl: number;
      if (state === "upright") {
        newCpl = Math.max(0, cplRef.current - CPL_RECOVERY_RATE);
      } else {
        newCpl = cplRef.current + (CPL_WEIGHTS[state] ?? 0);
      }
      cplRef.current = newCpl;
      setCpl(Math.round(newCpl));

      // Check CPL intervention threshold for current state
      const cplThreshold = CPL_THRESHOLDS[state];
      if (cplThreshold !== undefined && newCpl >= cplThreshold && !interventionFiredRef.current) {
        interventionFiredRef.current = true;
        const msg = INTERVENTION_MESSAGES[state];
        if (msg) {
          setActiveIntervention({ state, ...msg, cplAtAlert: Math.round(newCpl) });
          // PHONE: Vibration.vibrate([0, 400, 100, 400, 100, 400]);
          // FUTURE S'POT HAPTIC: bleService.sendHapticPulse("top")
          console.log("[IMUContext] CPL intervention fired for", state, "CPL:", Math.round(newCpl));
        }
      }
    }, SHS_TICK_MS);
    return () => { if (shsIntervalRef.current) clearInterval(shsIntervalRef.current); };
  }, []);

  // ── Display timer — ticks every 10 seconds ────────────────────────────────

  useEffect(() => {
    displayIntervalRef.current = setInterval(() => {
      // Current state duration
      const elapsed = Date.now() - stateStartTimeRef.current;
      setTimeInCurrentStateMs(elapsed);

      // Session duration
      if (sessionStartTimeRef.current !== null) {
        setSessionDurationMs(Date.now() - sessionStartTimeRef.current);
      }

      // Static movement nudge (any posture held too long)
      const staticElapsed = Date.now() - staticStartTimeRef.current;
      if (staticElapsed >= STATIC_NUDGE_THRESHOLD_MS && !staticNudgeFiredRef.current) {
        staticNudgeFiredRef.current = true;
        setShouldNudge(true);
        // PHONE: Vibration.vibrate([0, 300, 100, 300]);
        // FUTURE S'POT HAPTIC: bleService.sendHapticPulse("top")
        console.log("[IMUContext] static nudge fired");
      }
    }, DISPLAY_TICK_MS);
    return () => { if (displayIntervalRef.current) clearInterval(displayIntervalRef.current); };
  }, []);

  // ── BLE callbacks ─────────────────────────────────────────────────────────

  useEffect(() => {
    bleService.setCallbacks(
      (slot, dataView) => {
        const parsed = parseIMUPacket(dataView);
        if (!parsed) return;

        if (slot === "top") {
          topLatestRef.current = parsed;
          setTopData((prev) => ({ ...prev, latest: parsed }));
        } else {
          bottomLatestRef.current = parsed;
          setBottomData((prev) => ({ ...prev, latest: parsed }));
        }

        const top    = slot === "top"    ? parsed : topLatestRef.current;
        const bottom = slot === "bottom" ? parsed : bottomLatestRef.current;
        if (!top || !bottom) return;

        // Start session timer on first packet
        if (sessionStartTimeRef.current === null) {
          sessionStartTimeRef.current = Date.now();
          setSessionStartTimeMs(sessionStartTimeRef.current);
          console.log("[IMUContext] session started at", new Date(sessionStartTimeRef.current).toISOString());
          // reset upper-back accumulators for new session
          upperSumScoreMsRef.current = 0;
          upperSumMsRef.current = 0;
          lastPacketTimestampRef.current = Date.now();
        }

        // EMA smoothing
        const ema = emaRef.current;
        if (!ema.initialised) {
          ema.topRoll = top.angle.roll; ema.topPitch = top.angle.pitch;
          ema.bottomRoll = bottom.angle.roll; ema.bottomPitch = bottom.angle.pitch;
          ema.initialised = true;
        } else {
          ema.topRoll     = EMA_ALPHA * top.angle.roll     + (1 - EMA_ALPHA) * ema.topRoll;
          ema.topPitch    = EMA_ALPHA * top.angle.pitch    + (1 - EMA_ALPHA) * ema.topPitch;
          ema.bottomRoll  = EMA_ALPHA * bottom.angle.roll  + (1 - EMA_ALPHA) * ema.bottomRoll;
          ema.bottomPitch = EMA_ALPHA * bottom.angle.pitch + (1 - EMA_ALPHA) * ema.bottomPitch;
        }

        const smoothedTop: ParsedIMU    = { ...top,    angle: { ...top.angle,    roll: ema.topRoll,    pitch: ema.topPitch    } };
        const smoothedBottom: ParsedIMU = { ...bottom, angle: { ...bottom.angle, roll: ema.bottomRoll, pitch: ema.bottomPitch } };

        const offsetToUse = baselineRef.current ?? neutralOffsetRef.current;
        const result      = classifySpinePosture(smoothedTop, smoothedBottom, offsetToUse);
        lastClassificationRef.current = result;
        // --- Upper-back time-weighted accumulation (per-packet) ---
        try {
          const pktNow = Date.now();
          const last = lastPacketTimestampRef.current ?? pktNow;
          const dt = Math.max(0, pktNow - last);
          lastPacketTimestampRef.current = pktNow;

          const instant = result.instantScore ?? 0; // 0-100
          upperSumScoreMsRef.current += instant * dt;
          upperSumMsRef.current += dt;
          if (upperSumMsRef.current > 0) {
            const pct = upperSumScoreMsRef.current / upperSumMsRef.current;
            setUpperBackPercent(Math.round(Math.max(0, Math.min(100, pct))));
          }
        } catch (e) {
          // defensive
        }
        // Compute neck alignment and shoulder balance percents from live, offset-corrected angles
        try {
          const neutral = offsetToUse ? ("neutral" in offsetToUse ? offsetToUse.neutral : offsetToUse) : null;
          const topNeutralRoll = neutral ? neutral.topRoll : 0;
          const topRollDelta = smoothedTop.angle.roll - topNeutralRoll;
          const NECK_TOLERANCE_DEG = 12; // 12° maps to ~0% alignment
          const neckPct = Math.max(0, Math.min(100, 100 - (Math.abs(topRollDelta) / NECK_TOLERANCE_DEG) * 100));
          setNeckAlignmentPercent(Math.round(neckPct));

          const rollDiffDeg = result.rollDiff ?? 0;
          const LATERAL_MAX_DEG = 8; // matches imuParser lateral threshold
          const shoulderPct = Math.max(0, Math.min(100, 100 - (Math.abs(rollDiffDeg) / LATERAL_MAX_DEG) * 100));
          setShoulderBalancePercent(Math.round(shoulderPct));
        } catch (e) {
          // defensive: do not crash the BLE handler
        }

        // State change detection — runs every packet at ~10Hz
        if (result.state !== lastPostureStateRef.current) {
          lastPostureStateRef.current  = result.state;
          stateStartTimeRef.current    = Date.now();
          staticStartTimeRef.current   = Date.now();
          staticNudgeFiredRef.current  = false;
          setTimeInCurrentStateMs(0);
          setShouldNudge(false);
          setActiveIntervention(null);

          // Reset intervention fired flag when state changes
          // BUT only reset if CPL drops below 80% of threshold
          // This prevents immediate re-trigger on brief state flicker
          const newThreshold = CPL_THRESHOLDS[result.state];
          if (!newThreshold || cplRef.current < newThreshold * 0.8) {
            interventionFiredRef.current = false;
          }

          // Force UI update on state change (bypass throttle)
          lastUIUpdateRef.current = 0;
        }

        // UI throttle
        const now = Date.now();
        if (now - lastUIUpdateRef.current < UI_THROTTLE_MS) return;
        lastUIUpdateRef.current = now;

        setPosture({
          state:        result.state as DeskPostureState,
          instantScore: result.instantScore,
          severity:     result.severity,
          label:        POSTURE_LABELS[result.state],
          description:  POSTURE_CUES[result.state],
          pitchDiff:    result.pitchDiff,
          rollDiff:     result.rollDiff,
        });
      },

      (slot, state) => {
        if (slot === "top") {
          setTopData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            topLatestRef.current = null; 
            setPosture(null);
            lastPostureStateRef.current = null;
            emaRef.current.initialised  = false;
            sessionStartTimeRef.current = null;
            setSessionDurationMs(0);
            // Reset upper-back accumulators on disconnect
            upperSumScoreMsRef.current = 0;
            upperSumMsRef.current = 0;
            lastPacketTimestampRef.current = null;
            setUpperBackPercent(null);
          }
        } else {
          setBottomData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            bottomLatestRef.current = null; 
            setPosture(null);
            lastPostureStateRef.current = null;
            emaRef.current.initialised  = false;
            sessionStartTimeRef.current = null;
            setSessionDurationMs(0);
            // Reset upper-back accumulators on disconnect
            upperSumScoreMsRef.current = 0;
            upperSumMsRef.current = 0;
            lastPacketTimestampRef.current = null;
            setUpperBackPercent(null);
          }
        }
      }
    );
  }, []);

  // ── 5-position calibration ────────────────────────────────────────────────

  const startCalibrationStep = useCallback((step: 1 | 2 | 3 | 4 | 5) => {
    setCalibration((prev) => ({ ...prev, currentStep: step, countdown: 3 }));
    const t1 = setTimeout(() => setCalibration((prev) => ({ ...prev, countdown: 2 })), 1000);
    const t2 = setTimeout(() => setCalibration((prev) => ({ ...prev, countdown: 1 })), 2000);

    const samples: Array<{ top: ParsedIMU; bottom: ParsedIMU }> = [];
    const samplingInterval = setInterval(() => {
      const top = topLatestRef.current; const bottom = bottomLatestRef.current;
      if (top && bottom) samples.push({ top, bottom });
    }, 200);

    const t3 = setTimeout(() => {
      clearInterval(samplingInterval);
      if (samples.length === 0) {
        setCalibration((prev) => ({ ...prev, countdown: null, currentStep: null })); return;
      }

      const avg = (key: (s: typeof samples[0]) => number) =>
        samples.reduce((sum, s) => sum + key(s), 0) / samples.length;

      const topPitch = avg((s) => s.top.angle.pitch);
      const topRoll  = avg((s) => s.top.angle.roll);
      const bottomPitch = avg((s) => s.bottom.angle.pitch);
      const bottomRoll  = avg((s) => s.bottom.angle.roll);

      if (step === 1) {
        const offset: NeutralOffset = { topPitch, topRoll, bottomPitch, bottomRoll };
        captureRef.current.neutral   = offset;
        neutralOffsetRef.current     = offset;
        setIsNeutralCalibrated(true);
        emaRef.current.initialised   = false;
        AsyncStorage.setItem(NEUTRAL_OFFSET_STORAGE_KEY, JSON.stringify(offset))
          .catch((e) => console.warn("[IMUContext] Failed to save neutral offset:", e));
      } else if (step === 2) {
        // Forward lean: sagittal axis = pitch (matches classifySpinePosture pitchDiff)
        const neutral = captureRef.current.neutral;
        const tPitch = neutral ? topPitch    - neutral.topPitch    : topPitch;
        const bPitch = neutral ? bottomPitch - neutral.bottomPitch : bottomPitch;
        captureRef.current.maxForward  = Math.max(Math.abs(tPitch - bPitch), 10);
      } else if (step === 3) {
        // Backward lean: same sagittal axis
        const neutral = captureRef.current.neutral;
        const tPitch = neutral ? topPitch    - neutral.topPitch    : topPitch;
        const bPitch = neutral ? bottomPitch - neutral.bottomPitch : bottomPitch;
        captureRef.current.maxBackward = Math.max(Math.abs(tPitch - bPitch), 5);
      } else if (step === 4) {
        // Right lateral: lateral axis = roll (matches classifySpinePosture rollDiff)
        const neutral = captureRef.current.neutral;
        const tRoll = neutral ? topRoll    - neutral.topRoll    : topRoll;
        const bRoll = neutral ? bottomRoll - neutral.bottomRoll : bottomRoll;
        captureRef.current.maxRight    = Math.max(Math.abs(tRoll - bRoll), 5);
      } else if (step === 5) {
        // Left lateral: same lateral axis
        const neutral = captureRef.current.neutral;
        const tRoll = neutral ? topRoll    - neutral.topRoll    : topRoll;
        const bRoll = neutral ? bottomRoll - neutral.bottomRoll : bottomRoll;
        captureRef.current.maxLeft     = Math.max(Math.abs(tRoll - bRoll), 5);
      }

      setCalibration((prev) => {
        const updated = [...prev.stepComplete];
        updated[step - 1] = true;
        const allDone = updated.every(Boolean);
        if (allDone) {
          const { neutral, maxForward, maxBackward, maxRight, maxLeft } = captureRef.current;
          if (neutral && maxForward !== null && maxBackward !== null && maxRight !== null && maxLeft !== null) {
            const baseline: ClinicalBaseline = {
              neutral, maxForwardDeg: maxForward, maxBackwardDeg: maxBackward,
              maxRightDeg: maxRight, maxLeftDeg: maxLeft, capturedAt: new Date().toISOString(),
            };
            baselineRef.current = baseline;
            setClinicalBaseline(baseline);
            AsyncStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline))
              .catch((e) => console.warn("[IMUContext] Failed to save baseline:", e));
          }
        }
        return { ...prev, stepComplete: updated, isComplete: allDone, countdown: 0, currentStep: allDone ? null : step };
      });

      setTimeout(() =>
        setCalibration((prev) => ({ ...prev, countdown: null, currentStep: null })), 1500);
    }, 3000);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearInterval(samplingInterval); };
  }, []);

  const resetCalibration = useCallback(() => {
    captureRef.current     = { neutral: null, maxForward: null, maxBackward: null, maxRight: null, maxLeft: null };
    baselineRef.current    = null; neutralOffsetRef.current = null;
    emaRef.current.initialised = false;
    setClinicalBaseline(null); setIsNeutralCalibrated(false);
    setCalibration(defaultCalibration);
    AsyncStorage.removeItem(BASELINE_STORAGE_KEY).catch(() => {});
    AsyncStorage.removeItem(NEUTRAL_OFFSET_STORAGE_KEY).catch(() => {});
  }, []);

  // ── User actions ──────────────────────────────────────────────────────────

  const confirmMovement = useCallback(() => {
    setShouldNudge(false);
    staticNudgeFiredRef.current = false;
    staticStartTimeRef.current  = Date.now();
  }, []);

  const dismissIntervention = useCallback((moved: boolean) => {
    if (!moved) {
      const penalised = Math.max(0, shsRef.current - 5);
      shsRef.current  = penalised;
      setShs(Math.round(penalised));
      console.log("[IMUContext] intervention ignored — -5 SHS structural debt");
    } else {
      // Partial CPL reset on acknowledged movement
      cplRef.current = Math.max(0, cplRef.current * 0.5);
      setCpl(Math.round(cplRef.current));
    }
    // Allow intervention to re-fire if CPL stays high
    interventionFiredRef.current = false;
    setActiveIntervention(null);
  }, []);

  // ── BLE actions ───────────────────────────────────────────────────────────

  const scan = useCallback(async () => {
    const ok = await bleService.requestPermissions();
    if (!ok) return;
    setDiscoveredDevices([]); 
    setIsScanning(true);
    bleService.scan((device) => {
      setDiscoveredDevices((prev) => {
        if (prev.some((d) => d.id === device.id)) return prev;
        return [...prev, device];
      });
    }, 10000);
    setTimeout(() => setIsScanning(false), 10000);
  }, []);

  const connect       = useCallback(async (device: Device, slot: SensorSlot) => { bleService.stopScan(); setIsScanning(false); await bleService.connectDevice(device, slot); }, []);
  const disconnect    = useCallback(async (slot: SensorSlot) => { await bleService.disconnectSlot(slot); }, []);
  const disconnectAll = useCallback(async () => { await bleService.disconnectAll(); setPosture(null); }, []);

  const bothConnected = topData.state.connected && bottomData.state.connected;

  return (
    <IMUContext.Provider value={{
      topSensor: topData, 
      bottomSensor: bottomData, 
      posture, 
      bothConnected,
      discoveredDevices, isScanning, scan, connect, disconnect, disconnectAll,
      calibration, clinicalBaseline, isNeutralCalibrated,
      startCalibrationStep, resetCalibration,
      shs, cpl, timeInCurrentStateMs, sessionDurationMs, sessionStartTimeMs,
      neckAlignmentPercent, shoulderBalancePercent, upperBackPercent,
      shouldNudge, activeIntervention, confirmMovement, dismissIntervention,
    }}>
      {children}
    </IMUContext.Provider>
  );
}

export function useIMUContext(): IMUContextValue {
  const ctx = useContext(IMUContext);
  if (!ctx) throw new Error("useIMUContext must be used inside <IMUProvider>");
  return ctx;
}