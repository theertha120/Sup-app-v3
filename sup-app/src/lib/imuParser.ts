/**
 * imuParser.ts
 *
 * Parses raw BLE packets from the WT9011DCL IMU inside each s'pot,
 * classifies posture using biomechanically grounded thresholds, and
 * provides per-state alert timers for the posture quality score.
 *
 * User-facing copy (labels, cues, intervention messages below) is
 * deliberately kept to plain posture language ("slouching," "leaning
 * forward") rather than anatomical/clinical terms (spine, disc, ligament,
 * vertebra) — this is a general-wellness posture-awareness app, not a
 * medical device, and its own copy shouldn't read like one. Internal
 * names (classifySpinePosture, shs, SHS_RATES, etc.) are unchanged —
 * those are never seen by a user or an app reviewer.
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
export interface PostureBaseline {
  neutral:        NeutralOffset;
  maxForwardDeg:  number;
  maxBackwardDeg: number;
  maxRightDeg:    number;
  maxLeftDeg:     number;
  capturedAt:     string;
  /**
   * Auto-detected sensor mounting orientation, sagittal (forward/back) axis.
   * Derived from the SIGN of (topRoll − bottomRoll) during calibration step 2
   * (lean forward) — see IMUContext.tsx's startCalibrationStep(). A s'pot kit
   * worn "backwards" flips this sign relative to DEFAULT_SAGITTAL_SIGN, and
   * classifySpinePosture() below uses whatever was actually detected instead
   * of assuming one fixed physical mounting orientation.
   * Optional so baselines saved before this field existed still load fine —
   * classifySpinePosture() falls back to DEFAULT_SAGITTAL_SIGN when absent.
   */
  sagittalSign?: 1 | -1;
  /** Same idea for the lateral (left/right) axis, detected during step 4 (lean right). */
  lateralSign?: 1 | -1;
}

// Fixed sign convention this app shipped with before per-kit orientation
// detection existed — kept as the fallback for baselines that predate
// sagittalSign/lateralSign, and as the starting assumption a fresh
// calibration corrects if it turns out to be wrong for a given kit.
export const DEFAULT_SAGITTAL_SIGN: 1 | -1 = -1;
export const DEFAULT_LATERAL_SIGN:  1 | -1 =  1;

// ── Biomechanical thresholds ──────────────────────────────────────────────────
//
// Applied to OFFSET-CORRECTED relative inter-s'pot angles.
// At neutral upright (after offset applied), pitchDiff ≈ 0° and rollDiff ≈ 0°.
//
// FIXED absolute-degree thresholds — same for every user. Calibration does
// NOT rescale these; its job is purely to determine ORIENTATION (which raw
// sign of pitchDiff/rollDiff means "forward"/"right" for this particular
// physical mount — see sagittalSign/lateralSign below), not to personalise
// how many degrees count as "slouched." A brief experiment scaling these
// bands to each user's own calibrated comfortable range (PostureBaseline.
// maxForwardDeg etc.) made classification too sensitive in practice, so that
// was reverted — maxForwardDeg/maxBackwardDeg/maxRightDeg/maxLeftDeg are
// still captured at calibration and shown in the "your personal ranges"
// summary, they just aren't fed into these thresholds.
//
// Sagittal classification uses SIGNED pitchDiff:
//   pitchDiff > 0 = forward flexion (the direction the app tracks most closely)
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
  const flag = data.getUint8(1);
  if (flag !== 0x61) {
    console.warn(`[imuParser] unexpected packet flag 0x${flag.toString(16)} — attempting parse anyway`);
  }

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
 *   lateral tilt  → pitch axis
 *
 * IMPORTANT: Classification uses SIGNED pitchDiff, not absolute value.
 * This correctly treats backward lean as upright rather than forward lean.
 *
 * Orientation is CALIBRATED, not hardcoded: which sign of the raw roll/pitch
 * diff means "forward" or "right" depends on which way the physical s'pot
 * kit is mounted, which can vary (e.g. a kit worn backwards). Rather than
 * assume one fixed mounting orientation for every kit, calibration step 2
 * (lean forward) and step 4 (lean right) detect the actual sign for THIS
 * kit from the direction the user just leaned, and store it as
 * sagittalSign/lateralSign on the PostureBaseline (see IMUContext.tsx's
 * startCalibrationStep()). DEFAULT_SAGITTAL_SIGN/DEFAULT_LATERAL_SIGN below
 * are only the fallback for baselines that predate this detection.
 *
 * This is the ONLY thing calibration changes about classification — once
 * pitchDiff/rollDiff are correctly signed, they're compared against the same
 * fixed absolute-degree bands for every user (see "Biomechanical thresholds"
 * above). An earlier version also rescaled the bands themselves to each
 * user's calibrated ROM; that made classification too sensitive and was
 * reverted.
 */
export function classifySpinePosture(
  topSensor:    ParsedIMU,
  bottomSensor: ParsedIMU,
  baseline:     PostureBaseline | NeutralOffset | null = null
): PostureClassification {

  // Extract neutral offset from either type
  const neutral = baseline
    ? ("neutral" in baseline ? baseline.neutral : baseline)
    : null;

  // Orientation signs only exist on a full PostureBaseline (they're detected
  // across calibration steps 2 and 4) — a bare step-1-only NeutralOffset, or
  // a baseline saved before this field existed, falls back to the defaults.
  const sagittalSign = (baseline && "sagittalSign" in baseline && baseline.sagittalSign)
    ? baseline.sagittalSign
    : DEFAULT_SAGITTAL_SIGN;
  const lateralSign = (baseline && "lateralSign" in baseline && baseline.lateralSign)
    ? baseline.lateralSign
    : DEFAULT_LATERAL_SIGN;

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

  // Inter-s'pot relative angles (offset-corrected, sign-corrected).
  // pitchDiff POSITIVE = forward flexion, NEGATIVE = backward extension.
  // rollDiff  POSITIVE = right lateral,   NEGATIVE = left lateral.
  // Signs come from calibration (see above), not a fixed assumption.
  const pitchDiff = sagittalSign * (topAngle.roll  - bottomAngle.roll); // sagittal
  const rollDiff  = lateralSign  * (topAngle.pitch - bottomAngle.pitch); // lateral

  const absRoll = Math.abs(rollDiff);

  // ── State classification ──────────────────────────────────────────────────
  //
  // Order of priority:
  //   1. Lateral when it truly dominates the sagittal signal
  //   2. Sagittal bands by signed pitchDiff

  let state:    PostureState;
  let severity: PostureSeverity;

  if (absRoll > LATERAL_MAX && absRoll > Math.abs(pitchDiff) * 0.7) {
    // Lateral bending is dominant (lateral must at least equal sagittal to win)
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
  slouched:     "slouching",
  severe:       "deep slouch",
  tilted_left:  "shifting left",
  tilted_right: "shifting right",
};

export const POSTURE_CUES: Record<PostureState, string> = {
  upright:
    "your posture is well aligned — keep it up.",
  transition:
    "you're starting to drift forward. a gentle chest lift will reset you.",
  forward_lean:
    "try moving your screen closer rather than leaning in. your back is straight, but your muscles are working to hold that lean.",
  slouched:
    "your upper back is rounding. try a gentle chest lift — imagine a thread pulling the crown of your head upward.",
  severe:
    "you're in a significantly slouched position. a small position change now makes a big difference.",
  tilted_left:
    "your weight is shifting left. try redistributing evenly across both sit bones.",
  tilted_right:
    "your weight is shifting right. try redistributing evenly across both sit bones.",
};

export const SEVERITY_DESCRIPTIONS: Record<PostureSeverity, string> = {
  minimal:  "minimal deviation — good posture maintained.",
  mild:     "mild deviation — a small adjustment will help.",
  moderate: "moderate deviation — time for a posture check.",
  severe:   "significant deviation — adjust your position now.",
};

export const INTERVENTION_MESSAGES: Partial<Record<PostureState, {
  title: string; body: string; cue: string;
}>> = {
  forward_lean: {
    title: "your back muscles are working hard",
    body:  "leaning forward for a long stretch can tire your back muscles, which often leads to slouching.",
    cue:   "rest your back against your chair for a minute to let those muscles recover.",
  },
  slouched: {
    title: "time to sit up",
    body:  "you've been in a rounded position for a while. changing position and taking a short active break can help you stay comfortable.",
    cue:   "sit tall — imagine a thread pulling the crown of your head upward.",
  },
  severe: {
    title: "time for a posture reset",
    body:  "you've been holding this position for a while. a quick reset can make it easier to stay comfortable.",
    cue:   "shift your position now — even a small change helps.",
  },
  tilted_left: {
    title: "leaning to one side",
    body:  "leaning to one side puts uneven strain on your lower back and keeps it in a lopsided position.",
    cue:   "sit evenly on both sit bones. if you're resting on an armrest, try sitting without it for a few minutes.",
  },
  tilted_right: {
    title: "leaning to one side",
    body:  "leaning to one side puts uneven strain on your lower back and keeps it in a lopsided position.",
    cue:   "sit evenly on both sit bones. if you're resting on an armrest, try sitting without it for a few minutes.",
  },
};

export const MOVEMENT_NUDGE = {
  title: "time to move",
  body:  "you've been in the same position for a while. even a small shift helps keep your body moving and comfortable.",
  cue:   "stand up, roll your shoulders, or just shift your weight. did you move?",
};

export const SPOT_PLACEMENT = {
  top:    "top s'pot — between your shoulder blades",
  bottom: "bottom s'pot — lower back, just above your waistband",
};