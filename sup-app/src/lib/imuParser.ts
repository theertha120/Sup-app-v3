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
 *   before classification is meaningful — without it, raw sensor offsets
 *   (which can be ±40° depending on how the s'pots are mounted) make
 *   all thresholds meaningless.
 *
 *   Hip hinge vs slouch discrimination (bottomAbsPitch) is a v0.2 feature
 *   requiring full 5-position calibration. For v1, all forward flexion
 *   beyond the neutral band is classified by relative angle alone — which
 *   is clinically valid and far more reliable than guessing from raw data.
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

// NOTE: hip_hinge removed from v1 — requires full calibration + bottomAbsPitch
// to distinguish reliably from slouch. Reintroduce in v0.2 with quaternion math.

export type PostureSeverity = "minimal" | "mild" | "moderate" | "severe";

export interface PostureClassification {
  state: PostureState;
  severity: PostureSeverity;
  /**
   * Instant posture quality 0–100.
   * Used for the animated figure colour ONLY — not the session SHS.
   * Reflects posture at this moment, not duration.
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
 *
 * This is the MINIMUM required for correct classification.
 * Without it, raw sensor offsets (±40°) make thresholds meaningless.
 */
export interface NeutralOffset {
  topPitch:    number;
  topRoll:     number;
  bottomPitch: number;
  bottomRoll:  number;
}

/**
 * Full 5-position calibration baseline.
 * Extends NeutralOffset with personal ROM ceilings.
 * Used for personalised SHS scoring (v1).
 * Required for hip hinge discrimination (v0.2).
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
// Sagittal (forward/back) bands — relative lumbar flexion:
//   -5° to +10°   upright      neutral lordosis preserved
//   +10° to +15°  transition   early flexion — watch and wait
//   +15° to +25°  forward_lean lumbar flexion beginning (disc loading)
//   +25° to +40°  slouched     significant rounding (ligament stretch)
//   >+40°         severe       passive ligament zone (McGill creep)
//
// Lateral bands — relative lateral bending:
//   ±8°           neutral      within normal micro-movement range
//   >±8°          tilted       asymmetric disc loading begins
//
// NOTE: These thresholds apply AFTER neutral offset is subtracted.
// Raw sensor values without offset are meaningless for classification.

const NEUTRAL_MAX   =  10; // deg — upright ceiling
const TRANSITION_MAX=  15; // deg — transition ceiling
const FORWARD_MAX   =  25; // deg — forward_lean ceiling
const SLOUCH_MAX    =  40; // deg — slouched ceiling (>40 = severe)
const LATERAL_MAX   =   8; // deg — neutral lateral ceiling

// ── BLE packet parser ─────────────────────────────────────────────────────────

/**
 * Parse a 20-byte BLE notification packet from the IMU inside a s'pot.
 * Returns null if invalid (wrong header, wrong flag, or too short).
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
//
// Per the spec:
//   forward/transition → green (keep working, no penalty)
//   lateral tilt       → yellow (duration-dependent)
//   slouched/severe    → red (significant disc risk)

function computeInstantScore(state: PostureState): number {
  switch (state) {
    case "upright":      return 100;
    case "transition":   return 90;  // green — early drift, no alarm
    case "forward_lean": return 80;  // green — forward tilt, no penalty short-term
    case "tilted_left":
    case "tilted_right": return 65;  // yellow — lateral loading
    case "slouched":     return 45;  // orange/red — disc compression
    case "severe":       return 20;  // red — urgent
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
 * IMPORTANT: Pass a NeutralOffset or ClinicalBaseline whenever available.
 * Without it, raw sensor mounting offsets (which can be ±40°) make all
 * classification thresholds meaningless. The user MUST complete calibration
 * step 1 (neutral upright) before posture tracking is reliable.
 *
 * Axis mapping (confirmed from physical device testing on WT9011DCL):
 *   sagittal flex  → roll axis  (sensor mounted vertically; roll = forward/back)
 *   lateral tilt   → pitch axis (negated for correct L/R direction)
 */
export function classifySpinePosture(
  topSensor:    ParsedIMU,
  bottomSensor: ParsedIMU,
  baseline:     ClinicalBaseline | NeutralOffset | null = null
): PostureClassification {

  // Extract neutral offset — works with either ClinicalBaseline or bare NeutralOffset
  const neutral = baseline
    ? ("neutral" in baseline ? baseline.neutral : baseline)
    : null;

  // Apply neutral offset so all angles are relative to the user's upright position.
  // Without this, a -37° raw offset means neutral reads as -37° and all thresholds fail.
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

  // Inter-s'pot relative angles (offset-corrected).
  // At neutral upright these will be ≈0° regardless of mounting orientation.
  // pitchDiff = sagittal lumbar flexion (positive = forward rounding)
  // rollDiff  = lateral bending (positive = right tilt)
  const pitchDiff = topAngle.roll   - bottomAngle.roll;    // sagittal (confirmed axis)
  const rollDiff  = -(topAngle.pitch - bottomAngle.pitch); // lateral  (confirmed axis)

  const absPitch = Math.abs(pitchDiff);
  const absRoll  = Math.abs(rollDiff);

  // ── State classification ──────────────────────────────────────────────────
  //
  // Lateral takes priority when it dominates.
  // Sagittal classification uses absolute value — both forward and backward
  // flexion beyond neutral is tracked (though backward is less common seated).

  let state:    PostureState;
  let severity: PostureSeverity;

  if (absRoll > LATERAL_MAX && absRoll > absPitch * 0.7) {
    // Lateral bending is dominant
    // 0.7 factor prevents lateral from overriding clear forward flexion
    state    = rollDiff > 0 ? "tilted_right" : "tilted_left";
    severity = absRoll > LATERAL_MAX * 2 ? "moderate" : "mild";

  } else if (absPitch <= NEUTRAL_MAX) {
    // Within neutral band — upright
    state    = "upright";
    severity = "minimal";

  } else if (absPitch <= TRANSITION_MAX) {
    // 10–15° — early flexion, watch and wait
    state    = "transition";
    severity = "mild";

  } else if (absPitch <= FORWARD_MAX) {
    // 15–25° — lumbar flexion beginning
    state    = "forward_lean";
    severity = "mild";

  } else if (absPitch <= SLOUCH_MAX) {
    // 25–40° — significant rounding, disc compression zone
    state    = "slouched";
    severity = "moderate";

  } else {
    // >40° — passive ligament loading zone (McGill & Solomonow)
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
//
// Time in state before an intervention alert fires.
// Based on EMG fatigue and McGill/Solomonow creep research.
// Values in milliseconds.

export const INTERVENTION_THRESHOLDS_MS: Partial<Record<PostureState, number>> = {
  forward_lean: 15 * 60 * 1000,   // 15 min — disc loading accumulates
  slouched:     20 * 60 * 1000,   // 20 min — ligament creep threshold (McGill)
  severe:        5 * 60 * 1000,   // 5 min  — passive ligament zone, urgent
  tilted_left:  15 * 60 * 1000,   // 15 min — asymmetric disc loading
  tilted_right: 15 * 60 * 1000,
  // upright, transition: no intervention
};

// ── SHS accumulation rates ────────────────────────────────────────────────────
//
// Spine Health Score (SHS) rates in points per SECOND.
// Positive = recovery (neutral), negative = deduction (bad posture).
// Grace periods apply before deduction starts.

export const SHS_RATES: Record<PostureState, number> = {
  upright:       0.033,   // +2 pts/min — active recovery
  transition:    0,       // no penalty — too early to penalise
  forward_lean:  0,       // no penalty — forward tilt kept green per spec
  slouched:     -0.033,   // -2 pts/min — disc compression
  severe:       -0.067,   // -4 pts/min — urgent
  tilted_left:  -0.020,   // -1.2 pts/min — lateral loading
  tilted_right: -0.020,
};

export const SHS_GRACE_PERIODS_MS: Record<PostureState, number> = {
  upright:       0,
  transition:    0,
  forward_lean:  0,
  slouched:      3 * 60 * 1000,  // 3-min grace — short slouches are normal
  severe:        0,               // no grace
  tilted_left:   2 * 60 * 1000,
  tilted_right:  2 * 60 * 1000,
};

// ── UI strings (s'up brand language) ─────────────────────────────────────────

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

// ── Intervention messages ─────────────────────────────────────────────────────

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

/** Shown when user has been static for 20+ min in any state */
export const MOVEMENT_NUDGE = {
  title: "time to move",
  body:  "you've been in the same position for a while. even a small shift significantly preserves lumbar and pelvic mobility.",
  cue:   "stand up, roll your shoulders, or just shift your weight. did you move?",
};

export const SPOT_PLACEMENT = {
  top:    "top s'pot — between your shoulder blades",
  bottom: "bottom s'pot — lower back, just above your waistband",
};