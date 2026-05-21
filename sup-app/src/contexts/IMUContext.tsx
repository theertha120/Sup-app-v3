/**
 * IMUContext.tsx
 * Global singleton context for BLE sensor state.
 * Wrap the whole app in <IMUProvider> so every screen
 * shares the same connection — sensors never disconnect
 * just because you navigate away.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { Device } from "react-native-ble-plx";
import { bleService, SensorSlot, SensorState } from "../services/BLEService";
import { parseIMUPacket, classifySpinePosture, ParsedIMU } from "../lib/imuParser";
import { DeskPostureState } from "../desk/mockDeskPostureData";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IMUSensorData {
  latest: ParsedIMU | null;
  state: SensorState;
}

export interface PostureResult {
  state: DeskPostureState;
  score: number;
  label: string;
  description: string;
  pitchDiff: number;
  rollDiff: number;
}

export interface CalibrationBaseline {
  topPitch: number;
  topRoll: number;
  bottomPitch: number;
  bottomRoll: number;
}

export interface IMUContextValue {
  topSensor: IMUSensorData;
  bottomSensor: IMUSensorData;
  posture: PostureResult | null;
  discoveredDevices: Device[];
  isScanning: boolean;
  calibrationCountdown: number | null;
  isCalibrated: boolean;
  bothConnected: boolean;
  scan: () => Promise<void>;
  connect: (device: Device, slot: SensorSlot) => Promise<void>;
  disconnect: (slot: SensorSlot) => Promise<void>;
  disconnectAll: () => Promise<void>;
  startCalibration: () => void;
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

const POSTURE_DESCRIPTIONS: Record<DeskPostureState, string> = {
  upright:      "Spine aligned, head level above shoulders.",
  forward_lean: "Head and shoulders pushed forward. Move back!",
  slouched:     "Back curved and rounded. Sit up straight.",
  tilted_left:  "Weight shifted to left side. Even out.",
  tilted_right: "Weight shifted to right side. Even out.",
  severe: "your spinal load is elevated. a small position change now significantly reduces disc pressure.",


};

const POSTURE_LABELS: Record<DeskPostureState, string> = {
  upright:      "Perfect Posture",
  forward_lean: "Forward Lean",
  slouched:     "Slouching",
  tilted_left:  "Leaning Left",
  tilted_right: "Leaning Right",
  severe: "high spinal load",
};

// ── Context ───────────────────────────────────────────────────────────────────

const IMUContext = createContext<IMUContextValue | null>(null);

export function IMUProvider({ children }: { children: React.ReactNode }) {
  const [topData,    setTopData]    = useState<IMUSensorData>(defaultSensorData);
  const [bottomData, setBottomData] = useState<IMUSensorData>(defaultSensorData);
  const [posture,    setPosture]    = useState<PostureResult | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<Device[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [calibrationCountdown, setCalibrationCountdown] = useState<number | null>(null);
  const [isCalibrated, setIsCalibrated] = useState(false);

  const topLatestRef    = useRef<ParsedIMU | null>(null);
  const bottomLatestRef = useRef<ParsedIMU | null>(null);
  const baselineRef     = useRef<CalibrationBaseline | null>(null);

  // ── BLE callbacks — registered once, never torn down ─────────────────────

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

        if (top && bottom) {
          const base = baselineRef.current;
          const adjustedTop = base ? {
            ...top,
            angle: {
              pitch: top.angle.pitch - base.topPitch,
              roll:  top.angle.roll  - base.topRoll,
              yaw:   top.angle.yaw,
            },
          } : top;
          const adjustedBottom = base ? {
            ...bottom,
            angle: {
              pitch: bottom.angle.pitch - base.bottomPitch,
              roll:  bottom.angle.roll  - base.bottomRoll,
              yaw:   bottom.angle.yaw,
            },
          } : bottom;

          const result = classifySpinePosture(adjustedTop, adjustedBottom);
          setPosture({
            state: result.state,
            score: result.pli,
            label: POSTURE_LABELS[result.state],
            description: POSTURE_DESCRIPTIONS[result.state],
            pitchDiff: result.pitchDiff,
            rollDiff: result.rollDiff,
          });
        }
      },

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
    // No cleanup — we want this to live for the entire app lifetime
  }, []);

  // ── Calibration ───────────────────────────────────────────────────────────

  const startCalibration = useCallback(() => {
    if (calibrationCountdown !== null) return;

    setCalibrationCountdown(3);
    setTimeout(() => setCalibrationCountdown(2), 1000);
    setTimeout(() => setCalibrationCountdown(1), 2000);
    setTimeout(() => {
      const top    = topLatestRef.current;
      const bottom = bottomLatestRef.current;
      if (top && bottom) {
        baselineRef.current = {
          topPitch:    top.angle.pitch,
          topRoll:     top.angle.roll,
          bottomPitch: bottom.angle.pitch,
          bottomRoll:  bottom.angle.roll,
        };
        setIsCalibrated(true);
      }
      setCalibrationCountdown(0);
      setTimeout(() => setCalibrationCountdown(null), 1500);
    }, 3000);
  }, [calibrationCountdown]);

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
      discoveredDevices,
      isScanning,
      calibrationCountdown,
      isCalibrated,
      bothConnected,
      scan,
      connect,
      disconnect,
      disconnectAll,
      startCalibration,
    }}>
      {children}
    </IMUContext.Provider>
  );
}

// ── Hook — use this everywhere instead of useIMU() ────────────────────────────

export function useIMUContext(): IMUContextValue {
  const ctx = useContext(IMUContext);
  if (!ctx) throw new Error("useIMUContext must be used inside <IMUProvider>");
  return ctx;
}