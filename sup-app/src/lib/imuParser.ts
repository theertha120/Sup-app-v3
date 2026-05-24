/**
 * imuParser.ts
 *
 * Parses raw BLE packets from the WT9011DCL IMU inside each s'pot,
 * classifies spine posture using biomechanically grounded thresholds,
 * and provides per-state alert timers for the Spine Health Score (SHS).
 *
 * Naming convention (s'up brand):
 *   UI-facing strings → "s'pot", "top s'pot", "bottom s'pot"
 *   Code/comments     → sensor, IMU, BLE, device (technical accuracy)
 *
 * Classification approach:
 *   Works on OFFSET-CORRECTED relative angles between the two s'pots.
 *   A NeutralOffset (captured at step 1 of calibration) MUST be applied
 *   before classification is meaningful.
 *
 *   KEY FIX: Backward lean is now handled by sign, not absolute value.
 *   Previous version used Math.abs(pitchDiff) which caused backward lean
 *   to be classified as forward lean. Now:
 *     pitchDiff > 0  → forward flexion (disc compression risk)
 *     pitchDiff < 0  → backward extension (facet joint loading, less urgent)
 *     Both directions beyond neutral band → upright (not penalised in v1)
 *
 * Science references:
 *   Cho et al. (2023) Bioengineering 10(9):1051 — FEM intradiscal pressure
 *   McGill & Solomonow — viscoelastic creep in spinal ligaments
 *   Nachemson (1976) — quadratic load increase with flexion angle
 *   Tanoue et al. (2021) — dynamic sitting & lumbar mobility
 *
 * BLE packet format (default flag 0x61):
 *   [0x55] [0x61] [AXL AXH] [AYL AYH] [AZL AZH]
 *                 [WXL WXH] [WYL WYH] [WZL WZH]
 *                 [RollL RollH] [PitchL PitchH] [YawL YawH]
 *   Total: 20 bytes
 *
 * FUTURE v0.2:
 *   - Hip hinge vs slouch discrimination using bottomAbsPitch
 *   - Quaternion relative rotation: q_lumbar = q_upper ⊗ q_lower⁻¹
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedIMU {
  /** Acceleration in g */
  accel: { x: number; y: number; z: number };
  /** Angular velocity in deg/s */
  gyro:  { x: number; y: number; z: number };
  /** Absolute Euler angle in degrees relative to gravity */
  angle: { roll: number; pitch: number; yaw: number };
}

export type PostureState =
  | "upright"
  | "transition"     // 10–15° forward — early flexion, watch and wait
  | "forward_lean"   // 15–25° forward — lumbar flexion beginning
  | "slouched"       // 25–40° forward — significant disc compression
  | "severe"         // >40° forward — passive ligament zone
  | "tilted_left"    // lateral asymmetric loading (left)
  | "tilted_right";  // lateral asymmetric loading (right)

export type PostureSeverity = "minimal" | "mild" | "moderate" | "severe";

export interface PostureClassification {
  state: PostureState;
  severity: PostureSeverity;
  /**
   * Instant posture quality 0–100.
   * Used for the animated figure colour ONLY — not the session SHS.
   */
  instantScore: number;
  /** Offset-corrected sagittal inter-s'pot angle (deg). Positive = forward. */
  pitchDiff: number;
  /** Offset-corrected lateral inter-s'pot angle (deg). Positive = right. */
  rollDiff: number;
}

/**
 * Neutral offset captured at calibration step 1.
 * Applied to every reading so classification is relative to the user's
 * actual upright sitting position, not raw sensor mounting orientation.
 */
export interface NeutralOffset {
  topPitch:    number;
  topRoll:     number;
  bottomPitch: number;
  bottomRoll:  number;
}

/**
 * Full 5-position calibration baseline.
 */
export interface ClinicalBaseline {
  neutral:        NeutralOffset;
  maxForwardDeg:  number;
  maxBackwardDeg: number;
  maxRightDeg:    number;
  maxLeftDeg:     number;
  capturedAt:     string;
}

// ── Biomechanical thresholds ──────────────────────────────────────────────────
//
// Applied to OFFSET-CORRECTED relative inter-s'pot angles.
// At neutral upright (after offset applied), pitchDiff ≈ 0° and rollDiff ≈ 0°.
//
// Sagittal classification uses SIGNED pitchDiff:
//   pitchDiff > 0 = forward flexion (the clinically significant direction)
//   pitchDiff < 0 = backward extension (generally benign when seated)
//
// Bands (forward only — positive pitchDiff):
//   0° to +12°    upright      neutral lordosis preserved (widened from 10°)
//   +12° to +18°  transition   early flexion — watch and wait
//   +18° to +28°  forward_lean lumbar flexion beginning
//   +28° to +42°  slouched     significant rounding
//   >+42°         severe       passive ligament zone
//
// Backward extension (negative pitchDiff):
//   0° to -15°    upright      normal seated extension, no concern
//   < -15°        upright      still classified upright — facet loading
//                              is less acute than disc compression seated
//                              (v0.2 may add back_lean state if needed)
//
// Lateral bands:
//   ±8°           neutral
//   >±8°          tilted

const NEUTRAL_FORWARD_MAX =  12; // deg — forward neutral ceiling (widened from 10)
const TRANSITION_MAX      =  18; // deg
const FORWARD_MAX         =  28; // deg
const SLOUCH_MAX          =  42; // deg
const LATERAL_MAX         =   8; // deg

// ── BLE packet parser ─────────────────────────────────────────────────────────

/**
 * Parse a 20-byte BLE notification packet from the IMU inside a s'pot.
 * Returns null if invalid.
 */
export function parseIMUPacket(data: DataView): ParsedIMU | null {
  if (data.byteLength < 20) return null;
  if (data.getUint8(0) !== 0x55) return null;
  if (data.getUint8(1) !== 0x61) return null;

  function int16(low: number, high: number): number {
    const val = (high << 8) | low;
    return val > 32767 ? val - 65536 : val;
  }

  return {
    accel: {
      x: (int16(data.getUint8(2),  data.getUint8(3))  / 32768) * 16,
      y: (int16(data.getUint8(4),  data.getUint8(5))  / 32768) * 16,
      z: (int16(data.getUint8(6),  data.getUint8(7))  / 32768) * 16,
    },
    gyro: {
      x: (int16(data.getUint8(8),  data.getUint8(9))  / 32768) * 2000,
      y: (int16(data.getUint8(10), data.getUint8(11)) / 32768) * 2000,
      z: (int16(data.getUint8(12), data.getUint8(13)) / 32768) * 2000,
    },
    angle: {
      roll:  (int16(data.getUint8(14), data.getUint8(15)) / 32768) * 180,
      pitch: (int16(data.getUint8(16), data.getUint8(17)) / 32768) * 180,
      yaw:   (int16(data.getUint8(18), data.getUint8(19)) / 32768) * 180,
    },
  };
}

// ── Instant score helper ──────────────────────────────────────────────────────

function computeInstantScore(state: PostureState): number {
  switch (state) {
    case "upright":      return 100;
    case "transition":   return 90;
    case "forward_lean": return 80;
    case "tilted_left":
    case "tilted_right": return 65;
    case "slouched":     return 45;
    case "severe":       return 20;
    default:             return 80;
  }
}

// ── Spine classifier ──────────────────────────────────────────────────────────

/**
 * Classify spine posture from readings from both s'pots.
 *
 * topSensor    = top s'pot    — upper back (T4–T6)
 * bottomSensor = bottom s'pot — lower back (L2–L4)
 *
 * Axis mapping (confirmed from physical device testing on WT9011DCL):
 *   sagittal flex → roll axis  (mounted vertically; roll = forward/back)
 *   lateral tilt  → pitch axis (negated for correct L/R direction)
 *
 * IMPORTANT: Classification uses SIGNED pitchDiff, not absolute value.
 * This correctly treats backward lean as upright rather than forward lean.
 */
export function classifySpinePosture(
  topSensor:    ParsedIMU,
  bottomSensor: ParsedIMU,
  baseline:     ClinicalBaseline | NeutralOffset | null = null
): PostureClassification {

  // Extract neutral offset from either type
  const neutral = baseline
    ? ("neutral" in baseline ? baseline.neutral : baseline)
    : null;

  // Apply neutral offset — without this, raw mounting offsets corrupt all thresholds
  const topAngle = neutral ? {
    roll:  topSensor.angle.roll  - neutral.topRoll,
    pitch: topSensor.angle.pitch - neutral.topPitch,
    yaw:   topSensor.angle.yaw,
  } : topSensor.angle;

  const bottomAngle = neutral ? {
    roll:  bottomSensor.angle.roll  - neutral.bottomRoll,
    pitch: bottomSensor.angle.pitch - neutral.bottomPitch,
    yaw:   bottomSensor.angle.yaw,
  } : bottomSensor.angle;

  // Inter-s'pot relative angles (offset-corrected)
  // pitchDiff POSITIVE = forward flexion (spine rounding forward)
  // pitchDiff NEGATIVE = backward extension (leaning back)
  // rollDiff  POSITIVE = right lateral tilt
  const pitchDiff = topAngle.roll   - bottomAngle.roll;    // sagittal (confirmed axis)
  const rollDiff  = -(topAngle.pitch - bottomAngle.pitch); // lateral  (confirmed axis)

  const absRoll = Math.abs(rollDiff);

  // ── State classification ──────────────────────────────────────────────────
  //
  // Order of priority:
  //   1. Lateral if dominant
  //   2. Backward lean → upright (benign seated extension, not penalised)
  //   3. Forward bands by signed pitchDiff

  let state:    PostureState;
  let severity: PostureSeverity;

  if (absRoll > LATERAL_MAX && absRoll > Math.abs(pitchDiff) * 0.7) {
    // Lateral bending is dominant
    state    = rollDiff > 0 ? "tilted_right" : "tilted_left";
    severity = absRoll > LATERAL_MAX * 2 ? "moderate" : "mild";

  } else if (pitchDiff <= NEUTRAL_FORWARD_MAX) {
    // At or behind neutral (includes all backward lean) → upright
    // Backward extension in seated posture is generally benign and self-limiting.
    // The chair backrest prevents extreme extension naturally.
    state    = "upright";
    severity = "minimal";

  } else if (pitchDiff <= TRANSITION_MAX) {
    // +12° to +18° — early forward flexion, watch and wait
    state    = "transition";
    severity = "mild";

  } else if (pitchDiff <= FORWARD_MAX) {
    // +18° to +28° — lumbar flexion beginning
    state    = "forward_lean";
    severity = "mild";

  } else if (pitchDiff <= SLOUCH_MAX) {
    // +28° to +42° — significant rounding, disc compression
    state    = "slouched";
    severity = "moderate";

  } else {
    // >+42° — passive ligament loading zone
    state    = "severe";
    severity = "severe";
  }

  return {
    state,
    severity,
    instantScore: computeInstantScore(state),
    pitchDiff,
    rollDiff,
  };
}

// ── Intervention timer thresholds ─────────────────────────────────────────────

export const INTERVENTION_THRESHOLDS_MS: Partial<Record<PostureState, number>> = {
  forward_lean: 15 * 60 * 1000,
  slouched:     20 * 60 * 1000,
  severe:        5 * 60 * 1000,
  tilted_left:  15 * 60 * 1000,
  tilted_right: 15 * 60 * 1000,
};

// ── SHS accumulation rates (pts/second) ──────────────────────────────────────

export const SHS_RATES: Record<PostureState, number> = {
  upright:       0.033,
  transition:    0,
  forward_lean:  0,
  slouched:     -0.033,
  severe:       -0.067,
  tilted_left:  -0.020,
  tilted_right: -0.020,
};

export const SHS_GRACE_PERIODS_MS: Record<PostureState, number> = {
  upright:       0,
  transition:    0,
  forward_lean:  0,
  slouched:      3 * 60 * 1000,
  severe:        0,
  tilted_left:   2 * 60 * 1000,
  tilted_right:  2 * 60 * 1000,
};

// ── UI strings ────────────────────────────────────────────────────────────────

export const POSTURE_LABELS: Record<PostureState, string> = {
  upright:      "good alignment",
  transition:   "slight forward shift",
  forward_lean: "leaning forward",
  slouched:     "spine rounding",
  severe:       "high spinal load",
  tilted_left:  "shifting left",
  tilted_right: "shifting right",
};

export const POSTURE_CUES: Record<PostureState, string> = {
  upright:
    "your spine is well aligned — keep it up.",
  transition:
    "you're starting to drift forward. a gentle chest lift will reset you.",
  forward_lean:
    "try moving your screen closer rather than leaning in. your spine is straight but your muscles are working.",
  slouched:
    "your upper back is rounding. try a gentle chest lift — imagine a thread pulling the crown of your head upward.",
  severe:
    "your spinal load is elevated. a small position change now significantly reduces disc pressure.",
  tilted_left:
    "your weight is shifting left. try redistributing evenly across both sit bones.",
  tilted_right:
    "your weight is shifting right. try redistributing evenly across both sit bones.",
};

export const SEVERITY_DESCRIPTIONS: Record<PostureSeverity, string> = {
  minimal:  "minimal spinal load — neutral curve maintained.",
  mild:     "mild spinal loading — a small adjustment will help.",
  moderate: "moderate loading — your disc pressure is elevated.",
  severe:   "high spinal loading — adjust your position now.",
};

export const INTERVENTION_MESSAGES: Partial<Record<PostureState, {
  title: string; body: string; cue: string;
}>> = {
  forward_lean: {
    title: "your back muscles are working hard",
    body:  "leaning forward puts your erector spinae under continuous isometric load. after 10–15 minutes these muscles begin to fatigue, which often leads to collapsing into a full slouch.",
    cue:   "rest your back against your chair for a minute to let those muscles recover.",
  },
  slouched: {
    title: "disc pressure is building up",
    body:  "your spine has been in a rounded position. this squeezes the front of your intervertebral discs and stretches your spinal ligaments. research shows 20 minutes of sustained rounding can take 4–7 hours to fully recover from.",
    cue:   "sit tall — imagine a thread pulling the crown of your head upward. your discs will thank you.",
  },
  severe: {
    title: "high spinal load — please adjust now",
    body:  "your spine is under significant load and your posterior ligaments are approaching their elastic limit.",
    cue:   "shift your position now — even a small change redistributes the load significantly.",
  },
  tilted_left: {
    title: "asymmetric loading on your spine",
    body:  "leaning to one side creates uneven pressure across your discs and keeps one side of your lower back locked in a shortened position.",
    cue:   "sit evenly on both sit bones. if you're resting on an armrest, try sitting without it for a few minutes.",
  },
  tilted_right: {
    title: "asymmetric loading on your spine",
    body:  "leaning to one side creates uneven pressure across your discs and keeps one side of your lower back locked in a shortened position.",
    cue:   "sit evenly on both sit bones. if you're resting on an armrest, try sitting without it for a few minutes.",
  },
};

export const MOVEMENT_NUDGE = {
  title: "time to move",
  body:  "you've been in the same position for a while. even a small shift significantly preserves lumbar and pelvic mobility.",
  cue:   "stand up, roll your shoulders, or just shift your weight. did you move?",
};

export const SPOT_PLACEMENT = {
  top:    "top s'pot — between your shoulder blades",
  bottom: "bottom s'pot — lower back, just above your waistband",
};