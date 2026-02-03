/**
 * Sensor data analysis for IMU-based posture detection.
 * Classifies streamed IMU readings into good/bad posture and produces session stats.
 *
 * Usage with mock stream (no calibration):
 *   import mockStream from "@/data/mock_imu_stream.json";
 *   import { analyzeIMUStream, streamToPostureDataShape } from "@/services/postureAnalysisService";
 *   const stats = analyzeIMUStream(mockStream as IMUReading[]);
 *   const dataShape = streamToPostureDataShape(mockStream as IMUReading[]);
 *
 * With calibration (user held good posture for ~5s):
 *   import calibration from "@/data/calibration_good_posture.json";
 *   const stats = analyzeIMUStream(mockStream as IMUReading[], calibration as IMUReading[]);
 */

// --- Types ------------------------------------------------------------------

export interface IMUReading {
  timestamp: number;
  accel: [number, number, number]; // [x, y, z] in g
  gyro: [number, number, number];   // [x, y, z] in deg/s
}

export type PostureLabel = "good" | "bad";

/** Baseline derived from calibration (user holding good posture for ~5s). */
export interface CalibrationBaseline {
  /** Expected Z acceleration in g (≈1 for upright). */
  accelZMean: number;
  /** Max acceptable horizontal magnitude sqrt(x² + y²) in g. */
  accelHorizontalTolerance: number;
  /** Max acceptable Z deviation from mean (e.g. 0.95–1.05). */
  accelZTolerance: number;
  /** Max gyro magnitude (deg/s) considered "still". */
  gyroMagnitudeThreshold: number;
}

/** Per-reading classification with duration (ms) until next reading. */
export interface ClassifiedReading {
  reading: IMUReading;
  label: PostureLabel;
  durationMs: number;
}

/** Result of analyzing an IMU stream (or live session). */
export interface PostureSessionStats {
  /** Total session duration in ms. */
  totalMs: number;
  /** Time classified as good posture (ms). */
  goodPostureMs: number;
  /** Time classified as bad posture (ms). */
  badPostureMs: number;
  /** Good posture percentage 0–100. */
  goodPosturePercent: number;
  /** Bad posture percentage 0–100. */
  badPosturePercent: number;
  /** True if session has both good and bad segments (mix). */
  isVariableSession: boolean;
  /** 0–100 score (goodPosturePercent, or derived). */
  avgScore: number;
  /** Classified readings for debugging or UI. */
  classifiedReadings: ClassifiedReading[];
}

// --- Default thresholds (no calibration) ------------------------------------

const DEFAULT_ACCEL_Z_GOOD_MIN = 0.96;
const DEFAULT_ACCEL_Z_GOOD_MAX = 1.05;
const DEFAULT_ACCEL_HORIZONTAL_GOOD_MAX = 0.08; // sqrt(x²+y²) in g
const DEFAULT_GYRO_MAGNITUDE_GOOD_MAX = 0.5;    // deg/s
const VARIABLE_SESSION_MIN_PERCENT = 10;         // both good and bad > this = variable

// --- Helpers ----------------------------------------------------------------

function horizontalAccelMagnitude(accel: [number, number, number]): number {
  return Math.sqrt(accel[0] * accel[0] + accel[1] * accel[1]);
}

function gyroMagnitude(gyro: [number, number, number]): number {
  return Math.sqrt(gyro[0] * gyro[0] + gyro[1] * gyro[1] + gyro[2] * gyro[2]);
}

/** Build baseline from calibration IMU readings (good posture held ~5s). */
export function buildCalibrationBaseline(calibrationReadings: IMUReading[]): CalibrationBaseline {
  if (calibrationReadings.length === 0) {
    return getDefaultBaseline();
  }
  let sumZ = 0;
  let sumHoriz = 0;
  let sumGyroMag = 0;
  for (const r of calibrationReadings) {
    sumZ += r.accel[2];
    sumHoriz += horizontalAccelMagnitude(r.accel);
    sumGyroMag += gyroMagnitude(r.gyro);
  }
  const n = calibrationReadings.length;
  const accelZMean = sumZ / n;
  const meanHoriz = sumHoriz / n;
  const meanGyroMag = sumGyroMag / n;
  // Use 2–3× mean as tolerance so normal jitter still counts as good.
  return {
    accelZMean,
    accelHorizontalTolerance: Math.max(meanHoriz * 2.5, 0.06),
    accelZTolerance: Math.max(0.04, (1 - accelZMean) * 2),
    gyroMagnitudeThreshold: Math.max(meanGyroMag * 2.5, 0.4),
  };
}

/** Default baseline when no calibration is provided (upright ≈ +1g on Z). */
export function getDefaultBaseline(): CalibrationBaseline {
  return {
    accelZMean: 1.0,
    accelHorizontalTolerance: DEFAULT_ACCEL_HORIZONTAL_GOOD_MAX,
    accelZTolerance: 0.05,
    gyroMagnitudeThreshold: DEFAULT_GYRO_MAGNITUDE_GOOD_MAX,
  };
}

/**
 * Classify a single IMU reading as good or bad posture.
 * Good: Z ≈ 1g, low horizontal tilt, low gyro. Bad: slouched/leaning (low Z, high X/Y, or high gyro).
 */
export function classifyReading(
  reading: IMUReading,
  baseline?: CalibrationBaseline | null
): PostureLabel {
  const base = baseline ?? getDefaultBaseline();
  const [x, y, z] = reading.accel;
  const horiz = horizontalAccelMagnitude(reading.accel);
  const gyroMag = gyroMagnitude(reading.gyro);

  const zOk = z >= base.accelZMean - base.accelZTolerance && z <= base.accelZMean + base.accelZTolerance;
  const horizOk = horiz <= base.accelHorizontalTolerance;
  const gyroOk = gyroMag <= base.gyroMagnitudeThreshold;

  // Good posture: Z in range, low tilt, low motion.
  if (zOk && horizOk && gyroOk) return "good";
  return "bad";
}

/**
 * Compute duration (ms) for each reading: time until next reading.
 * Last reading gets duration = 0 (or optionally same as previous interval; we use 0 for totalMs accuracy).
 */
function assignDurations(readings: IMUReading[]): { reading: IMUReading; durationMs: number }[] {
  return readings.map((reading, i) => {
    const next = readings[i + 1];
    const durationMs = next ? next.timestamp - reading.timestamp : 0;
    return { reading, durationMs };
  });
}

/**
 * Analyze an IMU stream and return posture session stats.
 * Use optional calibration readings to build a user-specific baseline; otherwise uses default thresholds.
 */
export function analyzeIMUStream(
  readings: IMUReading[],
  calibrationReadings?: IMUReading[] | null
): PostureSessionStats {
  const baseline = calibrationReadings?.length
    ? buildCalibrationBaseline(calibrationReadings)
    : getDefaultBaseline();

  const withDurations = assignDurations(readings);
  const classifiedReadings: ClassifiedReading[] = withDurations.map(({ reading, durationMs }) => ({
    reading,
    label: classifyReading(reading, baseline),
    durationMs,
  }));

  let goodPostureMs = 0;
  let badPostureMs = 0;
  for (const cr of classifiedReadings) {
    if (cr.label === "good") goodPostureMs += cr.durationMs;
    else badPostureMs += cr.durationMs;
  }
  const totalMs = goodPostureMs + badPostureMs;

  const goodPosturePercent = totalMs > 0 ? (goodPostureMs / totalMs) * 100 : 0;
  const badPosturePercent = totalMs > 0 ? (badPostureMs / totalMs) * 100 : 0;

  const isVariableSession =
    goodPosturePercent >= VARIABLE_SESSION_MIN_PERCENT &&
    badPosturePercent >= VARIABLE_SESSION_MIN_PERCENT;

  const avgScore = Math.round(Math.min(100, Math.max(0, goodPosturePercent)));

  return {
    totalMs,
    goodPostureMs,
    badPostureMs,
    goodPosturePercent,
    badPosturePercent,
    isVariableSession,
    avgScore,
    classifiedReadings,
  };
}

/**
 * Convenience: analyze a stream and return stats in the same shape as PostureData
 * (good/bad in minutes, totalMinutes, avgScore). Date should be set by caller.
 */
export function streamToPostureDataShape(
  readings: IMUReading[],
  calibrationReadings?: IMUReading[] | null
): {
  avgScore: number;
  goodPostureMinutes: number;
  badPostureMinutes: number;
  totalMinutes: number;
  isVariableSession: boolean;
} {
  const stats = analyzeIMUStream(readings, calibrationReadings);
  return {
    avgScore: stats.avgScore,
    goodPostureMinutes: Math.round((stats.goodPostureMs / 60_000) * 100) / 100,
    badPostureMinutes: Math.round((stats.badPostureMs / 60_000) * 100) / 100,
    totalMinutes: Math.round((stats.totalMs / 60_000) * 100) / 100,
    isVariableSession: stats.isVariableSession,
  };
}
