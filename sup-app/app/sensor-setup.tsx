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
  Pressable, ActivityIndicator, Image,
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
import { BrandAlert, BrandAlertButton } from "../src/components/ui/BrandAlert";
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
    bothConnected, isNeutralCalibrated,
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
  // Manual per-slot pairing (the pre-QR fallback path) is collapsed behind
  // this by default — the primary flow treats "your s'pots" as one thing to
  // connect, not two separate devices to manage.
  const [showManualSetup,  setShowManualSetup]  = useState(false);
  const [showPlacementCheck, setShowPlacementCheck] = useState(false);
  const [alert, setAlert] = useState<{
    title: string;
    message?: string;
    buttons?: BrandAlertButton[];
  } | null>(null);

  // ── Tutorial: once both s'pots connect, move on to calibration ───────────

  useEffect(() => {
    if (tutorialStep === "connect-tip" && bothConnected) {
      setTutorialStep("calibrate-tip");
    }
  }, [tutorialStep, bothConnected, setTutorialStep]);

  // ── Auto-prompt calibration right after connecting ────────────────────────
  //
  // Only reacts to a fresh false→true flip of bothConnected (a ref, not
  // state, so this doesn't re-fire every render while connected stays true).
  //   - Never calibrated yet: open the full calibration flow straight away,
  //     so a first-time user can't forget to do it.
  //   - Already calibrated: ask first, since re-opening the full 5-step flow
  //     every time someone reconnects would be annoying for daily use —
  //     "have you moved your s'pots since last calibration?" only opens the
  //     modal on "yes."

  const prevBothConnectedRef = useRef(bothConnected);

  useEffect(() => {
    const wasConnected = prevBothConnectedRef.current;
    prevBothConnectedRef.current = bothConnected;
    if (wasConnected || !bothConnected) return; // only on a fresh false→true flip

    if (!isNeutralCalibrated) {
      setShowCalibModal(true);
      return;
    }

    setShowPlacementCheck(true);
  }, [bothConnected, isNeutralCalibrated]);

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
    setAlert({
      title: `forget ${label}?`,
      message: `this will remove your saved ${label}. you can re-pair it any time.`,
      buttons: [
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
      ],
    });
  };

  /** Forgets whichever s'pot(s) are saved, in one action — the top/bottom
   * split only matters for the manual fallback pairing UI, not for the main
   * "your s'pots" status, which treats them as a single pair. */
  const forgetAll = () => {
    setAlert({
      title: "forget your s'pots?",
      message: "this will remove your saved s'pots. you can re-pair them any time.",
      buttons: [
        { text: "cancel", style: "cancel" },
        {
          text: "forget",
          style: "destructive",
          onPress: async () => {
            try {
              if (!userId) return;
              await Promise.all([
                AsyncStorage.removeItem(storageKey("top", userId)),
                AsyncStorage.removeItem(storageKey("bottom", userId)),
              ]);
              setSavedTop(null);
              setSavedBottom(null);
              if (topSensor.state.connected)    await disconnect("top");
              if (bottomSensor.state.connected) await disconnect("bottom");
            } catch (e) {
              console.warn("[Setup] Failed to forget s'pots:", e);
            }
          },
        },
      ],
    });
  };


  // ── Auto-connect ──────────────────────────────────────────────────────────

  const autoConnect = useCallback(async () => {
    if (!savedTop && !savedBottom) return;
    setIsAutoConnecting(true);

    const granted = await bleService.requestPermissions();
    if (!granted) {
      setAlert({
        title: "bluetooth permission needed",
        message: "s'up needs Bluetooth access to find your s'pots. check your device's permission settings and try again.",
      });
      setIsAutoConnecting(false);
      return;
    }

    // Keyed by slot, not device id — a match can come from either an exact
    // id hit or the hardwareName fallback below, so the winning Device for a
    // slot isn't necessarily filed under that slot's saved id.
    const foundDevices: Partial<Record<SensorSlot, Device>> = {};

    const started = await new Promise<boolean>((resolve) => {
      const scanTimeout = setTimeout(() => {
        bleService.stopScan();
        resolve(true);
      }, 8000);

      bleService.scan(
        (device) => {
          // Prefer an exact saved-id match; fall back to the advertised name
          // recorded at pairing time. A sensor's id can occasionally change
          // (documented iOS CoreBluetooth behavior — see spotNaming.ts and
          // the QR-pairing notes) which would otherwise permanently strand
          // an id-only match with no way to recover short of forget+re-pair.
          if (!foundDevices.top && savedTop &&
              (device.id === savedTop.id || (savedTop.hardwareName && device.name === savedTop.hardwareName))) {
            foundDevices.top = device;
          }
          if (!foundDevices.bottom && savedBottom &&
              (device.id === savedBottom.id || (savedBottom.hardwareName && device.name === savedBottom.hardwareName))) {
            foundDevices.bottom = device;
          }

          const gotTop    = !savedTop    || foundDevices.top;
          const gotBottom = !savedBottom || foundDevices.bottom;
          if (gotTop && gotBottom) {
            clearTimeout(scanTimeout);
            bleService.stopScan();
            resolve(true);
          }
        },
        8000,
        (message) => {
          clearTimeout(scanTimeout);
          console.warn("[Setup] auto-connect scan didn't start:", message);
          resolve(false);
        }
      ).catch((e: any) => {
        clearTimeout(scanTimeout);
        console.warn("[Setup] auto-connect scan threw:", e?.message);
        resolve(false);
      });
    });

    if (!started) {
      setAlert({
        title: "couldn't start scanning",
        message: "make sure bluetooth is turned on, then try again.",
      });
      setIsAutoConnecting(false);
      return;
    }

    // Sequential connection — parallel BLE connections cancel each other
    let connected = 0;
    const missing: SensorSlot[] = [];

    if (savedTop) {
      if (foundDevices.top) {
        await connect(foundDevices.top, "top");
        // Re-save if this was a hardwareName-fallback match on a different
        // id, so next time's id-only check hits without needing the fallback.
        if (foundDevices.top.id !== savedTop.id) await saveDevice("top", foundDevices.top);
        connected++;
        await new Promise((r) => setTimeout(r, 500));
      } else {
        missing.push("top");
      }
    }
    if (savedBottom) {
      if (foundDevices.bottom) {
        await connect(foundDevices.bottom, "bottom");
        if (foundDevices.bottom.id !== savedBottom.id) await saveDevice("bottom", foundDevices.bottom);
        connected++;
      } else {
        missing.push("bottom");
      }
    }

    if (connected === 0) {
      setAlert({
        title: "s'pots not found",
        message: "make sure both s'pots are powered on and nearby, then try again.",
      });
    } else if (missing.length > 0) {
      setAlert({
        title: "one s'pot not found",
        message: `your ${missing[0]} s'pot wasn't found nearby, make sure it's powered on and try again.`,
      });
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

  // ── Unified s'pots summary ────────────────────────────────────────────────
  //
  // The setup screen treats "your s'pots" as one thing to connect, not two
  // separate devices to manage — top/bottom only ever surface in the error
  // alert during a connect attempt (see autoConnect's "missing" message) and
  // in the manual fallback pairing UI, collapsed behind showManualSetup.

  const anySaved     = savedTop !== null || savedBottom !== null;
  const bothSaved     = savedTop !== null && savedBottom !== null;
  const anyConnected = topSensor.state.connected || bottomSensor.state.connected;

  // Kit code shown when both sides parse to the same code (e.g.
  // "s'pot_top_0048.05-08" + "s'pot_bot_0048.05-08" → "kit 48") — falls back
  // to a generic label for factory-default names or a mismatched pair.
  const topCode = (() => {
    const raw = savedTop?.hardwareName ?? topSensor.state.deviceName ?? null;
    return raw ? parseSpotName(raw)?.code ?? null : null;
  })();
  const bottomCode = (() => {
    const raw = savedBottom?.hardwareName ?? bottomSensor.state.deviceName ?? null;
    return raw ? parseSpotName(raw)?.code ?? null : null;
  })();
  const kitLabel = topCode && bottomCode && topCode === bottomCode
    ? `kit ${parseInt(topCode, 10)}`
    : "your s'pots";

  const spotsStatusText = bothConnected
    ? "connected"
    : anyConnected
      ? "not connected" // one dropped mid-session — still just "not connected" here, detail lives in the disconnect prompt
      : anySaved
        ? "saved — tap auto-connect to reconnect"
        : "not paired yet";

  // ── Render ────────────────────────────────────────────────────────────────

  if (!fontsLoaded) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <CalibrationModal visible={showCalibModal} onClose={() => setShowCalibModal(false)} />
      <BrandAlert
        visible={showPlacementCheck}
        title="s'pot placement check"
        message="have you moved the position of your s'pots since your last calibration?"
        buttons={[
          { text: "no", style: "cancel" },
          { text: "yes", onPress: () => setShowCalibModal(true) },
        ]}
        onRequestClose={() => setShowPlacementCheck(false)}
      />
      <BrandAlert
        visible={alert !== null}
        title={alert?.title ?? ""}
        message={alert?.message}
        buttons={alert?.buttons ?? [{ text: "ok" }]}
        onRequestClose={() => setAlert(null)}
      />
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

        {/* s'pots — treated as one thing to connect, not two separate rows */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>your s'pots</Text>

          <View style={styles.sensorRow}>
            <View style={[styles.sensorIcon, { backgroundColor: bothConnected ? "#E8F5E9" : "#F5F5F5" }]}>
              <Ionicons name="hardware-chip-outline" size={24} color={bothConnected ? "#4CAF50" : "#999"} />
            </View>

            <View style={styles.sensorInfo}>
              <Text style={styles.sensorLabel}>{kitLabel}</Text>
              <View style={styles.sensorStatusRow}>
                <View style={[styles.statusDot, { backgroundColor: bothConnected ? "#4CAF50" : "#ccc" }]} />
                <Text style={styles.sensorName} numberOfLines={1}>{spotsStatusText}</Text>
              </View>
            </View>

            {anySaved && (
              <Pressable style={styles.actionBtnDanger} onPress={forgetAll}>
                <Text style={styles.actionBtnDangerText}>forget</Text>
              </Pressable>
            )}
          </View>

          {!bothSaved && (
            <Pressable onPress={() => setShowManualSetup((v) => !v)} style={styles.manualToggle}>
              <Text style={styles.manualToggleText}>
                {showManualSetup ? "hide manual setup" : "having trouble? set up manually"}
              </Text>
            </Pressable>
          )}

          {showManualSetup && (
            <View style={styles.manualSetupWrap}>
              {!savedTop && (
                <Pressable style={styles.actionBtn} onPress={() => handleScan("top")}>
                  <Ionicons name="bluetooth-outline" size={14} color={colours.primary} />
                  <Text style={styles.actionBtnText}>connect top s'pot</Text>
                </Pressable>
              )}
              {!savedBottom && (
                <Pressable style={styles.actionBtn} onPress={() => handleScan("bottom")}>
                  <Ionicons name="bluetooth-outline" size={14} color={colours.primary} />
                  <Text style={styles.actionBtnText}>connect bottom s'pot</Text>
                </Pressable>
              )}
              {savedTop && (
                <Pressable style={styles.actionBtnDanger} onPress={() => forgetDevice("top")}>
                  <Text style={styles.actionBtnDangerText}>forget top s'pot only</Text>
                </Pressable>
              )}
              {savedBottom && (
                <Pressable style={styles.actionBtnDanger} onPress={() => forgetDevice("bottom")}>
                  <Text style={styles.actionBtnDangerText}>forget bottom s'pot only</Text>
                </Pressable>
              )}
            </View>
          )}

          {tutorialStep === "connect-tip" && (
            <View style={[styles.tutorialTip, { marginTop: 12, marginBottom: 0 }]}>
              <Image
                source={require("../assets/images/mascot.png")}
                style={styles.tutorialTipMascot}
                resizeMode="contain"
              />
              <View style={styles.tutorialTipTextWrap}>
                <Text style={styles.tutorialTipText}>
                  scan the qr code provided and turn on both your top and bottom s'pots to connect them. once they're both connected, a session starts automatically.
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
              desc:  "between your shoulder blades. clip or tape vertically along your back.",
            },
            {
              icon:  "arrow-down-circle-outline",
              title: "bottom s'pot",
              desc:  "lower back, just above your waistband. clip or tape vertically.",
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
  sensorStatusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  statusDot:       { width: 7, height: 7, borderRadius: 4 },
  sensorName:      { fontSize: 12, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },

  actionBtn:           { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: colours.primary, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  actionBtnText:       { fontSize: 12, fontWeight: "600", color: colours.primary, fontFamily: "Agrandir-Regular" },
  actionBtnDanger:     { borderWidth: 1.5, borderColor: "#F44336", borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  actionBtnDangerText: { fontSize: 12, fontWeight: "600", color: "#F44336", fontFamily: "Agrandir-Regular" },

  // Manual per-slot pairing fallback — collapsed by default (see showManualSetup)
  manualToggle:     { alignSelf: "center", marginTop: 12, paddingVertical: 4 },
  manualToggleText: { fontSize: 12, fontWeight: "600", color: colours.textSecondary, textDecorationLine: "underline" },
  manualSetupWrap:  { gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F0F0F0" },

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