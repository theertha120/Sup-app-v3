/**
 * DeskPostureFigure
 *
 * A seated side-profile SVG human figure that smoothly interpolates between
 * five posture key-frames. No images — every line is drawn at runtime so the
 * figure is always crisp and tinted to match the posture score colour.
 *
 * Posture states
 *   upright       – perfect seated posture, straight spine
 *   slouched      – kyphotic C-curve, head & shoulders rolled forward
 *   forward_lean  – whole torso tilts forward from hips
 *   tilted_right  – lateral lean to the right
 *   tilted_left   – lateral lean to the left
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Animated, StyleSheet, Easing } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { DeskPostureState, getScoreColor } from "./mockDeskPostureData";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * All mutable joint positions for a single posture key-frame.
 * Legs/feet are intentionally fixed — posture variations live in the trunk.
 */
type Joints = {
  // Head
  hx: number; hy: number;

  // Neck  (line: n1 → n2)
  n1x: number; n1y: number;
  n2x: number; n2y: number;

  // Spine top (approx shoulder/C7 level)
  sx: number; sy: number;

  // Shoulder cross-line (shows shoulder width & roll in profile)
  shFx: number; shFy: number; // front shoulder end
  shBx: number; shBy: number; // back shoulder end

  // Spine cubic-bezier control points
  c1x: number; c1y: number;
  c2x: number; c2y: number;

  // Hip / pelvis (spine base)
  px: number; py: number;

  // Arm: shoulder-origin → elbow → wrist
  uax: number; uay: number; // elbow
  fax: number; fay: number; // wrist / hand
};

// ─── Pose key-frames ─────────────────────────────────────────────────────────
// SVG canvas: viewBox="0 0 200 242"
// Person faces RIGHT  (forward = +x direction)
// The thigh is near-horizontal (extends forward), shin drops vertically.
// Spine bezier: M spineTop C ctrl1, ctrl2, hip
//   → ctrl points LEFT of spine = backward bow (kyphosis)
//   → ctrl points RIGHT of spine = forward bow (leaning forward)
//   → ctrl points inline = straight / upright

const UPRIGHT: Joints = {
  // Straight spine, head above hips, neutral arm rest on lap
  hx: 100, hy: 26,
  n1x:  98, n1y: 46,   n2x:  97, n2y: 64,
  sx:   97, sy:  64,
  shFx: 118, shFy: 72,  shBx: 78, shBy: 72,
  c1x:  97, c1y:  98,  // straight — no mid-curve
  c2x:  96, c2y: 126,
  px:   96, py:  150,
  uax:  72, uay: 114,  // upper arm hangs + slightly forward
  fax: 108, fay: 148,  // forearm rests on lap/thigh
};

// Whole trunk tilts forward from the hips (craning at screen) — spine stays straight
const FORWARD_LEAN: Joints = {
  hx: 124, hy: 44,
  n1x: 116, n1y: 63,   n2x: 112, n2y: 79,
  sx: 112,  sy:  79,
  shFx: 134, shFy: 87,  shBx: 93, shBy: 87,
  c1x: 110, c1y: 108,  // inline with tilt — no kyphosis
  c2x: 105, c2y: 133,
  px:   96, py:  150,
  uax:  91, uay: 124,
  fax: 120, fay: 154,
};

// Kyphosis: mid-back bows BACKWARD — head droops lower than forward_lean
const SLOUCHED: Joints = {
  hx: 129, hy: 57,
  n1x: 125, n1y: 71,   n2x: 112, n2y: 80,
  sx: 112,  sy:  80,
  shFx: 133, shFy: 87,  shBx: 93, shBy: 87,
  c1x:  70, c1y:  99,  // strong kyphotic bow backward
  c2x:  74, c2y: 128,
  px:   96, py:  150,
  uax:  91, uay: 123,
  fax: 119, fay: 153,
};

// Extreme kyphosis — passive ligament zone, maximum head drop
const SEVERE: Joints = {
  hx: 136, hy: 68,
  n1x: 132, n1y: 82,   n2x: 119, n2y: 91,
  sx: 119,  sy:  91,
  shFx: 140, shFy: 98,  shBx: 100, shBy: 98,
  c1x:  60, c1y: 100,  // very strong backward bow
  c2x:  66, c2y: 130,
  px:   96, py:  150,
  uax:  98, uay: 130,
  fax: 126, fay: 157,
};

// Lateral drift to the right
const TILTED_RIGHT: Joints = {
  hx: 117, hy: 20,
  n1x: 114, n1y: 40,   n2x: 111, n2y: 58,
  sx: 111,  sy:  58,
  shFx: 132, shFy: 66,  shBx: 93, shBy: 66,
  c1x: 111, c1y:  92,
  c2x: 108, c2y: 121,
  px:   96, py:  150,
  uax:  86, uay: 103,
  fax: 116, fay: 144,
};

// Lateral drift to the left
const TILTED_LEFT: Joints = {
  hx:  81, hy: 20,
  n1x:  82, n1y: 40,   n2x:  83, n2y: 58,
  sx:   83, sy:  58,
  shFx: 103, shFy: 66,  shBx: 64, shBy: 66,
  c1x:  83, c1y:  92,
  c2x:  87, c2y: 121,
  px:   96, py:  150,
  uax:  58, uay: 103,
  fax:  90, fay: 144,
};

const TRANSITION: Joints = {
  hx: 114, hy: 38,
  n1x: 110, n1y: 57,   n2x: 107, n2y: 73,
  sx: 107,  sy:  73,
  shFx: 128, shFy: 81,  shBx: 90, shBy: 81,
  c1x: 106, c1y: 103,
  c2x: 102, c2y: 130,
  px:   96, py:  150,
  uax:  83, uay: 119,
  fax: 114, fay: 151,
};

const POSES: Record<DeskPostureState, Joints> = {
  upright:      UPRIGHT,
  transition:   TRANSITION,
  forward_lean: FORWARD_LEAN,
  slouched:     SLOUCHED,
  severe:       SEVERE,
  tilted_left:  TILTED_LEFT,
  tilted_right: TILTED_RIGHT,
};
// ─── Helpers ─────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpJoints(a: Joints, b: Joints, t: number): Joints {
  const out = {} as Joints;
  (Object.keys(a) as (keyof Joints)[]).forEach((k) => {
    out[k] = lerp(a[k], b[k], t);
  });
  return out;
}

// ─── Stroke widths ───────────────────────────────────────────────────────────

const HEAD_R  = 21;  // head circle radius
const TORSO_W = 17;  // spine / torso stroke
const NECK_W  =  8;  // neck stroke
const LIMB_W  = 10;  // arms & legs
const SH_W    =  8;  // shoulder bar
const JOINT_R =  5;  // elbow / knee dot

// Fixed leg geometry — thigh is near-horizontal (seated), shin drops straight down
// Hip (~96, 150) → knee forward (~150, 160) → ankle below (~150, 224) → foot forward
const HIP_X      =  96, HIP_Y      = 150; // matches px/py in all poses
const KNEE_X     = 150, KNEE_Y     = 162;
const ANKLE_X    = 150, ANKLE_Y    = 226;
// Shoe silhouette — side profile facing right, connects to shin bottom (150,226)
// ankle-back → heel (behind shin) → rounded heel corner → flat sole →
// rounded toe tip → top-front → shoe top → close
const SHOE_PATH =
  "M 150 226 L 141 228 Q 138 237 145 238 L 172 238 Q 182 238 182 229 L 177 221 L 152 221 Z";
// Subtle chair-seat line behind hips so it reads as "sitting"
const SEAT_X1    =  40, SEAT_Y1    = 153;
const SEAT_X2    =  96, SEAT_Y2    = 153;

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  state: DeskPostureState;
  score: number;
}

export default function DeskPostureFigure({ state, score }: Props) {
  const accentColor = getScoreColor(score);

  const currentRef = useRef<Joints>({ ...POSES[state] });
  const fromRef    = useRef<Joints>({ ...POSES[state] });
  const toRef      = useRef<Joints>({ ...POSES[state] });
  const progress   = useRef(new Animated.Value(1)).current;
  const animRef    = useRef<Animated.CompositeAnimation | null>(null);

  const [joints, setJoints] = useState<Joints>({ ...POSES[state] });

  useEffect(() => {
    const target = POSES[state];
    if (JSON.stringify(target) === JSON.stringify(toRef.current)) return;
    if (animRef.current) animRef.current.stop();

    fromRef.current = { ...currentRef.current };
    toRef.current   = target;
    progress.setValue(0);

    const listenerId = progress.addListener(({ value }) => {
      const j = lerpJoints(fromRef.current, toRef.current, value);
      currentRef.current = j;
      setJoints(j);
    });

    animRef.current = Animated.timing(progress, {
      toValue:  1,
      duration: 480,
      easing:   Easing.out(Easing.cubic),
      useNativeDriver: false,
    });

    animRef.current.start(({ finished }) => {
      progress.removeListener(listenerId);
      if (finished) {
        currentRef.current = target;
        setJoints(target);
      }
    });

    return () => progress.removeListener(listenerId);
  }, [state, progress]);

  const {
    hx, hy,
    n1x, n1y, n2x, n2y,
    sx, sy,
    c1x, c1y, c2x, c2y,
    px, py,
    uax, uay,
    fax, fay,
  } = joints;

  // ── SVG path strings ──
  const spinePath    = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${px} ${py}`;
  const neckPath     = `M ${n1x} ${n1y} L ${n2x} ${n2y}`;
  // Two arm lines alongside the torso — no shoulder bar
  // Upper arm: from side of spine at shoulder level, hangs down to elbow
  const upperArmPath = `M ${sx - 3} ${sy + 8} L ${uax} ${uay}`;
  // Forearm: elbow bends forward, rests on lap/thigh
  const forearmPath  = `M ${uax} ${uay} L ${fax} ${fay}`;
  // Legs: thigh nearly horizontal, shin vertical
  const thighPath    = `M ${HIP_X} ${HIP_Y} L ${KNEE_X} ${KNEE_Y}`;
  const shinPath     = `M ${KNEE_X} ${KNEE_Y} L ${ANKLE_X} ${ANKLE_Y}`;
  const seatPath     = `M ${SEAT_X1} ${SEAT_Y1} L ${SEAT_X2} ${SEAT_Y2}`;

  return (
    <View style={styles.scene}>
      <Svg width={200} height={242} viewBox="0 0 200 242">

        {/* ── Chair seat line ── */}
        <Path d={seatPath} stroke={accentColor} strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.35} />

        {/* ── Legs — drawn first so torso overlaps naturally ── */}
        <Path d={thighPath} stroke={accentColor} strokeWidth={LIMB_W} strokeLinecap="round" fill="none" />
        <Path d={shinPath}  stroke={accentColor} strokeWidth={LIMB_W} strokeLinecap="round" fill="none" />
        <Circle cx={KNEE_X} cy={KNEE_Y} r={JOINT_R} fill={accentColor} />
        {/* Shoe: filled side-profile silhouette, white outline separates it from shin */}
        <Path d={SHOE_PATH} fill={accentColor} stroke="white" strokeWidth={2} strokeLinejoin="round" />

        {/* ── Torso / spine ── */}
        <Path d={spinePath} stroke={accentColor} strokeWidth={TORSO_W} strokeLinecap="round" fill="none" />

        {/* ── Two arm lines alongside the torso (no shoulder bar) ── */}
        <Path d={upperArmPath} stroke={accentColor} strokeWidth={LIMB_W}     strokeLinecap="round" fill="none" />
        <Circle cx={uax} cy={uay} r={JOINT_R} fill={accentColor} />
        <Path d={forearmPath}  stroke={accentColor} strokeWidth={LIMB_W}     strokeLinecap="round" fill="none" />

        {/* ── Neck ── */}
        <Path d={neckPath} stroke={accentColor} strokeWidth={NECK_W} strokeLinecap="round" fill="none" />

        {/* ── Head ── */}
        <Circle cx={hx} cy={hy} r={HEAD_R} fill="white" stroke={accentColor} strokeWidth={3.5} />
        {/* Eye — shows which way the figure faces */}
        <Circle cx={hx + 9} cy={hy + 2} r={2.5} fill={accentColor} />
      </Svg>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scene: {
    width: 260,
    height: 260,
    backgroundColor: "white",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
