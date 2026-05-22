/**
 * sensor-setup.tsx
 *
 * s'pot sensor management screen.
 * Accessible from the home screen via the chip icon next to ⚙.
 * NOT on the bottom tab bar.
 *
 * Changes in this version:
 *   1. Device identity — each s'pot is stored with a user-scoped display name
 *      ("username_top" / "username_bottom") generated at pairing time.
 *      The hardware name is preserved separately for reference.
 *   2. Picker filter — s'pots already connected to either slot are hidden
 *      from the picker so the user can't assign one device to two slots.
 *   3. Forget when saved — the Forget action is available even when the
 *      s'pot is not currently connected (as long as it's saved in storage).
 *   4. Updated UI copy to use s'up brand language (s'pot, lowercase).
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
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
import CalibrationModal from "../src/components/modals/CalibrationModal";

// ── Device identity types ─────────────────────────────────────────────────────

interface SavedDevice {
  /** BLE device ID — used for reconnection */
  id: string;
  /** Original hardware broadcast name (e.g. "WT901BLE67") */
  hardwareName: string;
  /**
   * User-scoped display name shown in the app UI.
   * Format: "{username}_top" or "{username}_bottom"
   * Generated at pairing time and stored in AsyncStorage.
   * The hardware name on the s'pot itself is NOT changed —
   * this is a software-side label only.
   */
  displayName: string;
}

// ── AsyncStorage key helpers ──────────────────────────────────────────────────

function storageKey(slot: SensorSlot, userId: string): string {
  return `spot_device_${slot}_${userId}`;
}

// ── Posture diagram (for calibration section) ─────────────────────────────────

function IdealPostureDiagram({ size = 140 }: { size?: number }) {
  const accent = colours.primary;
  return (
    <Svg width={size} height={size * 1.375} viewBox="0 0 160 220">
      <Line x1="30" y1="148" x2="90"  y2="148" stroke={accent} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Line x1="30" y1="90"  x2="30"  y2="148" stroke={accent} strokeWidth={4} strokeLinecap="round" opacity={0.3} />
      <Path d="M 80 68 L 80 148"   stroke={accent} strokeWidth={14} strokeLinecap="round" fill="none" />
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

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SensorSetupScreen() {
  const {
    topSensor,
    bottomSensor,
    discoveredDevices,
    isScanning,
    calibration,
    clinicalBaseline,
    scan,
    connect,
    disconnect,
    bothConnected,
  } = useIMUContext();

const { userId } = useAuth();

  const [assigningSlot,    setAssigningSlot]    = useState<SensorSlot | null>(null);
  const [showCalibModal,   setShowCalibModal]   = useState(false);
  const [savedTop,         setSavedTop]         = useState<SavedDevice | null>(null);
  const [savedBottom,      setSavedBottom]      = useState<SavedDevice | null>(null);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);

  // ── Load saved device identity from AsyncStorage on mount / userId change ──

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      try {
        const [topRaw, bottomRaw] = await Promise.all([
          AsyncStorage.getItem(storageKey("top",    userId)),
          AsyncStorage.getItem(storageKey("bottom", userId)),
        ]);
        if (topRaw)    setSavedTop(JSON.parse(topRaw));
        if (bottomRaw) setSavedBottom(JSON.parse(bottomRaw));
      } catch (e) {
        console.warn("[Setup] Failed to load saved s'pots:", e);
      }
    };
    load();
  }, [userId]);

  // ── Generate user-scoped display name ────────────────────────────────────
  // Uses the authenticated user's username/email prefix.
  // Result e.g.: "leipakshi_top", "leipakshi_bottom"

  function makeDisplayName(slot: SensorSlot): string {
    const base = (userId ?? "user")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 12); // keep it short
    return `${base}_${slot}`;
  }

  // ── Save device identity ──────────────────────────────────────────────────

  const saveDevice = async (slot: SensorSlot, device: Device) => {
    if (!userId) return;
    const saved: SavedDevice = {
      id:           device.id,
      hardwareName: device.name ?? device.id,
      displayName:  makeDisplayName(slot),
    };
    try {
      await AsyncStorage.setItem(storageKey(slot, userId), JSON.stringify(saved));
      if (slot === "top") setSavedTop(saved);
      else                setSavedBottom(saved);
    } catch (e) {
      console.warn("[Setup] Failed to save s'pot identity:", e);
    }
  };

  // ── Forget device ─────────────────────────────────────────────────────────
  // Available even when s'pot is not connected — works on saved state alone.

  const forgetDevice = (slot: SensorSlot) => {
    const saved = slot === "top" ? savedTop : savedBottom;
    const label = slot === "top" ? "top s'pot" : "bottom s'pot";

    Alert.alert(
      `forget ${label}?`,
      `this will remove your saved ${label}. you can re-pair it any time.`,
      [
        { text: "cancel", style: "cancel" },
        {
          text: "forget",
          style: "destructive",
          onPress: async () => {
            try {
              if (!userId) return;
              await AsyncStorage.removeItem(storageKey(slot, userId));
              if (slot === "top") setSavedTop(null);
              else                setSavedBottom(null);
              // Disconnect if currently connected
              const sensor = slot === "top" ? topSensor : bottomSensor;
              if (sensor.state.connected) await disconnect(slot);
            } catch (e) {
              console.warn("[Setup] Failed to forget s'pot:", e);
            }
          },
        },
      ]
    );
  };

  // ── Auto-connect ──────────────────────────────────────────────────────────
  // Scan → collect both saved devices → connect in parallel.

  const autoConnect = useCallback(async () => {
    if (!savedTop && !savedBottom) return;
    setIsAutoConnecting(true);

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

        const gotTop    = !savedTop    || foundDevices[savedTop.id];
        const gotBottom = !savedBottom || foundDevices[savedBottom.id];
        if (gotTop && gotBottom) {
          clearTimeout(scanTimeout);
          bleService.stopScan();
          resolve();
        }
      }, 8000);
    });

    // Connect sequentially — parallel BLE connections cancel each other
  let connected = 0;
  if (savedTop && foundDevices[savedTop.id]) {
    await connect(foundDevices[savedTop.id], "top");
    connected++;
    // Small pause between connections so the BLE stack settles
    await new Promise((r) => setTimeout(r, 500));
  }
  if (savedBottom && foundDevices[savedBottom.id]) {
    await connect(foundDevices[savedBottom.id], "bottom");
    connected++;
  }

  if (connected === 0) {
    Alert.alert(
      "s'pots not found",
      "make sure both s'pots are powered on and nearby, then try again."
    );
  }

      setIsAutoConnecting(false);
    }, [savedTop, savedBottom, connect]);

    // ── Manual connect ────────────────────────────────────────────────────────

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

  // ── Picker: filter out already-connected devices ──────────────────────────
  // A s'pot already assigned to a slot should not appear in the other slot's
  // picker — prevents accidentally assigning one device to two slots.

  const connectedIds = bleService.getConnectedDeviceIds();
  const availableDevices = discoveredDevices.filter(
    (d) => !connectedIds.includes(d.id)
  );

  // ── Sensor row component ──────────────────────────────────────────────────

  function SensorRow({
    slot,
    label,
    position,
  }: {
    slot: SensorSlot;
    label: string;
    position: string;
  }) {
    const sensor    = slot === "top" ? topSensor    : bottomSensor;
    const saved     = slot === "top" ? savedTop     : savedBottom;
    const connected = sensor.state.connected;

    // Display name priority:
    //   1. User-scoped display name from storage (e.g. "leipakshi_top")
    //   2. Live hardware name from BLE connection
    //   3. "not paired" fallback
    const displayName = saved?.displayName
      ?? sensor.state.deviceName
      ?? "not paired";

    const hasSavedOrConnected = connected || saved !== null;

    return (
      <View style={styles.sensorRow}>
        {/* Status icon */}
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
            <Text style={styles.sensorName} numberOfLines={1}>{displayName}</Text>
          </View>
          {saved && !connected && (
            <Text style={styles.savedHint}>saved — tap auto-connect to reconnect</Text>
          )}
          {/* Show hardware name as a sub-label when connected */}
          {connected && saved?.hardwareName && (
            <Text style={styles.hardwareName}>{saved.hardwareName}</Text>
          )}
        </View>

        {/* Actions */}
        <View style={styles.sensorActions}>
          {hasSavedOrConnected ? (
            // Forget available whenever saved, regardless of connection state
            <Pressable style={styles.actionBtnDanger} onPress={() => forgetDevice(slot)}>
              <Text style={styles.actionBtnDangerText}>forget</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.actionBtn} onPress={() => handleScan(slot)}>
              <Ionicons name="bluetooth-outline" size={14} color={colours.primary} />
              <Text style={styles.actionBtnText}>connect</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>

      {/* 3-position calibration modal */}
      <CalibrationModal
        visible={showCalibModal}
        onClose={() => setShowCalibModal(false)}
      />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colours.textPrimary} />
          </Pressable>
          <View>
            <Text style={styles.headerTitle}>s'pot setup</Text>
            <Text style={styles.headerSub}>manage your posture s'pots</Text>
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
              ? "both s'pots connected and active"
              : "connect both s'pots to start tracking"}
          </Text>
        </View>

        {/* s'pot rows */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>your s'pots</Text>
          <SensorRow slot="top"    label="top s'pot"    position="between your shoulder blades" />
          <View style={styles.divider} />
          <SensorRow slot="bottom" label="bottom s'pot" position="lower back, just above your waistband" />
        </View>

        {/* Auto-connect — only show when there are saved devices and not both connected */}
        {(savedTop || savedBottom) && !bothConnected && (
          <Pressable
            style={[styles.primaryBtn, isAutoConnecting && { opacity: 0.6 }]}
            onPress={autoConnect}
            disabled={isAutoConnecting}
          >
            {isAutoConnecting ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.primaryBtnText}>searching for your s'pots…</Text>
              </>
            ) : (
              <>
                <Ionicons name="wifi-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>auto-connect my s'pots</Text>
              </>
            )}
          </Pressable>
        )}

        {/* Device picker — filtered to hide already-connected devices */}
        {assigningSlot !== null && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {isScanning
                ? "scanning for s'pots…"
                : `select your ${assigningSlot} s'pot`}
            </Text>
            {isScanning && (
              <ActivityIndicator color={colours.primary} style={{ marginVertical: 12 }} />
            )}
            {availableDevices.length === 0 && !isScanning && (
              <Text style={styles.emptyText}>
                no s'pots found. make sure yours is powered on and nearby.
              </Text>
            )}
            {availableDevices.map((device: Device) => (
              <Pressable
                key={device.id}
                style={styles.deviceRow}
                onPress={() => handleConnect(device)}
              >
                <Ionicons name="hardware-chip-outline" size={18} color={colours.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceName}>{device.name ?? "unknown s'pot"}</Text>
                  <Text style={styles.deviceId}>{device.id}</Text>
                </View>
                <Ionicons name="add-circle-outline" size={20} color={colours.primary} />
              </Pressable>
            ))}
            <Pressable onPress={() => setAssigningSlot(null)} style={styles.cancelRow}>
              <Text style={styles.cancelText}>cancel</Text>
            </Pressable>
          </View>
        )}

        {/* Calibration section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>posture calibration</Text>
          <Text style={styles.cardDesc}>
            calibrate while sitting in your ideal posture. this sets your personal
            range of motion — all scores are measured relative to your body, not a population average.
          </Text>

          <View style={styles.calibrateContent}>
            <IdealPostureDiagram size={110} />
            <View style={styles.calibrateRight}>
              <View style={styles.checklistSmall}>
                {["feet flat", "back straight", "shoulders relaxed", "eyes level"].map((t) => (
                  <View key={t} style={styles.checkRowSmall}>
                    <Ionicons name="checkmark-circle" size={14} color="#4CAF50" />
                    <Text style={styles.checkTextSmall}>{t}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                style={[styles.calibrateBtn, !bothConnected && { opacity: 0.4 }]}
                onPress={() => bothConnected && setShowCalibModal(true)}
                disabled={!bothConnected}
              >
                <Ionicons
                  name="sync-outline"
                  size={16}
                  color={calibration.isComplete ? "#fff" : colours.primary}
                />
                <Text style={[
                  styles.calibrateBtnText,
                  calibration.isComplete && { color: "#fff" },
                ]}>
                  {calibration.isComplete ? "re-calibrate" : "calibrate now"}
                </Text>
              </Pressable>

              {calibration.isComplete && clinicalBaseline && (
                <Text style={styles.calibratedNote}>
                  ✓ calibrated {new Date(clinicalBaseline.capturedAt).toLocaleDateString()}
                </Text>
              )}
              {!bothConnected && (
                <Text style={styles.disabledNote}>connect both s'pots first</Text>
              )}
            </View>
          </View>
        </View>

        {/* Placement guide */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>placement guide</Text>
          {[
            {
              icon:  "arrow-up-circle-outline",
              title: "top s'pot",
              desc:  "between your shoulder blades (T4–T6 vertebrae). clip or tape vertically along the spine.",
            },
            {
              icon:  "arrow-down-circle-outline",
              title: "bottom s'pot",
              desc:  "lower back (L2–L4 vertebrae), just above the waistband. clip or tape vertically.",
            },
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

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#F5F3FF" },
  container: { paddingHorizontal: 16, paddingTop: 8 },

  header:    { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  backBtn:   { padding: 4 },
  headerTitle: { fontSize: 22, fontWeight: "700", color: colours.textPrimary },
  headerSub:   { fontSize: 13, color: colours.textSecondary },

  statusBanner:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, marginBottom: 16 },
  statusBannerText: { fontSize: 13, fontWeight: "600", flex: 1 },

  card: {
    backgroundColor: "#fff", borderRadius: 20, padding: 16, marginBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colours.textPrimary, marginBottom: 12 },
  cardDesc:  { fontSize: 13, color: colours.textSecondary, lineHeight: 19, marginBottom: 16 },

  sensorRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  sensorIcon:      { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sensorInfo:      { flex: 1 },
  sensorLabel:     { fontSize: 14, fontWeight: "700", color: colours.textPrimary },
  sensorPosition:  { fontSize: 11, color: colours.textSecondary, marginTop: 1 },
  sensorStatusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  statusDot:       { width: 7, height: 7, borderRadius: 4 },
  sensorName:      { fontSize: 12, color: colours.textSecondary },
  hardwareName:    { fontSize: 10, color: "#bbb", marginTop: 2 },
  savedHint:       { fontSize: 11, color: colours.primary, marginTop: 3 },
  sensorActions:   { alignItems: "flex-end", gap: 6 },

  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1.5, borderColor: colours.primary,
    borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12,
  },
  actionBtnText:       { fontSize: 12, fontWeight: "600", color: colours.primary },
  actionBtnDanger:     { borderWidth: 1.5, borderColor: "#F44336", borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
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
  calibrateBtnText: { fontSize: 13, fontWeight: "600", color: colours.primary },
  calibratedNote:   { fontSize: 11, color: "#4CAF50", fontWeight: "600" },
  disabledNote:     { fontSize: 11, color: colours.textSecondary },

  guideRow:   { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  guideTitle: { fontSize: 14, fontWeight: "600", color: colours.textPrimary, marginBottom: 2 },
  guideDesc:  { fontSize: 12, color: colours.textSecondary, lineHeight: 18 },
});