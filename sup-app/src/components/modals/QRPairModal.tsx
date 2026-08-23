/**
 * QRPairModal.tsx
 *
 * QR-code s'pot pairing for pilot rollout — scan a QR printed by
 * scripts/witmotion_pairing_tool.py, find the two named sensors via a BLE
 * scan, and require an explicit confirm tap per sensor before connecting.
 *
 * Why "exact name match" and not "first thing we see": with dozens of s'pots
 * powered on simultaneously during the pilot, silently connecting to
 * whichever device shows up first would risk pairing someone's phone to a
 * neighbour's sensor. Matching only the QR's exact advertised names — and
 * never auto-connecting without a tap, even when there's just one match —
 * is the actual "foolproof" property here. See docs/qr-pairing-plan.txt.
 *
 * Names, not MAC addresses: iOS never exposes real Bluetooth MAC addresses
 * to any app (an OS-level privacy restriction). The only identifier that's
 * identical no matter which device scans a sensor is its advertised local
 * name, which is what the QR encodes and what this modal matches against.
 */

import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { Device } from "react-native-ble-plx";
import { bleService, SensorSlot } from "../../services/BLEService";
import { parsePairingQR, PairingCode } from "../../lib/qrPairing";
import { colours } from "../../../theme/colours";

const SCAN_TIMEOUT_MS = 8000;

interface SlotOutcome {
  candidates: Device[];
  selected: Device | null;
}

const emptySlot: SlotOutcome = { candidates: [], selected: null };

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Connects + persists the device identity for a slot — reuses sensor-setup.tsx's existing logic. */
  onPaired: (slot: SensorSlot, device: Device) => Promise<void>;
}

type Phase = "scan" | "searching" | "review" | "connecting" | "done";

export default function QRPairModal({ visible, onClose, onPaired }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase,   setPhase]   = useState<Phase>("scan");
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [top,    setTop]    = useState<SlotOutcome>(emptySlot);
  const [bottom, setBottom] = useState<SlotOutcome>(emptySlot);

  const hasScannedRef = useRef(false);

  // Reset all state whenever the modal is (re)opened.
  useEffect(() => {
    if (!visible) return;
    hasScannedRef.current = false;
    setPhase("scan");
    setPairing(null);
    setScanError(null);
    setTop(emptySlot);
    setBottom(emptySlot);
  }, [visible]);

  useEffect(() => {
    return () => { bleService.stopScan(); };
  }, []);

  const runBleSearch = (code: PairingCode) => {
    setPhase("searching");
    const topFound:    Device[] = [];
    const bottomFound: Device[] = [];

    bleService.scan((device) => {
      if (device.name === code.topName && !topFound.some((d) => d.id === device.id)) {
        topFound.push(device);
      }
      if (device.name === code.bottomName && !bottomFound.some((d) => d.id === device.id)) {
        bottomFound.push(device);
      }
    }, SCAN_TIMEOUT_MS);

    setTimeout(() => {
      const byRssiDesc = (a: Device, b: Device) => (b.rssi ?? -999) - (a.rssi ?? -999);
      setTop({ candidates: [...topFound].sort(byRssiDesc), selected: null });
      setBottom({ candidates: [...bottomFound].sort(byRssiDesc), selected: null });
      setPhase("review");
    }, SCAN_TIMEOUT_MS + 200);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (hasScannedRef.current) return;
    const code = parsePairingQR(data);
    if (!code) {
      setScanError("that doesn't look like a s'up pairing code — try scanning again.");
      return;
    }
    hasScannedRef.current = true;
    setScanError(null);
    setPairing(code);
    runBleSearch(code);
  };

  const retrySlot = (slot: SensorSlot) => {
    if (!pairing) return;
    if (slot === "top")    setTop(emptySlot);
    else                   setBottom(emptySlot);
    runBleSearch(pairing);
  };

  const handleConfirmPair = async () => {
    if (!top.selected || !bottom.selected) return;
    setPhase("connecting");
    try {
      await onPaired("top", top.selected);
      await new Promise((r) => setTimeout(r, 500)); // parallel BLE connects cancel each other on iOS
      await onPaired("bottom", bottom.selected);
      setPhase("done");
    } catch (e) {
      console.warn("[QRPairModal] pairing failed:", e);
      setPhase("review");
    }
  };

  const handleClose = () => {
    bleService.stopScan();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.headerRow}>
            <Text style={s.brand}>s'can to pair</Text>
            <Pressable onPress={handleClose} style={s.closeBtn}>
              <Ionicons name="close" size={20} color="#999" />
            </Pressable>
          </View>

          {/* ── Camera permission ── */}
          {phase === "scan" && !permission?.granted && (
            <View style={s.centerBlock}>
              <Ionicons name="camera-outline" size={40} color={colours.primary} />
              <Text style={s.permTitle}>camera access needed</Text>
              <Text style={s.permBody}>
                to scan your pairing QR code, s'up needs permission to use your camera.
              </Text>
              <Pressable style={s.primaryBtn} onPress={requestPermission}>
                <Text style={s.primaryBtnText}>
                  {permission?.canAskAgain === false ? "open settings to enable" : "grant camera access"}
                </Text>
              </Pressable>
              {permission?.canAskAgain === false && (
                <Text style={s.permHint}>
                  camera access was previously denied — enable it in your device Settings app under s'up.
                </Text>
              )}
            </View>
          )}

          {/* ── Scanning ── */}
          {phase === "scan" && permission?.granted && (
            <View style={s.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={handleBarcodeScanned}
              />
              <View style={s.scanFrame} />
              <Text style={s.scanHint}>point your camera at your pairing QR code</Text>
              {scanError && <Text style={s.scanError}>{scanError}</Text>}
            </View>
          )}

          {/* ── Searching for the two named sensors ── */}
          {phase === "searching" && (
            <View style={s.centerBlock}>
              <ActivityIndicator color={colours.primary} size="large" />
              <Text style={s.permTitle}>looking for pair {pairing?.pairId}'s s'pots…</Text>
              <Text style={s.permBody}>make sure both of your s'pots are powered on and nearby.</Text>
            </View>
          )}

          {/* ── Review + mandatory confirm ── */}
          {phase === "review" && pairing && (
            <View style={s.reviewWrap}>
              <SlotReview
                label="top s'pot"
                expectedName={pairing.topName}
                outcome={top}
                onSelect={(d) => setTop((prev) => ({ ...prev, selected: d }))}
                onRetry={() => retrySlot("top")}
              />
              <SlotReview
                label="bottom s'pot"
                expectedName={pairing.bottomName}
                outcome={bottom}
                onSelect={(d) => setBottom((prev) => ({ ...prev, selected: d }))}
                onRetry={() => retrySlot("bottom")}
              />
              <Pressable
                style={[s.primaryBtn, (!top.selected || !bottom.selected) && s.primaryBtnDisabled]}
                onPress={handleConfirmPair}
                disabled={!top.selected || !bottom.selected}
              >
                <Text style={s.primaryBtnText}>pair my s'pots</Text>
              </Pressable>
            </View>
          )}

          {/* ── Connecting ── */}
          {phase === "connecting" && (
            <View style={s.centerBlock}>
              <ActivityIndicator color={colours.primary} size="large" />
              <Text style={s.permTitle}>connecting…</Text>
            </View>
          )}

          {/* ── Done ── */}
          {phase === "done" && (
            <View style={s.centerBlock}>
              <Ionicons name="checkmark-circle" size={56} color="#4CAF50" />
              <Text style={s.permTitle}>your s'pots are paired</Text>
              <Pressable style={s.primaryBtn} onPress={handleClose}>
                <Text style={s.primaryBtnText}>done</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Per-slot review row ─────────────────────────────────────────────────────
// Every path here — single match or several — ends in an explicit tap.
// Nothing about a sensor is ever auto-selected.

function SlotReview({ label, expectedName, outcome, onSelect, onRetry }: {
  label: string;
  expectedName: string;
  outcome: SlotOutcome;
  onSelect: (device: Device) => void;
  onRetry: () => void;
}) {
  const { candidates, selected } = outcome;

  return (
    <View style={s.slotCard}>
      <Text style={s.slotLabel}>{label}</Text>
      <Text style={s.slotExpected}>expecting: {expectedName}</Text>

      {candidates.length === 0 && (
        <View style={s.slotRow}>
          <Ionicons name="alert-circle-outline" size={18} color="#E65100" />
          <Text style={s.slotNotFound}>not found — make sure it's powered on nearby</Text>
          <Pressable onPress={onRetry} style={s.retryBtn}>
            <Text style={s.retryBtnText}>retry</Text>
          </Pressable>
        </View>
      )}

      {candidates.length === 1 && (
        <Pressable
          style={[s.candidateRow, selected?.id === candidates[0].id && s.candidateRowSelected]}
          onPress={() => onSelect(candidates[0])}
        >
          <Ionicons
            name={selected?.id === candidates[0].id ? "checkmark-circle" : "radio-button-off"}
            size={20}
            color={selected?.id === candidates[0].id ? "#4CAF50" : colours.primary}
          />
          <Text style={s.candidateText}>found: {candidates[0].name}</Text>
          {selected?.id !== candidates[0].id && <Text style={s.confirmHint}>tap to confirm</Text>}
        </Pressable>
      )}

      {candidates.length > 1 && (
        <View>
          <View style={s.slotRow}>
            <Ionicons name="warning-outline" size={18} color="#E65100" />
            <Text style={s.slotNotFound}>
              found {candidates.length} sensors both named "{expectedName}" — pick the correct one
            </Text>
          </View>
          {candidates.map((d) => (
            <Pressable
              key={d.id}
              style={[s.candidateRow, selected?.id === d.id && s.candidateRowSelected]}
              onPress={() => onSelect(d)}
            >
              <Ionicons
                name={selected?.id === d.id ? "checkmark-circle" : "radio-button-off"}
                size={20}
                color={selected?.id === d.id ? "#4CAF50" : colours.primary}
              />
              <Text style={s.candidateText}>{d.name} · signal {d.rssi ?? "?"}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:   { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, minHeight: "60%", padding: 24 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  brand:     { fontSize: 16, fontWeight: "700", color: colours.textPrimary },
  closeBtn:  { padding: 4 },

  centerBlock: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 32 },
  permTitle: { fontSize: 17, fontWeight: "700", color: colours.textPrimary, textAlign: "center", marginTop: 8 },
  permBody:  { fontSize: 13, color: colours.textSecondary, textAlign: "center", lineHeight: 19, paddingHorizontal: 12 },
  permHint:  { fontSize: 11, color: colours.textSecondary, textAlign: "center", marginTop: 8, paddingHorizontal: 12 },

  cameraWrap: { height: 340, borderRadius: 20, overflow: "hidden", backgroundColor: "#000" },
  scanFrame: {
    position: "absolute", top: "20%", left: "15%", right: "15%", bottom: "30%",
    borderWidth: 2, borderColor: "#fff", borderRadius: 16,
  },
  scanHint: {
    position: "absolute", bottom: 16, left: 0, right: 0,
    textAlign: "center", color: "#fff", fontSize: 12, fontWeight: "600",
  },
  scanError: {
    position: "absolute", bottom: 40, left: 16, right: 16,
    textAlign: "center", color: "#FFCDD2", fontSize: 12, fontWeight: "600",
  },

  primaryBtn: { backgroundColor: colours.primary, borderRadius: 30, paddingVertical: 14, alignItems: "center", marginTop: 16, alignSelf: "stretch" },
  primaryBtnDisabled: { backgroundColor: "#ccc" },
  primaryBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  reviewWrap: { gap: 16 },
  slotCard: { backgroundColor: "#F5F3FF", borderRadius: 16, padding: 14, gap: 8 },
  slotLabel: { fontSize: 13, fontWeight: "700", color: colours.textPrimary },
  slotExpected: { fontSize: 11, color: colours.textSecondary },

  slotRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  slotNotFound: { fontSize: 12, color: "#E65100", flex: 1 },
  retryBtn: { borderWidth: 1.5, borderColor: colours.primary, borderRadius: 16, paddingVertical: 4, paddingHorizontal: 10 },
  retryBtnText: { fontSize: 11, fontWeight: "600", color: colours.primary },

  candidateRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff", borderRadius: 12, padding: 10, marginTop: 4,
    borderWidth: 1.5, borderColor: "transparent",
  },
  candidateRowSelected: { borderColor: "#4CAF50", backgroundColor: "#F0FAF4" },
  candidateText: { fontSize: 13, color: colours.textPrimary, flex: 1 },
  confirmHint: { fontSize: 11, color: colours.primary, fontWeight: "600" },
});
