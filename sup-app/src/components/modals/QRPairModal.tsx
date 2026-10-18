import PressFeedback from "@/src/components/ui/PressFeedback";
/**
 * QRPairModal.tsx
 *
 * QR-code s'pot pairing for pilot rollout — scan a QR printed by
 * scripts/witmotion_pairing_tool.py, find the two named sensors via a BLE
 * scan, and require an explicit connect tap before connecting.
 *
 * Why "exact name match" and not "first thing we see": with dozens of s'pots
 * powered on simultaneously during the pilot, silently connecting to
 * whichever device shows up first would risk pairing someone's phone to a
 * neighbour's sensor. Matching only the QR's exact advertised names is the
 * actual "foolproof" property here — see docs/qr-pairing-plan.txt.
 *
 * The confirm tap itself is unified, not per-sensor: when each slot has
 * exactly one match (the expected case), both are auto-selected and shown
 * as one "your s'pots were found" screen with a single "connect" button —
 * making the user tap twice to confirm two sensors they already scanned a
 * QR for was friction with no real safety benefit. A slot only surfaces its
 * own picker (SlotReview) when it's genuinely ambiguous: 0 matches (not
 * found) or 2+ matches (a name collision) — see the review-phase render.
 *
 * Names, not MAC addresses: iOS never exposes real Bluetooth MAC addresses
 * to any app (an OS-level privacy restriction). The only identifier that's
 * identical no matter which device scans a sensor is its advertised local
 * name, which is what the QR encodes and what this modal matches against.
 */

import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { Device } from "react-native-ble-plx";
import { bleService, SensorSlot } from "../../services/BLEService";
import { parsePairingQR, PairingCode } from "../../lib/qrPairing";
import { parseSpotName } from "../../lib/spotNaming";
import { colours } from "../../../theme/colours";

const SCAN_TIMEOUT_MS = 8000;

/**
 * Non-blocking sanity check: does this candidate's parsed role (from its
 * s'pot_top_/s'pot_bot_ name) match the slot it's being reviewed for? A
 * mismatch usually means the QR's declared top/bottom names got swapped
 * during registration — surfaced as a warning, not a block, since the
 * exact-name match already found this device for a reason.
 */
function roleMismatchWarning(device: Device, expectedSlot: SensorSlot): string | null {
  const parsed = device.name ? parseSpotName(device.name) : null;
  if (!parsed || parsed.role === expectedSlot) return null;
  return `heads up — this sensor's name looks like a ${parsed.role} s'pot, not ${expectedSlot}`;
}

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
      const topSorted    = [...topFound].sort(byRssiDesc);
      const bottomSorted = [...bottomFound].sort(byRssiDesc);
      // Auto-select when there's exactly one match — the unified "connect"
      // button below is the confirm tap in that case, not a per-sensor pick.
      // A slot only needs its own picker when there's genuine ambiguity
      // (0 or 2+ candidates) — see the review-phase render.
      setTop({ candidates: topSorted, selected: topSorted.length === 1 ? topSorted[0] : null });
      setBottom({ candidates: bottomSorted, selected: bottomSorted.length === 1 ? bottomSorted[0] : null });
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
            <PressFeedback onPress={handleClose} style={s.closeBtn}>
              <Ionicons name="close" size={20} color="#999" />
            </PressFeedback>
          </View>

          {/* ── Camera permission ── */}
          {phase === "scan" && !permission?.granted && (
            <View style={s.centerBlock}>
              <Ionicons name="camera-outline" size={40} color={colours.primary} />
              <Text style={s.permTitle}>camera access needed</Text>
              <Text style={s.permBody}>
                to scan your pairing QR code, s'up needs permission to use your camera.
              </Text>
              <PressFeedback style={s.primaryBtn} onPress={requestPermission}>
                <Text style={s.primaryBtnText}>
                  {permission?.canAskAgain === false ? "open settings to enable" : "grant camera access"}
                </Text>
              </PressFeedback>
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
          {/* The expected/common case: exactly one match per slot, auto-selected
              above — show one unified "found" moment and a single connect tap,
              not two separate per-sensor confirmations. A slot only gets its
              own picker card when it's genuinely ambiguous (0 or 2+ matches). */}
          {phase === "review" && pairing && (() => {
            const topClean    = top.candidates.length    === 1;
            const bottomClean = bottom.candidates.length === 1;
            const allClean    = topClean && bottomClean;
            const bothResolved = !!top.selected && !!bottom.selected;

            const topCode    = top.selected    ? parseSpotName(top.selected.name ?? "")?.code    : null;
            const bottomCode = bottom.selected ? parseSpotName(bottom.selected.name ?? "")?.code : null;
            const kitMismatch = !!topCode && !!bottomCode && topCode !== bottomCode;

            return (
              <View style={s.reviewWrap}>
                {allClean ? (
                  <View style={s.foundCard}>
                    <Ionicons name="checkmark-circle" size={40} color="#4CAF50" />
                    <Text style={s.permTitle}>your s'pots were found</Text>
                    <Text style={s.permBody}>
                      top: {top.selected!.name}{"\n"}bottom: {bottom.selected!.name}
                    </Text>
                  </View>
                ) : (
                  <>
                    {topClean && top.selected ? (
                      <ResolvedSlotLine label="top" device={top.selected} />
                    ) : (
                      <SlotReview
                        slot="top"
                        label="top s'pot"
                        expectedName={pairing.topName}
                        outcome={top}
                        onSelect={(d) => setTop((prev) => ({ ...prev, selected: d }))}
                        onRetry={() => retrySlot("top")}
                      />
                    )}
                    {bottomClean && bottom.selected ? (
                      <ResolvedSlotLine label="bottom" device={bottom.selected} />
                    ) : (
                      <SlotReview
                        slot="bottom"
                        label="bottom s'pot"
                        expectedName={pairing.bottomName}
                        outcome={bottom}
                        onSelect={(d) => setBottom((prev) => ({ ...prev, selected: d }))}
                        onRetry={() => retrySlot("bottom")}
                      />
                    )}
                  </>
                )}

                {kitMismatch && (
                  <View style={s.slotRow}>
                    <Ionicons name="warning-outline" size={18} color="#E65100" />
                    <Text style={s.slotNotFound}>
                      these two sensors have different kit codes ({topCode} vs {bottomCode}) — make sure they're from the same kit
                    </Text>
                  </View>
                )}

                <PressFeedback
                  style={[s.primaryBtn, !bothResolved && s.primaryBtnDisabled]}
                  onPress={handleConfirmPair}
                  disabled={!bothResolved}
                >
                  <Text style={s.primaryBtnText}>connect</Text>
                </PressFeedback>

                {allClean && (
                  <PressFeedback feedback="link"
                    onPress={() => { setTop(emptySlot); setBottom(emptySlot); runBleSearch(pairing); }}
                    style={s.rescanLink}
                  >
                    <Text style={s.rescanLinkText}>not right? scan again</Text>
                  </PressFeedback>
                )}
              </View>
            );
          })()}

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
              <PressFeedback style={s.primaryBtn} onPress={handleClose}>
                <Text style={s.primaryBtnText}>done</Text>
              </PressFeedback>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Resolved slot (auto-selected, unambiguous) ──────────────────────────────
// Shown instead of the full SlotReview picker when a slot already has its
// single expected match — only used inside the non-"allClean" branch, i.e.
// when the *other* slot needs the picker below.

function ResolvedSlotLine({ label, device }: { label: string; device: Device }) {
  return (
    <View style={s.slotRow}>
      <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
      <Text style={s.resolvedText}>{label} s'pot found — {device.name}</Text>
    </View>
  );
}

// ── Per-slot review row ─────────────────────────────────────────────────────
// Only rendered for a slot that's genuinely ambiguous (0 or 2+ candidates) —
// an unambiguous single match is auto-selected and shown as ResolvedSlotLine
// instead. Every path here still ends in an explicit tap; nothing here is
// ever auto-selected.

function SlotReview({ slot, label, expectedName, outcome, onSelect, onRetry }: {
  slot: SensorSlot;
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
          <PressFeedback onPress={onRetry} style={s.retryBtn}>
            <Text style={s.retryBtnText}>retry</Text>
          </PressFeedback>
        </View>
      )}

      {/* candidates.length === 1 has no card here — the caller shows
          ResolvedSlotLine instead, since that case is unambiguous and
          already auto-selected. This component only ever renders for a
          genuinely ambiguous slot: 0 candidates (above) or 2+ (below). */}

      {candidates.length > 1 && (
        <View>
          <View style={s.slotRow}>
            <Ionicons name="warning-outline" size={18} color="#E65100" />
            <Text style={s.slotNotFound}>
              found {candidates.length} sensors both named "{expectedName}" — pick the correct one
            </Text>
          </View>
          {candidates.map((d) => (
            <View key={d.id}>
              <PressFeedback
                style={[s.candidateRow, selected?.id === d.id && s.candidateRowSelected]}
                onPress={() => onSelect(d)}
              >
                <Ionicons
                  name={selected?.id === d.id ? "checkmark-circle" : "radio-button-off"}
                  size={20}
                  color={selected?.id === d.id ? "#4CAF50" : colours.primary}
                />
                <Text style={s.candidateText}>{d.name} · signal {d.rssi ?? "?"}</Text>
              </PressFeedback>
              {roleMismatchWarning(d, slot) && (
                <Text style={s.roleWarning}>⚠️ {roleMismatchWarning(d, slot)}</Text>
              )}
            </View>
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

  foundCard: { alignItems: "center", gap: 6, backgroundColor: "#F0FAF4", borderRadius: 16, paddingVertical: 20, paddingHorizontal: 16 },
  resolvedText: { fontSize: 13, color: colours.textPrimary, flex: 1 },
  rescanLink: { alignSelf: "center", marginTop: 4, paddingVertical: 4 },
  rescanLinkText: { fontSize: 12, fontWeight: "600", color: colours.textSecondary, textDecorationLine: "underline" },

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
  roleWarning: { fontSize: 11, color: "#E65100", marginTop: 2, marginLeft: 4 },
});
