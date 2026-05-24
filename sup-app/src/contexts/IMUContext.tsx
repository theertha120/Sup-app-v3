/**
 * IMUContext.tsx
 *
 * Global singleton context for s'pot BLE state.
 * Wrap the whole app in <IMUProvider> so every screen shares the same
 * connection — s'pots never disconnect just because you navigate away.
 *
 * KEY FIX (this version): EMA smoothing + UI throttle to eliminate jitter.
 *
 *   Raw BLE data arrives at ~10Hz (every 100ms).
 *   Without smoothing, tiny sensor noise causes the figure to twitch
 *   constantly and state labels to flicker between adjacent states.
 *
 *   Solution — two-stage approach used in production motion apps:
 *
 *   1. Exponential Moving Average (EMA) on raw angles before classification.
 *      EMA formula: smoothed = α × raw + (1-α) × previous
 *      α = 0.15 → heavily smoothed, ~650ms lag to reach 90% of a new position
 *      This removes high-frequency noise while preserving real movements.
 *
 *   2. UI throttle — React state (setPosture) only updated every 500ms.
 *      Classification runs every packet for internal logic (timers, SHS),
 *      but the UI only re-renders twice per second. This stops the figure
 *      from animating to every tiny fluctuation.
 *
 *   Result: smooth, calm figure that still responds visibly within ~1 second
 *   to real posture changes — similar to how Apple Watch smooths heart rate.
 *
 * Other fixes in this version:
 *   - Neutral offset applied from step 1 immediately
 *   - Backward lean correctly classified as upright (not forward lean)
 */

import React, {
  createContext, useContext, useState,
  useEffect, useCallback, useRef,
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
  INTERVENTION_THRESHOLDS_MS,
  INTERVENTION_MESSAGES,
  SHS_RATES,
  SHS_GRACE_PERIODS_MS,
} from "../lib/imuParser";
import { DeskPostureState } from "../desk/mockDeskPostureData";

// ── Storage keys ──────────────────────────────────────────────────────────────

const BASELINE_STORAGE_KEY       = "sup_clinical_baseline_v2";
const NEUTRAL_OFFSET_STORAGE_KEY = "sup_neutral_offset_v1";

// ── Constants ─────────────────────────────────────────────────────────────────

// Change to 20 * 60 * 1000 for production
const STATIC_NUDGE_THRESHOLD_MS = 1 * 60 * 1000;
const SHS_TICK_MS               = 1_000;
const DISPLAY_TICK_MS           = 10_000;

/**
 * EMA smoothing factor α (alpha).
 * Range: 0.0 (no update) to 1.0 (no smoothing, raw passthrough).
 *
 * 0.15 = smooth, ~650ms to reach 90% of a step change.
 *        Good for casual posture monitoring — real slouches take seconds,
 *        not milliseconds, so lag is imperceptible to the user.
 *
 * Increase toward 0.3 if the figure feels too sluggish to respond.
 * Decrease toward 0.08 if still jittery on your specific sensor pair.
 */
const EMA_ALPHA = 0.15;

/**
 * UI update throttle — how often React state is updated with new posture.
 * Classification still runs every packet (100ms) for internal timer accuracy.
 * The figure and label only re-render at this rate.
 *
 * 500ms = 2 updates per second — smooth enough to feel live, calm enough
 * to avoid jitter. Similar to how watchOS throttles heart rate display.
 */
const UI_THROTTLE_MS = 500;

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
  durationMs: number;
}

export interface IMUContextValue {
  topSensor: IMUSensorData;
  bottomSensor: IMUSensorData;
  posture: PostureResult | null;
  bothConnected: boolean;

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
  timeInCurrentStateMs: number;
  shouldNudge: boolean;
  activeIntervention: InterventionAlert | null;
  confirmMovement: () => void;
  dismissIntervention: (moved: boolean) => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const defaultSensorState: SensorState = { connected: false, deviceId: null, deviceName: null };
const defaultSensorData: IMUSensorData = { latest: null, state: defaultSensorState };
const defaultCalibration: CalibrationState = {
  currentStep: null, countdown: null,
  stepComplete: [false, false, false, false, false],
  isComplete: false,
};

// ── EMA state ─────────────────────────────────────────────────────────────────

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
  const [timeInCurrentStateMs, setTimeInCurrentStateMs] = useState(0);
  const [shouldNudge,          setShouldNudge]          = useState(false);
  const [activeIntervention,   setActiveIntervention]   = useState<InterventionAlert | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────

  const topLatestRef    = useRef<ParsedIMU | null>(null);
  const bottomLatestRef = useRef<ParsedIMU | null>(null);
  const neutralOffsetRef = useRef<NeutralOffset | null>(null);
  const baselineRef      = useRef<ClinicalBaseline | null>(null);

  // EMA smoothed angle state — updated every BLE packet, not React state
  const emaRef = useRef<EMAState>({
    topRoll: 0, topPitch: 0,
    bottomRoll: 0, bottomPitch: 0,
    initialised: false,
  });

  // UI throttle — track last time we pushed to React state
  const lastUIUpdateRef = useRef<number>(0);

  // Internal classification result — updated every packet for timer accuracy
  const lastClassificationRef = useRef<ReturnType<typeof classifySpinePosture> | null>(null);

  const stateStartTimeRef    = useRef<number>(Date.now());
  const stateGraceStartRef   = useRef<number>(Date.now());
  const lastPostureStateRef  = useRef<PostureState | null>(null);
  const interventionFiredRef = useRef(false);
  const staticNudgeFiredRef  = useRef(false);
  const staticStartTimeRef   = useRef<number>(Date.now());
  const shsRef               = useRef(100);
  const shsIntervalRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // ── SHS accumulation ──────────────────────────────────────────────────────

  useEffect(() => {
    shsIntervalRef.current = setInterval(() => {
      const state = lastPostureStateRef.current;
      if (!state) return;
      const rate        = SHS_RATES[state] ?? 0;
      const gracePeriod = SHS_GRACE_PERIODS_MS[state] ?? 0;
      const elapsed     = Date.now() - stateGraceStartRef.current;
      if (rate > 0 || elapsed >= gracePeriod) {
        const newShs = Math.max(0, Math.min(100, shsRef.current + rate));
        shsRef.current = newShs;
        setShs(Math.round(newShs));
      }
    }, SHS_TICK_MS);
    return () => { if (shsIntervalRef.current) clearInterval(shsIntervalRef.current); };
  }, []);

  // ── Display timer + intervention checker ──────────────────────────────────

  useEffect(() => {
    displayIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - stateStartTimeRef.current;
      setTimeInCurrentStateMs(elapsed);

      const staticElapsed = Date.now() - staticStartTimeRef.current;
      if (staticElapsed >= STATIC_NUDGE_THRESHOLD_MS && !staticNudgeFiredRef.current) {
        staticNudgeFiredRef.current = true;
        setShouldNudge(true);
        // PHONE: Vibration.vibrate([0, 300, 100, 300]);
        // FUTURE S'POT HAPTIC: bleService.sendHapticPulse("top")
        console.log("[IMUContext] static nudge fired");
      }

      const state = lastPostureStateRef.current;
      if (!state || interventionFiredRef.current) return;
      const threshold = INTERVENTION_THRESHOLDS_MS[state];
      if (threshold !== undefined && elapsed >= threshold) {
        interventionFiredRef.current = true;
        const msg = INTERVENTION_MESSAGES[state];
        if (msg) {
          setActiveIntervention({ state, ...msg, durationMs: elapsed });
          // PHONE: Vibration.vibrate([0, 400, 100, 400, 100, 400]);
          // FUTURE S'POT HAPTIC: bleService.sendHapticPulse("top")
          console.log("[IMUContext] intervention fired for", state);
        }
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

        // Store raw latest for calibration sampling and sensor detail display
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

        // ── EMA smoothing ──────────────────────────────────────────────────
        // Apply exponential moving average to raw angles before classification.
        // This removes high-frequency sensor noise while preserving real movement.
        // First packet initialises EMA to raw values (no lag on first read).
        const ema = emaRef.current;
        if (!ema.initialised) {
          ema.topRoll    = top.angle.roll;
          ema.topPitch   = top.angle.pitch;
          ema.bottomRoll  = bottom.angle.roll;
          ema.bottomPitch = bottom.angle.pitch;
          ema.initialised = true;
        } else {
          ema.topRoll     = EMA_ALPHA * top.angle.roll     + (1 - EMA_ALPHA) * ema.topRoll;
          ema.topPitch    = EMA_ALPHA * top.angle.pitch    + (1 - EMA_ALPHA) * ema.topPitch;
          ema.bottomRoll  = EMA_ALPHA * bottom.angle.roll  + (1 - EMA_ALPHA) * ema.bottomRoll;
          ema.bottomPitch = EMA_ALPHA * bottom.angle.pitch + (1 - EMA_ALPHA) * ema.bottomPitch;
        }

        // Build smoothed ParsedIMU objects for classification
        const smoothedTop: ParsedIMU    = { ...top,    angle: { ...top.angle,    roll: ema.topRoll,    pitch: ema.topPitch    } };
        const smoothedBottom: ParsedIMU = { ...bottom, angle: { ...bottom.angle, roll: ema.bottomRoll, pitch: ema.bottomPitch } };

        // Classify on smoothed angles
        const offsetToUse = baselineRef.current ?? neutralOffsetRef.current;
        const result      = classifySpinePosture(smoothedTop, smoothedBottom, offsetToUse);
        lastClassificationRef.current = result;

        // ── State change detection (runs every packet at ~10Hz) ────────────
        if (result.state !== lastPostureStateRef.current) {
          lastPostureStateRef.current  = result.state;
          stateStartTimeRef.current    = Date.now();
          stateGraceStartRef.current   = Date.now();
          interventionFiredRef.current = false;
          staticStartTimeRef.current   = Date.now();
          staticNudgeFiredRef.current  = false;
          setTimeInCurrentStateMs(0);
          setShouldNudge(false);
          setActiveIntervention(null);
          // State change always triggers an immediate UI update regardless of throttle
          lastUIUpdateRef.current = 0;
        }

        // ── UI throttle (React state update at most every 500ms) ───────────
        // Classification above runs every packet for accurate timer tracking.
        // React re-renders (and figure animation) are throttled to avoid jitter.
        const now = Date.now();
        if (now - lastUIUpdateRef.current < UI_THROTTLE_MS) return;
        lastUIUpdateRef.current = now;

        const newState = result.state as DeskPostureState;
        setPosture({
          state:        newState,
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
            // Reset EMA on disconnect so next connect starts fresh
            emaRef.current.initialised = false;
          }
        } else {
          setBottomData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            bottomLatestRef.current = null;
            setPosture(null);
            lastPostureStateRef.current = null;
            emaRef.current.initialised = false;
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
        setCalibration((prev) => ({ ...prev, countdown: null, currentStep: null }));
        return;
      }

      const avg = (key: (s: typeof samples[0]) => number) =>
        samples.reduce((sum, s) => sum + key(s), 0) / samples.length;

      const topPitch    = avg((s) => s.top.angle.pitch);
      const topRoll     = avg((s) => s.top.angle.roll);
      const bottomPitch = avg((s) => s.bottom.angle.pitch);
      const bottomRoll  = avg((s) => s.bottom.angle.roll);

      if (step === 1) {
        const offset: NeutralOffset = { topPitch, topRoll, bottomPitch, bottomRoll };
        captureRef.current.neutral   = offset;
        neutralOffsetRef.current     = offset;
        setIsNeutralCalibrated(true);
        // Reset EMA after calibration so smoothing starts from new neutral
        emaRef.current.initialised   = false;
        AsyncStorage.setItem(NEUTRAL_OFFSET_STORAGE_KEY, JSON.stringify(offset))
          .catch((e) => console.warn("[IMUContext] Failed to save neutral offset:", e));

      } else if (step === 2) {
        const neutral = captureRef.current.neutral;
        const tRoll = neutral ? topRoll    - neutral.topRoll    : topRoll;
        const bRoll = neutral ? bottomRoll - neutral.bottomRoll : bottomRoll;
        captureRef.current.maxForward  = Math.max(Math.abs(tRoll - bRoll), 10);

      } else if (step === 3) {
        const neutral = captureRef.current.neutral;
        const tRoll = neutral ? topRoll    - neutral.topRoll    : topRoll;
        const bRoll = neutral ? bottomRoll - neutral.bottomRoll : bottomRoll;
        captureRef.current.maxBackward = Math.max(Math.abs(tRoll - bRoll), 5);

      } else if (step === 4) {
        const neutral = captureRef.current.neutral;
        const tPitch = neutral ? topPitch    - neutral.topPitch    : topPitch;
        const bPitch = neutral ? bottomPitch - neutral.bottomPitch : bottomPitch;
        captureRef.current.maxRight    = Math.max(Math.abs(tPitch - bPitch), 5);

      } else if (step === 5) {
        const neutral = captureRef.current.neutral;
        const tPitch = neutral ? topPitch    - neutral.topPitch    : topPitch;
        const bPitch = neutral ? bottomPitch - neutral.bottomPitch : bottomPitch;
        captureRef.current.maxLeft     = Math.max(Math.abs(tPitch - bPitch), 5);
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
              maxRightDeg: maxRight, maxLeftDeg: maxLeft,
              capturedAt: new Date().toISOString(),
            };
            baselineRef.current = baseline;
            setClinicalBaseline(baseline);
            AsyncStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline))
              .catch((e) => console.warn("[IMUContext] Failed to save baseline:", e));
          }
        }

        return {
          ...prev, stepComplete: updated, isComplete: allDone,
          countdown: 0, currentStep: allDone ? null : step,
        };
      });

      setTimeout(() =>
        setCalibration((prev) => ({ ...prev, countdown: null, currentStep: null })), 1500);
    }, 3000);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearInterval(samplingInterval); };
  }, []);

  const resetCalibration = useCallback(() => {
    captureRef.current     = { neutral: null, maxForward: null, maxBackward: null, maxRight: null, maxLeft: null };
    baselineRef.current    = null;
    neutralOffsetRef.current = null;
    emaRef.current.initialised = false;
    setClinicalBaseline(null);
    setIsNeutralCalibrated(false);
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
    }
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

  const connect     = useCallback(async (device: Device, slot: SensorSlot) => {
    bleService.stopScan(); setIsScanning(false);
    await bleService.connectDevice(device, slot);
  }, []);
  const disconnect  = useCallback(async (slot: SensorSlot) => { await bleService.disconnectSlot(slot); }, []);
  const disconnectAll = useCallback(async () => { await bleService.disconnectAll(); setPosture(null); }, []);

  const bothConnected = topData.state.connected && bottomData.state.connected;

  return (
    <IMUContext.Provider value={{
      topSensor: topData, bottomSensor: bottomData, posture, bothConnected,
      discoveredDevices, isScanning, scan, connect, disconnect, disconnectAll,
      calibration, clinicalBaseline, isNeutralCalibrated,
      startCalibrationStep, resetCalibration,
      shs, timeInCurrentStateMs, shouldNudge, activeIntervention,
      confirmMovement, dismissIntervention,
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