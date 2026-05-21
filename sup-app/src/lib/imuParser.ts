/**
 * imuParser.ts
 *
 * Parses raw BLE packets from the WT9011DCL IMU inside each s'pot,
 * classifies spine posture using biomechanically grounded thresholds,
 * and computes a Postural Load Index (PLI) score.
 *
 * Naming convention (s'up brand):
 *   UI-facing strings → "s'pot", "top s'pot", "bottom s'pot"
 *   Code/comments     → sensor, IMU, BLE, device (technical accuracy)
 *
 * Science references:
 *   Cho et al. (2023) Bioengineering 10(9):1051 — FEM intradiscal pressure
 *   Nachemson (1976) — quadratic load increase with flexion angle
 *   Tanoue et al. (2021) — dynamic sitting & lumbar mobility
 *
 * BLE packet format (default flag 0x61):
 *   [0x55] [0x61] [AXL AXH] [AYL AYH] [AZL AZH]
 *                 [WXL WXH] [WYL WYH] [WZL WZH]
 *                 [RollL RollH] [PitchL PitchH] [YawL YawH]
 *   Total: 20 bytes
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedIMU {
  /** Acceleration in g — raw output from the IMU inside the s'pot */
  accel: { x: number; y: number; z: number };
  /** Angular velocity in deg/s */
  gyro:  { x: number; y: number; z: number };
  /** Absolute angle in degrees */
  angle: { roll: number; pitch: number; yaw: number };
}

export type PostureState =
  | "upright"
  | "forward_lean"
  | "slouched"
  | "severe"
  | "tilted_left"
  | "tilted_right";

/**
 * Severity of spinal loading at the current instant.
 * Maps to clinical risk bands from Cho et al. (2023) FEM data:
 *
 *   minimal  → neutral lordosis, minimal disc loading
 *   mild     → early kyphotic loading, passive structures engaging
 *   moderate → significant intradiscal pressure increase
 *   severe   → passive ligament loading zone, acute injury risk
 */
export type PostureSeverity = "minimal" | "mild" | "moderate" | "severe";

export interface PostureClassification {
  state: PostureState;
  severity: PostureSeverity;
  /**
   * Postural Load Index (0–100, higher = better).
   * Quadratic penalty mirroring the intradiscal pressure curve
   * from Nachemson (1976) and Cho et al. (2023).
   *
   *    0° deviation → PLI 100
   *   10° deviation → PLI  ~92
   *   20° deviation → PLI  ~67
   *   35° deviation → PLI    0
   */
  pli: number;
  /** Sagittal (forward/back) inter-s'pot deviation in degrees. Positive = forward. */
  pitchDiff: number;
  /** Lateral inter-s'pot deviation in degrees. Positive = right tilt. */
  rollDiff: number;
  /**
   * Deviation as a fraction of the user's personal ROM ceiling (0.0–1.0).
   * null until the user completes 3-position calibration with their s'pots.
   */
  romFraction: number | null;
}

/**
 * Personal ROM baseline captured during 3-position s'pot calibration.
 * Stored in AsyncStorage and passed into classifySpinePosture on each reading.
 */
export interface ClinicalBaseline {
  /**
   * Angles recorded when the user held their ideal neutral upright posture.
   * Subtracted from all subsequent readings so scores are relative to the
   * user's actual sitting position, not the s'pot's absolute orientation.
   */
  neutral: {
    topPitch:    number; // top s'pot (upper back IMU)
    topRoll:     number;
    bottomPitch: number; // bottom s'pot (lower back IMU)
    bottomRoll:  number;
  };
  /**
   * Degrees of forward lean the user reached comfortably in step 2.
   * Becomes the personal PLI ceiling for sagittal scoring.
   * Replaces the population-level 35° default.
   */
  maxForwardDeg: number;
  /**
   * Degrees of lateral lean the user reached comfortably in step 3.
   * Becomes the personal PLI ceiling for lateral scoring.
   * Replaces the population-level 15° default.
   */
  maxLateralDeg: number;
  /** ISO timestamp — used to trigger 30-day recalibration nudge in the app */
  capturedAt: string;
}

// ── Biomechanical thresholds ──────────────────────────────────────────────────
//
// Inter-s'pot angle differences (top − bottom), not absolute angles.
// Based on Cho et al. (2023) FEM intradiscal pressure bands:
//
//   Sagittal (forward/back):
//     0–10°   upright      minimal load — neutral lordosis preserved
//     10–20°  forward_lean mild load    — early kyphotic engagement
//     20–35°  slouched     moderate load— significant pressure rise
//     >35°    severe       passive ligament zone, acute risk
//
//   Lateral:
//     0–5°    neutral
//     5–15°   mild tilt
//     >15°    significant lateral deviation

const FORWARD_UPRIGHT_MAX = 10; // deg
const FORWARD_LEAN_MAX    = 20; // deg
const FORWARD_SLOUCH_MAX  = 35; // deg — population-level PLI ceiling (pre-calibration)
const LATERAL_NEUTRAL_MAX =  5; // deg
const LATERAL_TILT_MAX    = 15; // deg — population-level PLI ceiling (pre-calibration)

// ── PLI formula ───────────────────────────────────────────────────────────────
//
// Intradiscal pressure increases quadratically with flexion angle
// (Nachemson 1976; confirmed by Cho et al. 2023 FEM).
//
//   PLI = 100 × (1 − f²)   where f = deviation / ceiling, capped 0–1
//
// Pre-calibration:  ceiling = population-level constant (35° / 15°)
// Post-calibration: ceiling = user's personal ROM from s'pot calibration
//   → a stiff user with 18° max lean hits PLI 0 sooner than a flexible user
//   → a flexible user with 50° max lean is penalised less for the same deviation
//
// State labels (upright / forward_lean / slouched / severe) always use the
// hardcoded clinical bands above — they don't change per person.
// Only PLI and romFraction are personalised by calibration.

function computePLI(
  absPitchDeg: number,
  absRollDeg:  number,
  baseline:    ClinicalBaseline | null
): number {
  const sagittalCeiling = baseline?.maxForwardDeg ?? FORWARD_SLOUCH_MAX;
  const lateralCeiling  = baseline?.maxLateralDeg ?? LATERAL_TILT_MAX;

  const sagittalFraction = Math.min(absPitchDeg / sagittalCeiling, 1);
  const lateralFraction  = Math.min(absRollDeg  / lateralCeiling,  1);

  // Score on the dominant (worse) axis
  const dominant = Math.max(sagittalFraction, lateralFraction);

  // Quadratic penalty — mirrors Nachemson pressure curve
  const pli = 100 * (1 - dominant * dominant);
  return Math.round(Math.max(0, Math.min(100, pli)));
}

function computeRomFraction(
  absPitchDeg: number,
  absRollDeg:  number,
  baseline:    ClinicalBaseline | null
): number | null {
  if (!baseline) return null;
  const sagittal = Math.min(absPitchDeg / baseline.maxForwardDeg, 1);
  const lateral  = Math.min(absRollDeg  / baseline.maxLateralDeg, 1);
  return Math.round(Math.max(sagittal, lateral) * 100) / 100;
}

// ── BLE packet parser ─────────────────────────────────────────────────────────

/**
 * Parse a 20-byte BLE notification packet from the IMU inside a s'pot.
 * Returns null if the packet is invalid (wrong header, wrong flag, or too short).
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

// ── Spine classifier ──────────────────────────────────────────────────────────

/**
 * Classify spine posture from readings from both s'pots.
 *
 * topSensor    = top s'pot    — upper back (T4–T6, between shoulder blades)
 * bottomSensor = bottom s'pot — lower back (L2–L4, just above waistband)
 *
 * Pass a ClinicalBaseline once the user has completed s'pot calibration.
 * Without it, classification uses population-level absolute thresholds.
 *
 * Axis mapping (confirmed from physical device testing):
 *   pitchDiff → roll axis  (s'pot mounted vertically; roll = sagittal flex)
 *   rollDiff  → pitch axis (pitch = lateral tilt; negated for correct L/R)
 */
export function classifySpinePosture(
  topSensor:    ParsedIMU,
  bottomSensor: ParsedIMU,
  baseline:     ClinicalBaseline | null = null
): PostureClassification {

  // Subtract neutral offset from calibration so scores are relative
  // to the user's own upright position, not the IMU's absolute orientation
  const topAngle = baseline ? {
    pitch: topSensor.angle.pitch - baseline.neutral.topPitch,
    roll:  topSensor.angle.roll  - baseline.neutral.topRoll,
    yaw:   topSensor.angle.yaw,
  } : topSensor.angle;

  const bottomAngle = baseline ? {
    pitch: bottomSensor.angle.pitch - baseline.neutral.bottomPitch,
    roll:  bottomSensor.angle.roll  - baseline.neutral.bottomRoll,
    yaw:   bottomSensor.angle.yaw,
  } : bottomSensor.angle;

  // Inter-s'pot differences (axis mapping confirmed from hardware testing)
  const pitchDiff = topAngle.roll   - bottomAngle.roll;    // sagittal
  const rollDiff  = -(topAngle.pitch - bottomAngle.pitch); // lateral

  const absPitch = Math.abs(pitchDiff);
  const absRoll  = Math.abs(rollDiff);

  // ── State + severity ──────────────────────────────────────────────────────
  let state:    PostureState;
  let severity: PostureSeverity;

  if (absRoll > LATERAL_NEUTRAL_MAX && absRoll > absPitch) {
    // Lateral deviation is dominant — classify by direction
    state    = rollDiff > 0 ? "tilted_right" : "tilted_left";
    severity = absRoll <= LATERAL_TILT_MAX ? "mild" : "moderate";
  } else if (absPitch <= FORWARD_UPRIGHT_MAX) {
    state    = "upright";
    severity = "minimal";
  } else if (absPitch <= FORWARD_LEAN_MAX) {
    state    = "forward_lean";
    severity = "mild";
  } else if (absPitch <= FORWARD_SLOUCH_MAX) {
    state    = "slouched";
    severity = "moderate";
  } else {
    // >35° — passive ligament loading zone (Cho et al. 2023)
    state    = "severe";
    severity = "severe";
  }

  return {
    state,
    severity,
    pli:         computePLI(absPitch, absRoll, baseline),
    pitchDiff,
    rollDiff,
    romFraction: computeRomFraction(absPitch, absRoll, baseline),
  };
}

// ── UI strings (s'up brand language) ─────────────────────────────────────────
//
// All user-facing text uses "s'pot" not "sensor".
// Lowercase preferred per s'up brand guidelines.
// Cue-based language — no directives ("sit up straight" → movement cues).
// Positive reinforcement included for upright state.
// Sources: Tanoue et al. (2021), clinical posture coaching literature.

export const POSTURE_LABELS: Record<PostureState, string> = {
  upright:      "good alignment",
  forward_lean: "mild forward shift",
  slouched:     "spine rounding",
  severe:       "high spinal load",
  tilted_left:  "shifting left",
  tilted_right: "shifting right",
};

export const POSTURE_CUES: Record<PostureState, string> = {
  upright:
    "your spine is well aligned — keep it up.",
  forward_lean:
    "your head is drifting forward. try moving your screen closer rather than leaning in.",
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

/** Short tip shown when the user has been static for 20+ minutes (Tanoue et al.) */
export const MOVEMENT_NUDGE =
  "you've been in the same position for a while. even a small shift helps — try rolling your shoulders back or adjusting your seat.";

/** Shown in s'pot setup and calibration screens */
export const SPOT_PLACEMENT = {
  top:    "top s'pot — between your shoulder blades",
  bottom: "bottom s'pot — lower back, just above your waistband",
};