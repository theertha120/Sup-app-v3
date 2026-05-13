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

// Kyphosis: mid-back bows BACKWARD (control points go LEFT / smaller x)
// Head & shoulders roll FORWARD (larger x)
const SLOUCHED: Joints = {
  // Head drops forward and lower — chin-toward-chest look
  hx: 124, hy: 50,
  // n2 is at spine top; n1 is pulled well forward → neck kinks forward
  n1x: 120, n1y: 65,   n2x: 107, n2y: 73,
  sx: 107,  sy:  73,
  shFx: 128, shFy: 80,  shBx: 88, shBy: 80,
  c1x:  76, c1y:  99,  // ← LEFT of spine = back bows backward (true kyphosis)
  c2x:  80, c2y: 128,
  px:   96, py:  150,
  uax:  86, uay: 118,
  fax: 114, fay: 150,
};

// Whole trunk tilts forward from the hips (craning at screen)
const FORWARD_LEAN: Joints = {
  hx: 122, hy: 42,
  n1x: 114, n1y: 62,   n2x: 110, n2y: 77,
  sx: 110,  sy:  77,
  shFx: 132, shFy: 85,  shBx: 91, shBy: 85,
  c1x: 108, c1y: 106,  // inline with tilt — no lateral bow
  c2x: 103, c2y: 131,
  px:   96, py:  150,
  uax:  89, uay: 122,
  fax: 118, fay: 153,
};

// Lateral drift to the right
const TILTED_RIGHT: Joints = {
  hx: 108, hy: 23,
  n1x: 105, n1y: 43,   n2x: 102, n2y: 61,
  sx: 102,  sy:  61,
  shFx: 122, shFy: 69,  shBx: 83, shBy: 69,
  c1x: 102, c1y:  95,
  c2x:  99, c2y: 124,
  px:   96, py:  150,
  uax:  76, uay: 107,
  fax: 106, fay: 148,
};

// Lateral drift to the left
const TILTED_LEFT: Joints = {
  hx:  90, hy: 23,
  n1x:  90, n1y: 43,   n2x:  91, n2y: 61,
  sx:   91, sy:  61,
  shFx: 111, shFy: 69,  shBx: 72, shBy: 69,
  c1x:  91, c1y:  95,
  c2x:  93, c2y: 124,
  px:   96, py:  150,
  uax:  67, uay: 107,
  fax:  98, fay: 148,
};

const POSES: Record<DeskPostureState, Joints> = {
  upright:      UPRIGHT,
  slouched:     SLOUCHED,
  forward_lean: FORWARD_LEAN,
  tilted_right: TILTED_RIGHT,
  tilted_left:  TILTED_LEFT,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpJoints(a: Joints, b: Joints, t: number): Joints {
  const out = {} as Joints;
  (Object.keys(a) as Array<keyof Joints>).forEach((k) => {
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
    if (target === toRef.current) return;

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
