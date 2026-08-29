/**
 * qrPairing.ts
 *
 * Decodes the QR payload printed by scripts/witmotion_pairing_tool.py:
 *   {"pair_id": 7, "top": "s'pot_top_0007.05-08", "bottom": "s'pot_bot_0007.05-08"}
 *
 * "top"/"bottom" are the s'pots' advertised BLE local names — NOT MAC
 * addresses. iOS never exposes real Bluetooth MAC addresses to any app
 * (an OS-level privacy restriction, not a library limitation), so the only
 * identifier that's identical no matter which device scans a sensor is its
 * advertised name. See docs/qr-pairing-plan.txt for the full rationale.
 *
 * The exact name format isn't assumed anywhere in this file or in
 * BLEService.ts's scan() — whatever each sensor gets renamed to (see the
 * pilot provisioning step) is matched verbatim, no prefix/pattern check.
 * spotNaming.ts separately parses the s'pot_<role>_<code>.<batch>-<n>
 * convention for validation warnings (role/kit-code mismatches) — that's a
 * sanity-check layer on top of this exact-match logic, not a replacement.
 */

export interface PairingCode {
  pairId: number;
  topName: string;
  bottomName: string;
}

/**
 * Parses and validates a scanned QR string. Returns null (never throws) on
 * anything malformed so callers can show "not a valid s'up pairing code"
 * instead of crashing on a QR code that happens to contain unrelated text.
 */
export function parsePairingQR(raw: string): PairingCode | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof obj !== "object" || obj === null) return null;
  const { pair_id, top, bottom } = obj as Record<string, unknown>;

  if (typeof pair_id !== "number" || !Number.isFinite(pair_id)) return null;
  if (typeof top !== "string" || top.trim().length === 0) return null;
  if (typeof bottom !== "string" || bottom.trim().length === 0) return null;

  return { pairId: pair_id, topName: top, bottomName: bottom };
}
