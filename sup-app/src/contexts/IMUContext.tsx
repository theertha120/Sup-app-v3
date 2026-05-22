/**
 * IMUContext.tsx
 *
 * Global singleton context for s'pot BLE state.
 * Wrap the whole app in <IMUProvider> so every screen shares the same
 * connection — s'pots never disconnect just because you navigate away.
 *
 * Calibration:
 *   The old single-step calibration is replaced with a 3-position protocol
 *   that captures the user's personal ROM ceiling alongside neutral upright.
 *   See CalibrationModal.tsx for the UI flow.
 *   ClinicalBaseline is persisted to AsyncStorage so it survives app restarts.
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
  PostureState,
  PostureSeverity,
  POSTURE_LABELS,
  POSTURE_CUES,
} from "../lib/imuParser";
import { DeskPostureState } from "../desk/mockDeskPostureData";

// ── AsyncStorage key ──────────────────────────────────────────────────────────
// One baseline per user — keyed by a constant for now, extend with userId later
const BASELINE_STORAGE_KEY = "sup_clinical_baseline_v1";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IMUSensorData {
  latest: ParsedIMU | null;
  state: SensorState;
}

export interface PostureResult {
  state: DeskPostureState;
  /** Postural Load Index 0-100 (higher = better) — replaces old linear score */
  score: number;
  severity: PostureSeverity;
  label: string;
  description: string;
  pitchDiff: number;
  rollDiff: number;
  /** Fraction of personal ROM used — null until calibrated */
  romFraction: number | null;
}

/**
 * 3-step calibration state exposed to the UI.
 *
 *   step 1 = neutral upright (the zero reference)
 *   step 2 = max forward lean (sets sagittal ROM ceiling)
 *   step 3 = max lateral lean (sets lateral ROM ceiling)
 *
 * Each step has its own countdown (3→2→1→capture).
 * currentStep is null when no calibration is running.
 */
export interface CalibrationState {
  currentStep: 1 | 2 | 3 | null;
  countdown: number | null;        // 3, 2, 1, or 0 (= "done" flash)
  stepComplete: boolean[];         // [step1done, step2done, step3done]
  isComplete: boolean;             // true once all 3 steps captured
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
  /**
   * Start a specific calibration step.
   * Runs a 3-second countdown then captures s'pot angles for that step.
   * Call in order: startCalibrationStep(1) → (2) → (3).
   */
  startCalibrationStep: (step: 1 | 2 | 3) => void;
  /** Reset all calibration state (e.g. if user wants to redo) */
  resetCalibration: () => void;
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

  // Refs for latest IMU readings — used inside BLE callbacks without stale closures
  const topLatestRef    = useRef<ParsedIMU | null>(null);
  const bottomLatestRef = useRef<ParsedIMU | null>(null);

  // Ref for the full baseline so classifySpinePosture always gets the latest
  const baselineRef = useRef<ClinicalBaseline | null>(null);

  // Partial capture during calibration — built up across the 3 steps
  const captureRef = useRef<{
    neutral:    { topPitch: number; topRoll: number; bottomPitch: number; bottomRoll: number } | null;
    maxForward: number | null; // degrees captured in step 2
    maxLateral: number | null; // degrees captured in step 3
  }>({ neutral: null, maxForward: null, maxLateral: null });

  // ── Load persisted baseline on mount ─────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(BASELINE_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved: ClinicalBaseline = JSON.parse(raw);
        baselineRef.current = saved;
        setClinicalBaseline(saved);
        // Mark all steps complete if baseline already exists
        setCalibration((prev) => ({
          ...prev,
          stepComplete: [true, true, true],
          isComplete: true,
        }));
      })
      .catch((e) => console.warn("[IMUContext] Failed to load baseline:", e));
  }, []);

  // ── BLE callbacks — registered once, live for the entire app lifetime ─────

  useEffect(() => {
    bleService.setCallbacks(
      // onData: fires ~10Hz per connected s'pot
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

        // Classify using the ClinicalBaseline if available.
        // classifySpinePosture applies the neutral offset internally
        // when a baseline is passed — no manual subtraction needed here.
        const result = classifySpinePosture(top, bottom, baselineRef.current);

        setPosture({
          state:       result.state as DeskPostureState,
          score:       result.pli,       // PLI replaces old linear score
          severity:    result.severity,
          label:       POSTURE_LABELS[result.state],
          description: POSTURE_CUES[result.state],
          pitchDiff:   result.pitchDiff,
          rollDiff:    result.rollDiff,
          romFraction: result.romFraction,
        });
      },

      // onStatus: connection state changes
      (slot, state) => {
        if (slot === "top") {
          setTopData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            topLatestRef.current = null;
            setPosture(null);
          }
        } else {
          setBottomData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            bottomLatestRef.current = null;
            setPosture(null);
          }
        }
      }
    );
    // No cleanup — this must live for the entire app lifetime
  }, []);

  // ── 3-position calibration ────────────────────────────────────────────────
  //
  // Each step: 3-second countdown → capture current s'pot angles → mark done.
  // All 3 steps must complete before the ClinicalBaseline is assembled and saved.
  //
  // Step 1 — neutral upright: captures the neutral offset angles
  // Step 2 — max forward lean: captures the sagittal ROM ceiling
  // Step 3 — max lateral lean: captures the lateral ROM ceiling

  const startCalibrationStep = useCallback((step: 1 | 2 | 3) => {
    setCalibration((prev) => ({
      ...prev,
      currentStep: step,
      countdown: 3,
    }));

    // Countdown ticks
    const t1 = setTimeout(() =>
      setCalibration((prev) => ({ ...prev, countdown: 2 })), 1000);
    const t2 = setTimeout(() =>
      setCalibration((prev) => ({ ...prev, countdown: 1 })), 2000);

    // Collect samples every 200ms during the 3-second hold window
    // then average them — much more robust than a single snapshot
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

      // Average all samples collected during the hold window
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

      // Mark step complete
      const newStepComplete = [
        step >= 1 ? true : false,
        step >= 2 ? (captureRef.current.maxForward !== null) : false,
        step >= 3 ? (captureRef.current.maxLateral !== null) : false,
      ];

      // Preserve previously completed steps
      setCalibration((prev) => {
        const updated = [...prev.stepComplete];
        updated[step - 1] = true;
        const allDone = updated.every(Boolean);

        // If all 3 steps done, assemble and persist the ClinicalBaseline
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
          countdown: 0,    // flash "done" state
          currentStep: allDone ? null : step,
        };
      });

      // Clear the countdown flash after 1.5s
      setTimeout(() =>
        setCalibration((prev) => ({ ...prev, countdown: null, currentStep: null })),
        1500
      );
    }, 3000);

    // Cleanup if component unmounts mid-countdown (shouldn't happen but be safe)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const resetCalibration = useCallback(() => {
    captureRef.current = { neutral: null, maxForward: null, maxLateral: null };
    baselineRef.current = null;
    setClinicalBaseline(null);
    setCalibration(defaultCalibration);
    AsyncStorage.removeItem(BASELINE_STORAGE_KEY)
      .catch((e) => console.warn("[IMUContext] Failed to clear baseline:", e));
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