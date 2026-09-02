/**
 * sensor-setup.tsx
 *
 * s'pot sensor management screen.
 * Accessible from the home screen via the chip icon next to ⚙.
 * NOT on the bottom tab bar.
 *
 * Updates in this version:
 *   1. Calibration updated to 5-position protocol (neutral, forward, backward, right, left).
 *   2. ClinicalBaseline summary shows all 4 ROM ceilings.
 *   3. startCalibrationStep now typed as 1|2|3|4|5.
 *   4. All existing identity management, picker filter, and forget logic preserved.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  Pressable, ActivityIndicator, Alert, Image,
} from "react-native";
import { useFonts } from "expo-font";
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
import QRPairModal from "../src/components/modals/QRPairModal";
import { useTutorial } from "../src/contexts/TutorialContext";
import { parseSpotName } from "../src/lib/spotNaming";

// ── Device identity types ─────────────────────────────────────────────────────

interface SavedDevice {
  /** BLE device ID — used for reconnection */
  id: string;
  /**
   * Advertised BLE local name at pairing time (e.g. "S07-TOP" for a
   * pilot-provisioned unit, or a factory-default "WT901BLE.." name).
   * The app itself never renames a sensor — this is whatever it was already
   * broadcasting, which for pilot units was set ahead of time via
   * WitMotion's config tool (see scripts/witmotion_pairing_tool.py).
   */
  hardwareName: string;
  /**
   * User-scoped display name shown in the app UI.
   * Format: "{userId}_top" or "{userId}_bottom"
   */
  displayName: string;
}

// ── AsyncStorage key helpers ──────────────────────────────────────────────────

function storageKey(slot: SensorSlot, userId: string): string {
  return `spot_device_${slot}_${userId}`;
}

// ── Posture diagram ───────────────────────────────────────────────────────────

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
    topSensor, bottomSensor,
    discoveredDevices, isScanning,
    calibration, clinicalBaseline,
    scan, connect, disconnect,
    bothConnected,
  } = useIMUContext();

  const { userId } = useAuth();
  const { tutorialStep, setTutorialStep } = useTutorial();

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../assets/fonts/Agrandir-Regular.otf"),
  });

  const [assigningSlot,    setAssigningSlot]    = useState<SensorSlot | null>(null);
  const [showCalibModal,   setShowCalibModal]   = useState(false);
  const [showQRPairModal,  setShowQRPairModal]  = useState(false);
  const [savedTop,         setSavedTop]         = useState<SavedDevice | null>(null);
  const [savedBottom,      setSavedBottom]      = useState<SavedDevice | null>(null);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);

  // ── Tutorial: once both s'pots connect, move on to calibration ───────────

  useEffect(() => {
    if (tutorialStep === "connect-tip" && bothConnected) {
      setTutorialStep("calibrate-tip");
    }
  }, [tutorialStep, bothConnected, setTutorialStep]);

  // ── Tutorial: once calibration actually completes, move on to desk mode ──
  //
  // Only reacts to a fresh false→true flip while this tip is showing — if
  // calibration.isComplete was already true when we arrived here (e.g.
  // re-running the tutorial after calibrating before), this must NOT skip
  // the tip; it should still display, letting the user re-calibrate or skip.

  const prevCalibrationCompleteRef = useRef(calibration.isComplete);

  useEffect(() => {
    const wasComplete = prevCalibrationCompleteRef.current;
    prevCalibrationCompleteRef.current = calibration.isComplete;

    if (tutorialStep === "calibrate-tip" && calibration.isComplete && !wasComplete) {
      setTutorialStep("figure-tip");
      router.push("/desk" as any);
    }
  }, [tutorialStep, calibration.isComplete, setTutorialStep]);

  // ── Load saved device identity ────────────────────────────────────────────

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

  // ── Display name ──────────────────────────────────────────────────────────

  function makeDisplayName(slot: SensorSlot): string {
    const base = (userId ?? "user")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 12);
    return `${base}_${slot}`;
  }

  // ── Save device ───────────────────────────────────────────────────────────

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

  const forgetDevice = (slot: SensorSlot) => {
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

    // Sequential connection — parallel BLE connections cancel each other
    let connected = 0;
    if (savedTop && foundDevices[savedTop.id]) {
      await connect(foundDevices[savedTop.id], "top");
      connected++;
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

  // Filter already-connected devices from picker
  const connectedIds     = bleService.getConnectedDeviceIds();
  const availableDevices = discoveredDevices.filter((d) => !connectedIds.includes(d.id));

  const calibrationTipText = !bothConnected
    ? "don't have your s'pots right now? you can skip for now and calibrate later when both sensors are connected."
    : calibration.isComplete
      ? "you're already calibrated. you can still re-calibrate anytime later."
      : "this is a one-time calibration that personalises how we determine your posture states, in real time.";

  // ── Sensor row ────────────────────────────────────────────────────────────

  function SensorRow({ slot, label, position }: {
    slot: SensorSlot; label: string; position: string;
  }) {
    const sensor    = slot === "top" ? topSensor    : bottomSensor;
    const saved     = slot === "top" ? savedTop     : savedBottom;
    const connected = sensor.state.connected;

    // Prefer the s'pot's own kit code (parsed from its advertised name, e.g.
    // "s'pot_top_0048.05-08" → "48_top") over the userId-based displayName —
    // that's still what's saved to AsyncStorage/backend, just not what's
    // shown on screen. Falls back to the old displayName for any sensor
    // whose name doesn't match the s'pot_<role>_<code>.<batch>-<n> convention
    // (e.g. a factory-default unit that hasn't been renamed yet).
    const rawHardwareName = saved?.hardwareName ?? sensor.state.deviceName ?? null;
    const parsedSpot = rawHardwareName ? parseSpotName(rawHardwareName) : null;
    const displayName = parsedSpot
      ? `${parseInt(parsedSpot.code, 10)}_${parsedSpot.role}`
      : saved?.displayName
        ?? sensor.state.deviceName
        ?? "not paired";

    const hasSavedOrConnected = connected || saved !== null;

    return (
      <View style={styles.sensorRow}>
        <View style={[styles.sensorIcon, { backgroundColor: connected ? "#E8F5E9" : "#F5F5F5" }]}>
          <Ionicons name="hardware-chip-outline" size={24} color={connected ? "#4CAF50" : "#999"} />
        </View>

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
          {connected && saved?.hardwareName && (
            <Text style={styles.hardwareName}>{saved.hardwareName}</Text>
          )}
        </View>

        <View style={styles.sensorActions}>
          {hasSavedOrConnected ? (
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

  if (!fontsLoaded) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <CalibrationModal visible={showCalibModal} onClose={() => setShowCalibModal(false)} />
      <QRPairModal
        visible={showQRPairModal}
        onClose={() => setShowQRPairModal(false)}
        onPaired={async (slot, device) => {
          await connect(device, slot);
          await saveDevice(slot, device);
        }}
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

        {/* QR pairing — primary path for new s'pots */}
        {!bothConnected && (
          <Pressable style={styles.qrPairBtn} onPress={() => setShowQRPairModal(true)}>
            <Ionicons name="qr-code-outline" size={18} color="#fff" />
            <Text style={styles.qrPairBtnText}>s'can to pair</Text>
          </Pressable>
        )}

        {/* s'pot rows */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>your s'pots</Text>
          <SensorRow slot="top"    label="top s'pot"    position="between your shoulder blades" />
          <View style={styles.divider} />
          <SensorRow slot="bottom" label="bottom s'pot" position="lower back, just above your waistband" />

          {tutorialStep === "connect-tip" && (
            <View style={[styles.tutorialTip, { marginTop: 12, marginBottom: 0 }]}>
              <Image
                source={require("../assets/images/mascot.png")}
                style={styles.tutorialTipMascot}
                resizeMode="contain"
              />
              <View style={styles.tutorialTipTextWrap}>
                <Text style={styles.tutorialTipText}>
                  connect both top and bottom s'pots. once they're both connected, a session starts automatically.
                </Text>
                <Pressable
                  onPress={() => {
                    setTutorialStep("stats-tip");
                    router.replace("/(tabs)/stats" as any);
                  }}
                >
                  <Text style={styles.tutorialTipNext}>skip for now and go to stats</Text>
                </Pressable>
              </View>
            </View>
          )}
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

        {/* Device picker */}
        {assigningSlot !== null && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {isScanning ? "scanning for s'pots…" : `select your ${assigningSlot} s'pot`}
            </Text>
            {isScanning && <ActivityIndicator color={colours.primary} style={{ marginVertical: 12 }} />}
            {availableDevices.length === 0 && !isScanning && (
              <Text style={styles.emptyText}>
                no s'pots found. make sure yours is powered on and nearby.
              </Text>
            )}
            {availableDevices.map((device: Device) => (
              <Pressable key={device.id} style={styles.deviceRow} onPress={() => handleConnect(device)}>
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

        {tutorialStep === "calibrate-tip" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../assets/images/mascot.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>{calibrationTipText}</Text>
              <Pressable
                onPress={() => {
                  setTutorialStep("figure-tip");
                  router.push("/desk" as any);
                }}
              >
                <Text style={styles.tutorialTipNext}>skip and do calibration later</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Calibration section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>posture calibration</Text>
          <Text style={styles.cardDesc}>
            5-position calibration captures your personal range of motion in all directions.
            scores are relative to your body, not a population average.
          </Text>

          <View style={styles.calibrateContent}>
            <IdealPostureDiagram size={110} />
            <View style={styles.calibrateRight}>
              <View style={styles.checklistSmall}>
                {["upright neutral","max forward lean","max backward lean","max right lean","max left lean"].map((t, i) => (
                  <View key={t} style={styles.checkRowSmall}>
                    <Ionicons
                      name={calibration.stepComplete[i] ? "checkmark-circle" : "ellipse-outline"}
                      size={14}
                      color={calibration.stepComplete[i] ? "#4CAF50" : "#ccc"}
                    />
                    <Text style={styles.checkTextSmall}>{t}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                style={[
                  styles.calibrateBtn,
                  !bothConnected && { opacity: 0.4 },
                  calibration.isComplete && { backgroundColor: colours.primary, borderColor: colours.primary },
                ]}
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

          {/* ROM summary — shown once calibrated */}
          {calibration.isComplete && clinicalBaseline && (
            <View style={styles.romSummary}>
              {[
                { label: "forward",  value: clinicalBaseline.maxForwardDeg.toFixed(1)  },
                { label: "backward", value: clinicalBaseline.maxBackwardDeg.toFixed(1) },
                { label: "right",    value: clinicalBaseline.maxRightDeg.toFixed(1)    },
                { label: "left",     value: clinicalBaseline.maxLeftDeg.toFixed(1)     },
              ].map((row) => (
                <View key={row.label} style={styles.romRow}>
                  <Text style={styles.romLabel}>{row.label}</Text>
                  <Text style={styles.romValue}>{row.value}°</Text>
                </View>
              ))}
            </View>
          )}
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

  header:      { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 22, color: colours.textPrimary, fontFamily: "Agrandir-GrandHeavy" },
  headerSub:   { fontSize: 13, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },

  statusBanner:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, marginBottom: 16 },
  statusBannerText: { fontSize: 13, fontWeight: "600", flex: 1, fontFamily: "Agrandir-Regular" },

  tutorialTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
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
    fontSize: 13,
    color: "#FFFFFF",
    lineHeight: 18,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },

  disconnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#E57373",
    backgroundColor: "#FFF5F5",
    borderRadius: 18,
    paddingVertical: 12,
    marginBottom: 16,
  },
  disconnectBtnText: { fontSize: 14, fontWeight: "700", color: "#D32F2F", fontFamily: "Agrandir-Regular" },

  card: {
    backgroundColor: "#fff", borderRadius: 20, padding: 16, marginBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8,
  },
  cardTitle: { fontSize: 16, color: colours.textPrimary, marginBottom: 12, fontFamily: "Agrandir-GrandHeavy" },
  cardDesc:  { fontSize: 13, color: colours.textSecondary, lineHeight: 19, marginBottom: 16, fontFamily: "Agrandir-Regular" },

  sensorRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  sensorIcon:      { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sensorInfo:      { flex: 1 },
  sensorLabel:     { fontSize: 14, color: colours.textPrimary, fontFamily: "Agrandir-Regular" },
  sensorPosition:  { fontSize: 11, color: colours.textSecondary, marginTop: 1, fontFamily: "Agrandir-Regular" },
  sensorStatusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  statusDot:       { width: 7, height: 7, borderRadius: 4 },
  sensorName:      { fontSize: 12, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },
  hardwareName:    { fontSize: 10, color: "#bbb", marginTop: 2, fontFamily: "Agrandir-Regular" },
  savedHint:       { fontSize: 11, color: colours.primary, marginTop: 3, fontFamily: "Agrandir-Regular" },
  sensorActions:   { alignItems: "flex-end", gap: 6 },

  actionBtn:           { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: colours.primary, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  actionBtnText:       { fontSize: 12, fontWeight: "600", color: colours.primary, fontFamily: "Agrandir-Regular" },
  actionBtnDanger:     { borderWidth: 1.5, borderColor: "#F44336", borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  actionBtnDangerText: { fontSize: 12, fontWeight: "600", color: "#F44336", fontFamily: "Agrandir-Regular" },

  divider: { height: 1, backgroundColor: "#F0F0F0", marginVertical: 8 },

  primaryBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colours.primary, borderRadius: 30, paddingVertical: 14, marginBottom: 16 },
  primaryBtnText: { fontSize: 15, color: "#fff", fontFamily: "Agrandir-Regular" },

  qrPairBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colours.primary, borderRadius: 30, paddingVertical: 16, marginBottom: 16 },
  qrPairBtnText:  { fontSize: 16, fontWeight: "700", color: "#fff", fontFamily: "Agrandir-Regular" },

  deviceRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  deviceName: { fontSize: 14, fontWeight: "600", color: colours.textPrimary, fontFamily: "Agrandir-Regular" },
  deviceId:   { fontSize: 11, color: colours.textSecondary, marginTop: 2, fontFamily: "Agrandir-Regular" },
  emptyText:  { fontSize: 13, color: colours.textSecondary, marginVertical: 12, textAlign: "center", fontFamily: "Agrandir-Regular" },
  cancelRow:  { alignItems: "center", marginTop: 12 },
  cancelText: { fontSize: 14, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },

  calibrateContent:  { flexDirection: "row", alignItems: "center", gap: 16 },
  calibrateRight:    { flex: 1, gap: 12 },
  checklistSmall:    { gap: 6 },
  checkRowSmall:     { flexDirection: "row", alignItems: "center", gap: 6 },
  checkTextSmall:    { fontSize: 12, color: colours.textPrimary, fontFamily: "Agrandir-Regular" },
  calibrateBtn:      { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderColor: colours.primary, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, justifyContent: "center" },
  calibrateBtnText:  { fontSize: 13, fontWeight: "600", color: colours.primary, fontFamily: "Agrandir-Regular" },
  calibratedNote:    { fontSize: 11, color: "#4CAF50", fontWeight: "600", fontFamily: "Agrandir-Regular" },
  disabledNote:      { fontSize: 11, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },

  romSummary: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#F0F0F0" },
  romRow:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F5F3FF", borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  romLabel:   { fontSize: 12, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },
  romValue:   { fontSize: 12, fontWeight: "700", color: colours.primary, fontFamily: "Agrandir-Regular" },

  guideRow:   { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  guideTitle: { fontSize: 14, fontWeight: "600", color: colours.textPrimary, marginBottom: 2, fontFamily: "Agrandir-Regular" },
  guideDesc:  { fontSize: 12, color: colours.textSecondary, lineHeight: 18, fontFamily: "Agrandir-Regular" },
});