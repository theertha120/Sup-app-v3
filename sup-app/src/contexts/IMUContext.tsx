/**
 * IMUContext.tsx
 *
 * Global singleton context for s'pot BLE state.
 * Wrap the whole app in <IMUProvider> so every screen shares the same
 * connection — s'pots never disconnect just because you navigate away.
 *
 * Calibration:
 *   3-position protocol captures personal ROM ceiling alongside neutral upright.
 *   See CalibrationModal.tsx for the UI flow.
 *   ClinicalBaseline is persisted to AsyncStorage so it survives app restarts.
 *
 * 20-minute static posture timer (Tanoue et al. 2021):
 *   Any static posture held for 20+ minutes increases lumbar/pelvic loading
 *   regardless of whether the posture is good or bad.
 *   timeInCurrentStateMs tracks how long the current posture state has been held.
 *   shouldNudge flips true at the 20-minute mark and resets when state changes.
 *   Wire shouldNudge → expo-notifications to fire a movement reminder.
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
  PostureSeverity,
  POSTURE_LABELS,
  POSTURE_CUES,
} from "../lib/imuParser";
import { DeskPostureState } from "../desk/mockDeskPostureData";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASELINE_STORAGE_KEY = "sup_clinical_baseline_v1";

/**
 * 20 minutes in ms — the static posture threshold from Tanoue et al. (2021).
 * Any position held beyond this, even upright, significantly increases
 * lumbar and pelvic loading compared to dynamic sitting.
 */
const NUDGE_THRESHOLD_MS = 1 * 60 * 1000; // 1 minutes

/**
 * How often the timer state is updated in React state (ms).
 * Kept at 10 seconds to avoid unnecessary re-renders while still
 * giving the UI a reasonably live elapsed time display.
 */
const TIMER_TICK_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IMUSensorData {
  latest: ParsedIMU | null;
  state: SensorState;
}

export interface PostureResult {
  state: DeskPostureState;
  /** Postural Load Index 0–100 (higher = better) */
  score: number;
  severity: PostureSeverity;
  label: string;
  description: string;
  pitchDiff: number;
  rollDiff: number;
  /** Fraction of personal ROM used — null until calibrated */
  romFraction: number | null;
}

export interface CalibrationState {
  currentStep: 1 | 2 | 3 | null;
  countdown: number | null;
  stepComplete: boolean[];
  isComplete: boolean;
}

export interface IMUContextValue {
  // s'pot data
  topSensor: IMUSensorData;
  bottomSensor: IMUSensorData;
  posture: PostureResult | null;
  bothConnected: boolean;

  // BLE scanning / connection
  discoveredDevices: Device[];
  isScanning: boolean;
  scan: () => Promise<void>;
  connect: (device: Device, slot: SensorSlot) => Promise<void>;
  disconnect: (slot: SensorSlot) => Promise<void>;
  disconnectAll: () => Promise<void>;

  // 3-position calibration
  calibration: CalibrationState;
  clinicalBaseline: ClinicalBaseline | null;
  startCalibrationStep: (step: 1 | 2 | 3) => void;
  resetCalibration: () => void;

  /**
   * How long the current posture state has been held continuously, in ms.
   * Resets to 0 whenever the posture state changes.
   * Only increments when both s'pots are connected.
   * Use this to show a progress indicator in the UI if desired.
   */
  timeInCurrentStateMs: number;

  /**
   * True when the user has been in the same posture state for 20+ minutes.
   * Based on Tanoue et al. (2021) — any static position beyond 20 min
   * significantly reduces lumbar and pelvic mobility.
   * Wire this to expo-notifications to fire a movement reminder.
   * Resets to false as soon as the posture state changes.
   */
  shouldNudge: boolean;

  /**
   * Call this after firing the nudge notification so the user isn't
   * notified again until the next 20-minute window.
   */
  acknowledgeNudge: () => void;
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
  currentStep:  null,
  countdown:    null,
  stepComplete: [false, false, false],
  isComplete:   false,
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

  // ── 20-minute timer state ─────────────────────────────────────────────────
  const [timeInCurrentStateMs, setTimeInCurrentStateMs] = useState(0);
  const [shouldNudge,          setShouldNudge]          = useState(false);

  // Refs that track timer state without stale closure issues
  const stateStartTimeRef  = useRef<number>(Date.now());
  const lastPostureStateRef = useRef<DeskPostureState | null>(null);
  const nudgeFiredRef      = useRef(false); // prevents repeated nudges in same window
  const timerIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── IMU data refs ─────────────────────────────────────────────────────────
  const topLatestRef    = useRef<ParsedIMU | null>(null);
  const bottomLatestRef = useRef<ParsedIMU | null>(null);
  const baselineRef     = useRef<ClinicalBaseline | null>(null);

  // Partial capture during calibration
  const captureRef = useRef<{
    neutral:    { topPitch: number; topRoll: number; bottomPitch: number; bottomRoll: number } | null;
    maxForward: number | null;
    maxLateral: number | null;
  }>({ neutral: null, maxForward: null, maxLateral: null });

  // ── Load persisted baseline on mount ─────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(BASELINE_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved: ClinicalBaseline = JSON.parse(raw);
        baselineRef.current = saved;
        setClinicalBaseline(saved);
        setCalibration((prev) => ({
          ...prev,
          stepComplete: [true, true, true],
          isComplete: true,
        }));
      })
      .catch((e) => console.warn("[IMUContext] Failed to load baseline:", e));
  }, []);

  // ── 20-minute static posture timer ───────────────────────────────────────
  //
  // A lightweight interval ticks every TIMER_TICK_MS (10s).
  // On each tick it computes elapsed ms since the current state began
  // and updates React state — triggering a re-render at most every 10s.
  //
  // The actual state-change detection happens in the BLE callback (below)
  // which runs at ~10Hz — far more responsive than this timer.
  // This interval is only for keeping the UI elapsed time display current.

  useEffect(() => {
    timerIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - stateStartTimeRef.current;
      setTimeInCurrentStateMs(elapsed);

      // Fire nudge once per 20-minute window
      if (elapsed >= NUDGE_THRESHOLD_MS && !nudgeFiredRef.current) {
        nudgeFiredRef.current = true;
        setShouldNudge(true);
        console.log("[IMUContext] 20-min static posture threshold reached — nudge fired");
      }
    }, TIMER_TICK_MS);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // ── BLE callbacks — registered once, live for the entire app lifetime ─────

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

        const result = classifySpinePosture(top, bottom, baselineRef.current);
        const newState = result.state as DeskPostureState;

        // ── State change detection for 20-min timer ──────────────────────
        // Runs at ~10Hz so state changes are caught within ~100ms.
        // When the state changes: reset the timer and clear any pending nudge.
        if (newState !== lastPostureStateRef.current) {
          lastPostureStateRef.current = newState;
          stateStartTimeRef.current   = Date.now();
          nudgeFiredRef.current       = false;
          setTimeInCurrentStateMs(0);
          setShouldNudge(false);
        }

        setPosture({
          state:       newState,
          score:       result.pli,
          severity:    result.severity,
          label:       POSTURE_LABELS[result.state],
          description: POSTURE_CUES[result.state],
          pitchDiff:   result.pitchDiff,
          rollDiff:    result.rollDiff,
          romFraction: result.romFraction,
        });
      },

      (slot, state) => {
        if (slot === "top") {
          setTopData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            topLatestRef.current = null;
            setPosture(null);
            // Reset timer when s'pot disconnects
            stateStartTimeRef.current    = Date.now();
            lastPostureStateRef.current  = null;
            nudgeFiredRef.current        = false;
            setTimeInCurrentStateMs(0);
            setShouldNudge(false);
          }
        } else {
          setBottomData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            bottomLatestRef.current = null;
            setPosture(null);
            stateStartTimeRef.current    = Date.now();
            lastPostureStateRef.current  = null;
            nudgeFiredRef.current        = false;
            setTimeInCurrentStateMs(0);
            setShouldNudge(false);
          }
        }
      }
    );
  }, []);

  // ── 3-position calibration ────────────────────────────────────────────────

  const startCalibrationStep = useCallback((step: 1 | 2 | 3) => {
    setCalibration((prev) => ({ ...prev, currentStep: step, countdown: 3 }));

    const t1 = setTimeout(() =>
      setCalibration((prev) => ({ ...prev, countdown: 2 })), 1000);
    const t2 = setTimeout(() =>
      setCalibration((prev) => ({ ...prev, countdown: 1 })), 2000);

    // Collect samples every 200ms during the 3-second hold — then average.
    // More robust than a single snapshot (Tanoue et al. 2021).
    const samples: Array<{ top: ParsedIMU; bottom: ParsedIMU }> = [];
    const samplingInterval = setInterval(() => {
      const top    = topLatestRef.current;
      const bottom = bottomLatestRef.current;
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
        captureRef.current.neutral = { topPitch, topRoll, bottomPitch, bottomRoll };
      } else if (step === 2) {
        const neutral = captureRef.current.neutral;
        const tRoll = neutral ? topRoll    - neutral.topRoll    : topRoll;
        const bRoll = neutral ? bottomRoll - neutral.bottomRoll : bottomRoll;
        captureRef.current.maxForward = Math.max(Math.abs(tRoll - bRoll), 10);
      } else if (step === 3) {
        const neutral = captureRef.current.neutral;
        const tPitch = neutral ? topPitch    - neutral.topPitch    : topPitch;
        const bPitch = neutral ? bottomPitch - neutral.bottomPitch : bottomPitch;
        captureRef.current.maxLateral = Math.max(Math.abs(tPitch - bPitch), 5);
      }

      setCalibration((prev) => {
        const updated = [...prev.stepComplete];
        updated[step - 1] = true;
        const allDone = updated.every(Boolean);

        if (allDone) {
          const { neutral, maxForward, maxLateral } = captureRef.current;
          if (neutral && maxForward !== null && maxLateral !== null) {
            const baseline: ClinicalBaseline = {
              neutral,
              maxForwardDeg: maxForward,
              maxLateralDeg: maxLateral,
              capturedAt: new Date().toISOString(),
            };
            baselineRef.current = baseline;
            setClinicalBaseline(baseline);
            AsyncStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline))
              .catch((e) => console.warn("[IMUContext] Failed to save baseline:", e));
          }
        }

        return {
          ...prev,
          stepComplete: updated,
          isComplete: allDone,
          countdown: 0,
          currentStep: allDone ? null : step,
        };
      });

      setTimeout(() =>
        setCalibration((prev) => ({ ...prev, countdown: null, currentStep: null })),
        1500
      );
    }, 3000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearInterval(samplingInterval);
    };
  }, []);

  const resetCalibration = useCallback(() => {
    captureRef.current = { neutral: null, maxForward: null, maxLateral: null };
    baselineRef.current = null;
    setClinicalBaseline(null);
    setCalibration(defaultCalibration);
    AsyncStorage.removeItem(BASELINE_STORAGE_KEY)
      .catch((e) => console.warn("[IMUContext] Failed to clear baseline:", e));
  }, []);

  // ── Nudge acknowledgement ─────────────────────────────────────────────────

  const acknowledgeNudge = useCallback(() => {
    setShouldNudge(false);
    // Don't reset nudgeFiredRef — prevents re-firing in the same 20-min window.
    // It will reset naturally when the posture state changes.
  }, []);

  // ── BLE actions ───────────────────────────────────────────────────────────

  const scan = useCallback(async () => {
    const hasPermission = await bleService.requestPermissions();
    if (!hasPermission) return;
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
    bleService.stopScan();
    setIsScanning(false);
    await bleService.connectDevice(device, slot);
  }, []);

  const disconnect = useCallback(async (slot: SensorSlot) => {
    await bleService.disconnectSlot(slot);
  }, []);

  const disconnectAll = useCallback(async () => {
    await bleService.disconnectAll();
    setPosture(null);
  }, []);

  const bothConnected = topData.state.connected && bottomData.state.connected;

  return (
    <IMUContext.Provider value={{
      topSensor:    topData,
      bottomSensor: bottomData,
      posture,
      bothConnected,
      discoveredDevices,
      isScanning,
      scan,
      connect,
      disconnect,
      disconnectAll,
      calibration,
      clinicalBaseline,
      startCalibrationStep,
      resetCalibration,
      timeInCurrentStateMs,
      shouldNudge,
      acknowledgeNudge,
    }}>
      {children}
    </IMUContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useIMUContext(): IMUContextValue {
  const ctx = useContext(IMUContext);
  if (!ctx) throw new Error("useIMUContext must be used inside <IMUProvider>");
  return ctx;
}