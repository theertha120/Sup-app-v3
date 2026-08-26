/**
 * spotNaming.ts
 *
 * Parses the s'pot physical naming convention used for BLE advertised
 * (local) names, e.g.:
 *   s'pot_top_0048.05-08
 *   s'pot_bot_0048.05-08
 *
 * Breakdown: s'pot_<role>_<4-digit kit code>.<2-digit batch>-<2 digits>
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
  suffix: string; // trailing 2 digits, e.g. "08"
}

// Accepts either a straight (') or curly (’) apostrophe — this gets typed
// by hand into WitMotion's rename tool, so either could end up in the
// actual BLE name depending on who's provisioning and what autocorrected.
const SPOT_NAME_RE = /^s['’]pot_(top|bot)_(\d{4})\.(\d{2})-(\d{2})$/i;

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
