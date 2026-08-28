/**
 * spotNaming.ts
 *
 * Parses the s'pot physical naming convention used for BLE advertised
 * (local) names. The apostrophe and the "."/"-" separators from the
 * original convention aren't reliably typeable/supported when renaming via
 * WitMotion's app, so the convention actually used in the field is plain
 * underscores throughout, e.g.:
 *   spot_top_0048_05_01
 *   spot_bot_0048_05_01
 * The apostrophe and "."/"-" separators are still accepted too (in case an
 * earlier-provisioned unit used them), so this parser is deliberately
 * forgiving about punctuation rather than tied to one exact convention.
 *
 * Breakdown: [s']pot_<role>_<4-digit kit code>[._]<2-digit batch>[-_]<2 digits>
 *   - role  — "top" or "bot", which half of the kit this sensor is
 *   - code  — 4-digit kit identifier. Meant to be unique per kit, but the
 *             actual protection against a duplicate is the QR pairing
 *             flow's exact-name string match (QRPairModal.tsx) plus the
 *             provisioning script's name-collision guard
 *             (witmotion_pairing_tool.py) — both already catch a full-name
 *             collision regardless of what this parser does.
 *   - batch — 2-digit batch/production run number
 *   - suffix — trailing 2 digits (no fixed meaning assumed here)
 *
 * This module is a validation/sanity-check layer, NOT the matching
 * mechanism — BLEService.ts's scan() and QRPairModal.tsx's candidate
 * matching both already work by exact string equality against whatever the
 * QR encodes, regardless of naming format. Parsing here never gates
 * whether a sensor can be paired; it only lets callers surface a warning
 * (e.g. "this looks like a BOTTOM sensor, not TOP") when something about a
 * scanned name looks off, so a human catches it before confirming.
 */

export type SpotRole = "top" | "bottom";

export interface ParsedSpotName {
  role: SpotRole;
  code: string; // 4-digit kit code, e.g. "0048"
  batch: string; // 2-digit batch number, e.g. "05"
  suffix: string; // trailing 2 digits, e.g. "01"
}

// Apostrophe is optional (either straight ' or curly ’, or dropped entirely
// — BLE rename tools/hand-typing often can't produce it). The code/batch and
// batch/suffix separators accept "." or "-" (the original convention) as
// well as "_" (what renaming via WitMotion's app actually produces).
const SPOT_NAME_RE = /^s?['’]?pot_(top|bot)_(\d{4})[._](\d{2})[-_](\d{2})$/i;

/** Parses a s'pot's advertised name. Returns null (never throws) if it doesn't match the convention. */
export function parseSpotName(name: string): ParsedSpotName | null {
  const match = SPOT_NAME_RE.exec(name.trim());
  if (!match) return null;

  const [, roleToken, code, batch, suffix] = match;
  return {
    role: roleToken.toLowerCase() === "top" ? "top" : "bottom",
    code,
    batch,
    suffix,
  };
}
