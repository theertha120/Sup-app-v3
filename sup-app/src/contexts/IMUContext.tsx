/**
 * IMUContext.tsx
 *
 * Global singleton context for s'pot BLE state.
 * Wrap the whole app in <IMUProvider> so every screen shares the same
 * connection — s'pots never disconnect just because you navigate away.
 *
 * KEY FIX: Neutral offset is applied from calibration step 1 onwards.
 * Previously the baseline was only applied after ALL 5 steps completed,
 * meaning raw sensor offsets (±40° from mounting orientation) were used
 * for classification — making all thresholds meaningless.
 * Now: step 1 capture → neutralOffsetRef updated immediately → classification
 * works correctly from that point, even before steps 2-5 are done.
 *
 * Scoring: Spine Health Score (SHS) — session-accumulated, starts at 100.
 * Timers: Per-state intervention alerts + 20-min static nudge.
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
  MOVEMENT_NUDGE,
} from "../lib/imuParser";
import { DeskPostureState } from "../desk/mockDeskPostureData";

// ── Storage keys ──────────────────────────────────────────────────────────────

const BASELINE_STORAGE_KEY      = "sup_clinical_baseline_v2";
const NEUTRAL_OFFSET_STORAGE_KEY = "sup_neutral_offset_v1";

// ── Timer constants ───────────────────────────────────────────────────────────

// Change to 20 * 60 * 1000 for production
const STATIC_NUDGE_THRESHOLD_MS = 1 * 60 * 1000; // 1 min for testing
const SHS_TICK_MS     = 1_000;
const DISPLAY_TICK_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IMUSensorData {
  latest: ParsedIMU | null;
  state: SensorState;
}

export interface PostureResult {
  state: DeskPostureState;
  /** Instant posture quality — used for figure colour only, not the session SHS */
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
  stepComplete: boolean[]; // length 5
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
  /** Whether step 1 (neutral) has been captured — enables live classification */
  isNeutralCalibrated: boolean;
  startCalibrationStep: (step: 1 | 2 | 3 | 4 | 5) => void;
  resetCalibration: () => void;

  /** Session Spine Health Score 0–100 */
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

  /**
   * neutralOffsetRef — applied to EVERY classification call.
   * Set as soon as step 1 is captured (not after all 5 steps).
   * This is the critical fix: without this, raw sensor offsets make
   * all classification thresholds meaningless.
   */
  const neutralOffsetRef = useRef<NeutralOffset | null>(null);

  /**
   * baselineRef — the full 5-position calibration.
   * Only set once all 5 steps complete.
   * Used for personalised ROM ceilings in SHS scoring (v1 feature).
   */
  const baselineRef = useRef<ClinicalBaseline | null>(null);

  const stateStartTimeRef       = useRef<number>(Date.now());
  const stateGraceStartRef      = useRef<number>(Date.now());
  const lastPostureStateRef     = useRef<PostureState | null>(null);
  const interventionFiredRef    = useRef(false);
  const staticNudgeFiredRef     = useRef(false);
  const staticStartTimeRef      = useRef<number>(Date.now());
  const shsRef                  = useRef(100);
  const shsIntervalRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayIntervalRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  const captureRef = useRef<{
    neutral:     NeutralOffset | null;
    maxForward:  number | null;
    maxBackward: number | null;
    maxRight:    number | null;
    maxLeft:     number | null;
  }>({ neutral: null, maxForward: null, maxBackward: null, maxRight: null, maxLeft: null });

  // ── Load persisted data on mount ──────────────────────────────────────────

  useEffect(() => {
    // Load full baseline if exists
    AsyncStorage.getItem(BASELINE_STORAGE_KEY).then((raw) => {
      if (!raw) return;
      const saved: ClinicalBaseline = JSON.parse(raw);
      baselineRef.current    = saved;
      neutralOffsetRef.current = saved.neutral;
      setClinicalBaseline(saved);
      setIsNeutralCalibrated(true);
      setCalibration((prev) => ({
        ...prev, stepComplete: [true, true, true, true, true], isComplete: true,
      }));
    }).catch((e) => console.warn("[IMUContext] Failed to load baseline:", e));

    // Load neutral offset separately (available after step 1 even without full baseline)
    AsyncStorage.getItem(NEUTRAL_OFFSET_STORAGE_KEY).then((raw) => {
      if (!raw) return;
      const saved: NeutralOffset = JSON.parse(raw);
      // Only apply if no full baseline already loaded
      if (!neutralOffsetRef.current) {
        neutralOffsetRef.current = saved;
        setIsNeutralCalibrated(true);
        setCalibration((prev) => {
          const updated = [...prev.stepComplete];
          updated[0] = true;
          return { ...prev, stepComplete: updated };
        });
      }
    }).catch((e) => console.warn("[IMUContext] Failed to load neutral offset:", e));
  }, []);

  // ── SHS accumulation — ticks every second ─────────────────────────────────

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

  // ── Display timer + intervention checker — ticks every 10 seconds ─────────

  useEffect(() => {
    displayIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - stateStartTimeRef.current;
      setTimeInCurrentStateMs(elapsed);

      // Static movement nudge
      const staticElapsed = Date.now() - staticStartTimeRef.current;
      if (staticElapsed >= STATIC_NUDGE_THRESHOLD_MS && !staticNudgeFiredRef.current) {
        staticNudgeFiredRef.current = true;
        setShouldNudge(true);
        // PHONE: wire to expo-notifications here
        // PHONE: Vibration.vibrate([0, 300, 100, 300]);
        // FUTURE S'POT HAPTIC: bleService.sendHapticPulse("top")
        console.log("[IMUContext] static nudge fired");
      }

      // Per-state intervention
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

        // Use full baseline if available, else use neutral offset alone.
        // Either way, the offset is applied and classification is meaningful.
        const offsetToUse = baselineRef.current ?? neutralOffsetRef.current;
        const result      = classifySpinePosture(top, bottom, offsetToUse);
        const newState    = result.state as DeskPostureState;

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
        }

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
          if (!state.connected) { topLatestRef.current = null; setPosture(null); lastPostureStateRef.current = null; }
        } else {
          setBottomData((prev) => ({ ...prev, state }));
          if (!state.connected) { bottomLatestRef.current = null; setPosture(null); lastPostureStateRef.current = null; }
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
        captureRef.current.neutral = offset;

        // ── KEY FIX: Apply neutral offset IMMEDIATELY after step 1 ──────────
        // This makes classification meaningful right away, even before steps 2-5.
        // Without this, raw sensor offsets (±40°) corrupt all thresholds.
        neutralOffsetRef.current = offset;
        setIsNeutralCalibrated(true);

        // Persist neutral offset separately so it survives app restart
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
        const updated  = [...prev.stepComplete];
        updated[step - 1] = true;
        const allDone  = updated.every(Boolean);

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
    captureRef.current   = { neutral: null, maxForward: null, maxBackward: null, maxRight: null, maxLeft: null };
    baselineRef.current  = null;
    neutralOffsetRef.current = null;
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
      console.log("[IMUContext] intervention ignored — -5 SHS structural debt");
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

  const connect = useCallback(async (device: Device, slot: SensorSlot) => {
    bleService.stopScan(); setIsScanning(false);
    await bleService.connectDevice(device, slot);
  }, []);

  const disconnect  = useCallback(async (slot: SensorSlot)  => { await bleService.disconnectSlot(slot); }, []);
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