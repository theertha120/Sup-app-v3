/**
 * sensor-setup.tsx
 * Sensor management screen — connect, rename, calibrate, and
 * save device assignments for this user's S'pot sensors.
 *
 * Accessible from the home screen via the sensor icon next to ⚙.
 * NOT on the bottom tab bar.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Path, Line } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colours } from "../theme/colours";
import { useIMUContext } from "../src/contexts/IMUContext";
import { bleService, SensorSlot } from "../src/services/BLEService";
import { Device } from "react-native-ble-plx";
import { useAuth } from "../src/contexts/AuthContext";

// AsyncStorage keys are now per-authenticated-user; computed at runtime.

interface SavedDevice {
  id: string;
  name: string;
}

// ── Ideal posture diagram (reused from desk.tsx) ──────────────────────────────
function IdealPostureDiagram({ size = 140 }: { size?: number }) {
  const accent = colours.primary;
  const scale  = size / 160;
  return (
    <Svg width={size} height={size * 1.375} viewBox="0 0 160 220">
      <Line x1="30" y1="148" x2="90" y2="148" stroke={accent} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Line x1="30" y1="90"  x2="30" y2="148" stroke={accent} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Path d="M 80 68 L 80 148" stroke={accent} strokeWidth={14} strokeLinecap="round" fill="none" />
      <Path d="M 80 148 L 130 155" stroke={accent} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 130 155 L 130 210" stroke={accent} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 130 210 L 148 210" stroke={accent} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Path d="M 80 76 L 60 110"   stroke={accent} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 60 110 L 95 145"  stroke={accent} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M 80 50 L 80 68"    stroke={accent} strokeWidth={8}  strokeLinecap="round" fill="none" />
      <Circle cx="80" cy="32" r="20" fill="white" stroke={accent} strokeWidth={3.5} />
      <Circle cx="89" cy="34" r="2.5" fill={accent} />
      <Line x1="100" y1="80"  x2="115" y2="80"  stroke="#4CAF50" strokeWidth={2} strokeLinecap="round" />
      <Line x1="100" y1="108" x2="115" y2="108" stroke="#4CAF50" strokeWidth={2} strokeLinecap="round" />
      <Line x1="100" y1="136" x2="115" y2="136" stroke="#4CAF50" strokeWidth={2} strokeLinecap="round" />
      <Line x1="115" y1="80"  x2="115" y2="136" stroke="#4CAF50" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}

// ── Calibration modal ─────────────────────────────────────────────────────────
function CalibrationModal({
  visible,
  countdown,
  onStart,
  onClose,
}: {
  visible: boolean;
  countdown: number | null;
  onStart: () => void;
  onClose: () => void;
}) {
  const isRunning = countdown !== null && countdown > 0;
  const isDone    = countdown === 0;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={modal.overlay}>
        <View style={modal.card}>
          <Text style={modal.title}>Calibrate Posture</Text>
          <Text style={modal.subtitle}>
            Sit in your ideal upright posture, then tap Start.
            Hold still for 3 seconds while we record your baseline.
          </Text>

          <View style={modal.figureWrap}>
            <IdealPostureDiagram size={130} />
          </View>

          <View style={modal.checklist}>
            {[
              "Feet flat on the floor",
              "Back straight, shoulders relaxed",
              "Eyes level with screen",
              "Head directly above shoulders",
            ].map((item) => (
              <View key={item} style={modal.checkRow}>
                <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
                <Text style={modal.checkText}>{item}</Text>
              </View>
            ))}
          </View>

          {isDone ? (
            <View style={modal.doneRow}>
              <Ionicons name="checkmark-circle" size={32} color="#4CAF50" />
              <Text style={modal.doneText}>Calibration saved!</Text>
            </View>
          ) : isRunning ? (
            <View style={modal.countdownRow}>
              <Text style={modal.countdownNumber}>{countdown}</Text>
              <Text style={modal.countdownLabel}>Hold still…</Text>
            </View>
          ) : (
            <View style={modal.buttonRow}>
              <Pressable style={modal.cancelBtn} onPress={onClose}>
                <Text style={modal.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={modal.startBtn} onPress={onStart}>
                <Text style={modal.startText}>Start calibration</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SensorSetupScreen() {
  const {
    topSensor,
    bottomSensor,
    discoveredDevices,
    isScanning,
    calibrationCountdown,
    isCalibrated,
    scan,
    connect,
    disconnect,
    startCalibration,
    bothConnected,
} = useIMUContext();

  const [assigningSlot, setAssigningSlot]   = useState<SensorSlot | null>(null);
  const [showCalibModal, setShowCalibModal] = useState(false);
  const [savedTop,    setSavedTop]    = useState<SavedDevice | null>(null);
  const [savedBottom, setSavedBottom] = useState<SavedDevice | null>(null);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);

  const { userId } = useAuth();

  // ── Load saved device IDs when authenticated user available ───────────────
  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      try {
        const topKey = `spot_device_top_${userId}`;
        const bottomKey = `spot_device_bottom_${userId}`;
        const [topRaw, bottomRaw] = await Promise.all([
          AsyncStorage.getItem(topKey),
          AsyncStorage.getItem(bottomKey),
        ]);
        if (topRaw)    setSavedTop(JSON.parse(topRaw));
        if (bottomRaw) setSavedBottom(JSON.parse(bottomRaw));
      } catch (e) {
        console.warn("[Setup] Failed to load saved devices", e);
      }
    };
    load();
  }, [userId]);

  // Auto-close calibration modal after done
  useEffect(() => {
    if (calibrationCountdown === 0) {
      setTimeout(() => setShowCalibModal(false), 1500);
    }
  }, [calibrationCountdown]);

  // ── Save device assignment ──────────────────────────────────────────────────
  const saveDevice = async (slot: SensorSlot, device: Device) => {
    const saved: SavedDevice = { id: device.id, name: device.name ?? device.id };
    try {
      if (!userId) throw new Error("Not authenticated");
      const key = slot === "top" ? `spot_device_top_${userId}` : `spot_device_bottom_${userId}`;
      await AsyncStorage.setItem(key, JSON.stringify(saved));
      if (slot === "top")    setSavedTop(saved);
      else                   setSavedBottom(saved);
    } catch (e) {
      console.warn("[Setup] Failed to save device", e);
    }
  };

  // ── Forget a saved device ───────────────────────────────────────────────────
  const forgetDevice = async (slot: SensorSlot) => {
    Alert.alert(
      "Forget sensor?",
      `This will remove the saved ${slot === "top" ? "upper" : "lower"} back sensor. You can re-assign it any time.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
            onPress: async () => {
            try {
              if (!userId) throw new Error("Not authenticated");
              const key = slot === "top" ? `spot_device_top_${userId}` : `spot_device_bottom_${userId}`;
              await AsyncStorage.removeItem(key);
              if (slot === "top") setSavedTop(null);
              else setSavedBottom(null);
              await disconnect(slot);
            } catch (e) {
              console.warn("[Setup] Failed to forget device", e);
            }
          },
        },
      ]
    );
  };

  // ── Auto-connect to saved devices ──────────────────────────────────────────
  const autoConnect = useCallback(async () => {
  if (!savedTop && !savedBottom) return;
  setIsAutoConnecting(true);

  // Step 1: collect all matching devices during the scan window
  const foundDevices: Record<string, Device> = {};

  await new Promise<void>((resolve) => {
    const scanTimeout = setTimeout(() => {
      bleService.stopScan();
      resolve();
    }, 8000);

    bleService.scan((device) => {
      const isTop    = savedTop    && device.id === savedTop.id;
      const isBottom = savedBottom && device.id === savedBottom.id;
      if (!isTop && !isBottom) return;

      foundDevices[device.id] = device;

      // If we already found all we need, stop scan early
      const gotTop    = !savedTop    || foundDevices[savedTop.id];
      const gotBottom = !savedBottom || foundDevices[savedBottom.id];
      if (gotTop && gotBottom) {
        clearTimeout(scanTimeout);
        bleService.stopScan();
        resolve();
      }
    }, 8000);
  });

  // Step 2: connect to all found devices in parallel
  const connectPromises: Promise<void>[] = [];

  if (savedTop && foundDevices[savedTop.id]) {
    connectPromises.push(connect(foundDevices[savedTop.id], "top"));
  }
  if (savedBottom && foundDevices[savedBottom.id]) {
    connectPromises.push(connect(foundDevices[savedBottom.id], "bottom"));
  }

  if (connectPromises.length === 0) {
    Alert.alert(
      "Sensors not found",
      "Make sure both sensors are powered on and nearby."
    );
  } else {
    await Promise.all(connectPromises);
  }

  setIsAutoConnecting(false);
}, [savedTop, savedBottom, connect]);

  // ── Manual connect flow ─────────────────────────────────────────────────────
  const handleScan = async (slot: SensorSlot) => {
    setAssigningSlot(slot);
    await scan();
  };

  const handleConnect = async (device: Device) => {
    if (!assigningSlot) return;
    await connect(device, assigningSlot);
    await saveDevice(assigningSlot, device);
    setAssigningSlot(null);
  };

  // ── Sensor row ──────────────────────────────────────────────────────────────
  function SensorRow({
    slot,
    label,
    position,
  }: {
    slot: SensorSlot;
    label: string;
    position: string;
  }) {
    const sensor    = slot === "top" ? topSensor : bottomSensor;
    const saved     = slot === "top" ? savedTop  : savedBottom;
    const connected = sensor.state.connected;
    const name      = sensor.state.deviceName ?? saved?.name ?? "Not connected";

    return (
      <View style={styles.sensorRow}>
        {/* Status indicator */}
        <View style={[styles.sensorIcon, { backgroundColor: connected ? "#E8F5E9" : "#F5F5F5" }]}>
          <Ionicons
            name="hardware-chip-outline"
            size={24}
            color={connected ? "#4CAF50" : "#999"}
          />
        </View>

        {/* Info */}
        <View style={styles.sensorInfo}>
          <Text style={styles.sensorLabel}>{label}</Text>
          <Text style={styles.sensorPosition}>{position}</Text>
          <View style={styles.sensorStatusRow}>
            <View style={[styles.statusDot, { backgroundColor: connected ? "#4CAF50" : "#ccc" }]} />
            <Text style={styles.sensorName} numberOfLines={1}>{name}</Text>
          </View>
          {saved && !connected && (
            <Text style={styles.savedHint}>Saved — tap Auto-connect to reconnect</Text>
          )}
        </View>

        {/* Actions */}
        <View style={styles.sensorActions}>
          {connected ? (
            <Pressable
              style={styles.actionBtnDanger}
              onPress={() => forgetDevice(slot)}
            >
              <Text style={styles.actionBtnDangerText}>Forget</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.actionBtn}
              onPress={() => handleScan(slot)}
            >
              <Ionicons name="bluetooth-outline" size={14} color={colours.primary} />
              <Text style={styles.actionBtnText}>Connect</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Calibration modal */}
        <CalibrationModal
          visible={showCalibModal}
          countdown={calibrationCountdown}
          onStart={startCalibration}
          onClose={() => setShowCalibModal(false)}
        />

        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colours.textPrimary} />
          </Pressable>
          <View>
            <Text style={styles.headerTitle}>S'pot Sensors</Text>
            <Text style={styles.headerSub}>Manage your posture sensors</Text>
          </View>
        </View>

        {/* Connection status banner */}
        <View style={[
          styles.statusBanner,
          { backgroundColor: bothConnected ? "#E8F5E9" : "#FFF8E1" }
        ]}>
          <Ionicons
            name={bothConnected ? "checkmark-circle" : "warning-outline"}
            size={20}
            color={bothConnected ? "#4CAF50" : "#FF9800"}
          />
          <Text style={[
            styles.statusBannerText,
            { color: bothConnected ? "#2E7D32" : "#E65100" }
          ]}>
            {bothConnected
              ? "Both sensors connected and active"
              : "Connect both sensors to start tracking"}
          </Text>
        </View>

        {/* Sensor rows */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your sensors</Text>
          <SensorRow slot="top"    label="Upper back sensor" position="Attach between shoulder blades" />
          <View style={styles.divider} />
          <SensorRow slot="bottom" label="Lower back sensor" position="Attach at lumbar (lower back)" />
        </View>

        {/* Auto-connect button */}
        {(savedTop || savedBottom) && !bothConnected && (
          <Pressable
            style={[styles.primaryBtn, isAutoConnecting && { opacity: 0.6 }]}
            onPress={autoConnect}
            disabled={isAutoConnecting}
          >
            {isAutoConnecting ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.primaryBtnText}>Searching for your sensors…</Text>
              </>
            ) : (
              <>
                <Ionicons name="wifi-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Auto-connect my sensors</Text>
              </>
            )}
          </Pressable>
        )}

        {/* Device picker */}
        {assigningSlot !== null && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {isScanning
                ? "Scanning for sensors…"
                : `Select ${assigningSlot === "top" ? "upper" : "lower"} back sensor`}
            </Text>
            {isScanning && <ActivityIndicator color={colours.primary} style={{ marginVertical: 12 }} />}
            {discoveredDevices.length === 0 && !isScanning && (
              <Text style={styles.emptyText}>No sensors found. Make sure sensor is powered on.</Text>
            )}
            {discoveredDevices.map((device: Device) => (
              <Pressable
                key={device.id}
                style={styles.deviceRow}
                onPress={() => handleConnect(device)}
              >
                <Ionicons name="hardware-chip-outline" size={18} color={colours.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceName}>{device.name ?? "Unknown"}</Text>
                  <Text style={styles.deviceId}>{device.id}</Text>
                </View>
                <Ionicons name="add-circle-outline" size={20} color={colours.primary} />
              </Pressable>
            ))}
            <Pressable onPress={() => setAssigningSlot(null)} style={styles.cancelRow}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {/* Calibration section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Posture calibration</Text>
          <Text style={styles.cardDesc}>
            Calibrate while sitting in your ideal posture. This sets your personal
            baseline — all scores are measured relative to this position.
          </Text>

          <View style={styles.calibrateContent}>
            <IdealPostureDiagram size={110} />
            <View style={styles.calibrateRight}>
              <View style={styles.checklistSmall}>
                {["Feet flat", "Back straight", "Shoulders relaxed", "Eyes level"].map((t) => (
                  <View key={t} style={styles.checkRowSmall}>
                    <Ionicons name="checkmark-circle" size={14} color="#4CAF50" />
                    <Text style={styles.checkTextSmall}>{t}</Text>
                  </View>
                ))}
              </View>
              <Pressable
                style={[
                  styles.calibrateBtn,
                  !bothConnected && { opacity: 0.4 },
                ]}
                onPress={() => bothConnected && setShowCalibModal(true)}
                disabled={!bothConnected}
              >
                <Ionicons name="sync-outline" size={16} color={isCalibrated ? "#fff" : colours.primary} />
                <Text style={[
                  styles.calibrateBtnText,
                  isCalibrated && { color: "#fff" },
                ]}>
                  {isCalibrated ? "Re-calibrate" : "Calibrate now"}
                </Text>
              </Pressable>
              {isCalibrated && (
                <Text style={styles.calibratedNote}>✓ Baseline saved</Text>
              )}
              {!bothConnected && (
                <Text style={styles.disabledNote}>Connect both sensors first</Text>
              )}
            </View>
          </View>
        </View>

        {/* Placement guide */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Placement guide</Text>
          {[
            { icon: "arrow-up-circle-outline", title: "Upper sensor", desc: "Between your shoulder blades (T4–T6 vertebrae). Clip or tape vertically along the spine." },
            { icon: "arrow-down-circle-outline", title: "Lower sensor", desc: "Lower back (L2–L4 vertebrae), just above the waistband. Clip or tape vertically." },
          ].map((item) => (
            <View key={item.title} style={styles.guideRow}>
              <Ionicons name={item.icon as any} size={22} color={colours.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.guideTitle}>{item.title}</Text>
                <Text style={styles.guideDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Modal styles ──────────────────────────────────────────────────────────────
const modal = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  card: {
    backgroundColor: "#fff", borderRadius: 24,
    padding: 24, width: "100%", alignItems: "center",
  },
  title:    { fontSize: 20, fontWeight: "700", color: colours.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 13, color: colours.textSecondary, textAlign: "center", lineHeight: 19, marginBottom: 16 },
  figureWrap:  { marginBottom: 16, alignItems: "center" },
  checklist:   { alignSelf: "stretch", marginBottom: 24, gap: 8 },
  checkRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  checkText:   { fontSize: 13, color: colours.textPrimary },
  countdownRow:   { alignItems: "center", marginBottom: 8 },
  countdownNumber: { fontSize: 72, fontWeight: "800", color: colours.primary, lineHeight: 80 },
  countdownLabel:  { fontSize: 14, color: colours.textSecondary, marginTop: 4 },
  doneRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  doneText: { fontSize: 18, fontWeight: "700", color: "#4CAF50" },
  buttonRow: { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 30,
    borderWidth: 1.5, borderColor: colours.border, alignItems: "center",
  },
  cancelText: { fontSize: 14, fontWeight: "600", color: colours.textSecondary },
  startBtn:   { flex: 2, paddingVertical: 14, borderRadius: 30, backgroundColor: colours.primary, alignItems: "center" },
  startText:  { fontSize: 14, fontWeight: "700", color: "#fff" },
});

// ── Screen styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#F5F3FF" },
  container: { paddingHorizontal: 16, paddingTop: 8 },

  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontWeight: "700", color: colours.textPrimary },
  headerSub:   { fontSize: 13, color: colours.textSecondary },

  statusBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 12, marginBottom: 16,
  },
  statusBannerText: { fontSize: 13, fontWeight: "600", flex: 1 },

  card: {
    backgroundColor: "#fff", borderRadius: 20,
    padding: 16, marginBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colours.textPrimary, marginBottom: 12 },
  cardDesc:  { fontSize: 13, color: colours.textSecondary, lineHeight: 19, marginBottom: 16 },

  sensorRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  sensorIcon:   { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sensorInfo:   { flex: 1 },
  sensorLabel:  { fontSize: 14, fontWeight: "700", color: colours.textPrimary },
  sensorPosition: { fontSize: 11, color: colours.textSecondary, marginTop: 1 },
  sensorStatusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  statusDot:    { width: 7, height: 7, borderRadius: 4 },
  sensorName:   { fontSize: 12, color: colours.textSecondary },
  savedHint:    { fontSize: 11, color: colours.primary, marginTop: 3 },
  sensorActions: { alignItems: "flex-end", gap: 6 },

  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1.5, borderColor: colours.primary,
    borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12,
  },
  actionBtnText: { fontSize: 12, fontWeight: "600", color: colours.primary },
  actionBtnDanger: {
    borderWidth: 1.5, borderColor: "#F44336",
    borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12,
  },
  actionBtnDangerText: { fontSize: 12, fontWeight: "600", color: "#F44336" },

  divider: { height: 1, backgroundColor: "#F0F0F0", marginVertical: 8 },

  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: colours.primary,
    borderRadius: 30, paddingVertical: 14, marginBottom: 16,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },

  deviceRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
  },
  deviceName: { fontSize: 14, fontWeight: "600", color: colours.textPrimary },
  deviceId:   { fontSize: 11, color: colours.textSecondary, marginTop: 2 },
  emptyText:  { fontSize: 13, color: colours.textSecondary, marginVertical: 12, textAlign: "center" },
  cancelRow:  { alignItems: "center", marginTop: 12 },
  cancelText: { fontSize: 14, color: colours.textSecondary },

  calibrateContent: { flexDirection: "row", alignItems: "center", gap: 16 },
  calibrateRight:   { flex: 1, gap: 12 },
  checklistSmall:   { gap: 6 },
  checkRowSmall:    { flexDirection: "row", alignItems: "center", gap: 6 },
  checkTextSmall:   { fontSize: 12, color: colours.textPrimary },
  calibrateBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1.5, borderColor: colours.primary,
    borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14,
    justifyContent: "center",
  },
  calibrateBtnText:  { fontSize: 13, fontWeight: "600", color: colours.primary },
  calibratedNote:    { fontSize: 11, color: "#4CAF50", fontWeight: "600" },
  disabledNote:      { fontSize: 11, color: colours.textSecondary },

  guideRow:   { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  guideTitle: { fontSize: 14, fontWeight: "600", color: colours.textPrimary, marginBottom: 2 },
  guideDesc:  { fontSize: 12, color: colours.textSecondary, lineHeight: 18 },
});