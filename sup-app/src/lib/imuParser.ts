/**
 * imuParser.ts
 * Converts raw BLE bytes from the WT9011DCL into usable sensor values.
 *
 * Packet format (default, flag 0x61):
 *   [0x55] [0x61] [AXL AXH] [AYL AYH] [AZL AZH]
 *                 [WXL WXH] [WYL WYH] [WZL WZH]
 *                 [RollL RollH] [PitchL PitchH] [YawL YawH]
 * Total: 20 bytes
 */

export interface ParsedIMU {
  /** Acceleration in g (gravity units) */
  accel: { x: number; y: number; z: number };
  /** Angular velocity in degrees/second */
  gyro: { x: number; y: number; z: number };
  /** Angle in degrees */
  angle: { roll: number; pitch: number; yaw: number };
}

/**
 * Parse a 20-byte WT9011DCL BLE notification packet.
 * Returns null if the packet is invalid.
 */
export function parseIMUPacket(data: DataView): ParsedIMU | null {
  // Must be 20 bytes, start with 0x55, flag 0x61
  if (data.byteLength < 20) return null;
  if (data.getUint8(0) !== 0x55) return null;
  if (data.getUint8(1) !== 0x61) return null;

  // Read signed 16-bit little-endian values
  function int16(lowByte: number, highByte: number): number {
    const val = (highByte << 8) | lowByte;
    // Convert to signed
    return val > 32767 ? val - 65536 : val;
  }

  const AXL = data.getUint8(2);  const AXH = data.getUint8(3);
  const AYL = data.getUint8(4);  const AYH = data.getUint8(5);
  const AZL = data.getUint8(6);  const AZH = data.getUint8(7);

  const WXL = data.getUint8(8);  const WXH = data.getUint8(9);
  const WYL = data.getUint8(10); const WYH = data.getUint8(11);
  const WZL = data.getUint8(12); const WZH = data.getUint8(13);

  const RollL  = data.getUint8(14); const RollH  = data.getUint8(15);
  const PitchL = data.getUint8(16); const PitchH = data.getUint8(17);
  const YawL   = data.getUint8(18); const YawH   = data.getUint8(19);

  return {
    accel: {
      x: (int16(AXL, AXH) / 32768) * 16,
      y: (int16(AYL, AYH) / 32768) * 16,
      z: (int16(AZL, AZH) / 32768) * 16,
    },
    gyro: {
      x: (int16(WXL, WXH) / 32768) * 2000,
      y: (int16(WYL, WYH) / 32768) * 2000,
      z: (int16(WZL, WZH) / 32768) * 2000,
    },
    angle: {
      roll:  (int16(RollL,  RollH)  / 32768) * 180,
      pitch: (int16(PitchL, PitchH) / 32768) * 180,
      yaw:   (int16(YawL,   YawH)   / 32768) * 180,
    },
  };
}

/**
 * Given top and bottom sensor angles, determine posture state.
 * Top sensor = upper back, Bottom sensor = lower back.
 *
 * The relative pitch difference tells us how curved the spine is.
 * Roll difference tells us lateral tilt.
 */
export function classifySpinePosture(
  top: ParsedIMU,
  bottom: ParsedIMU
): {
  state: "upright" | "forward_lean" | "slouched" | "tilted_left" | "tilted_right";
  score: number;
  pitchDiff: number;
  rollDiff: number;
} {
  const pitchDiff = top.angle.roll  - bottom.angle.roll;
  const rollDiff  = -(top.angle.pitch - bottom.angle.pitch);

  const absPitch = Math.abs(pitchDiff);
  const absRoll  = Math.abs(rollDiff);

  let state: "upright" | "forward_lean" | "slouched" | "tilted_left" | "tilted_right";
  let score: number;

  // Lateral tilt takes priority if significant
  if (absRoll > 8 && absRoll > absPitch) {
    state = rollDiff > 0 ? "tilted_right" : "tilted_left";
    score = Math.max(0, 100 - absRoll * 2.5);
  } else if (absPitch < 8) {
    // Small pitch difference = upright
    state = "upright";
    score = Math.min(100, 95 - absPitch * 1.5);
  } else if (pitchDiff > 0 && pitchDiff < 20) {
    // Moderate forward pitch = forward lean
    state = "forward_lean";
    score = Math.max(0, 80 - pitchDiff * 2);
  } else if (pitchDiff >= 20) {
    // Large pitch = slouching
    state = "slouched";
    score = Math.max(0, 60 - (pitchDiff - 20) * 2);
  } else {
    state = "upright";
    score = 85;
  }

  return {
    state,
    score: Math.round(score),
    pitchDiff,
    rollDiff,
  };
}
