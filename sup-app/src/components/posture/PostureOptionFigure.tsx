/**
 * PostureOptionFigure
 *
 * Small static stick figure for the posture check-in picker. Upright, forward
 * lean, slouched and severe reuse DeskPostureFigure's seated side-profile
 * geometry. Left/right tilts can't be seen from the side, so they're drawn
 * front-on (mirror view: "tilted left" leans to the left of the screen).
 */

import React from "react";
import Svg, { Circle, G, Path } from "react-native-svg";
import {
  Joints, UPRIGHT, FORWARD_LEAN, SLOUCHED,
  HEAD_R, TORSO_W, NECK_W, LIMB_W, JOINT_R,
  HIP_X, HIP_Y, KNEE_X, KNEE_Y, ANKLE_X, ANKLE_Y, SHOE_PATH,
  SEAT_X1, SEAT_Y1, SEAT_X2, SEAT_Y2,
} from "../desk/DeskPostureFigure";
import type { PostureCheckinPosture } from "@/src/services/posture/postureCheckinService";

// Deeper version of SLOUCHED: head further forward and down, back more rounded.
const SEVERE: Joints = {
  hx: 134, hy: 62,
  n1x: 128, n1y: 77,   n2x: 112, n2y: 83,
  sx: 112,  sy:  83,
  shFx: 132, shFy: 89,  shBx: 92, shBy: 89,
  c1x:  68, c1y: 104,
  c2x:  76, c2y: 132,
  px:   96, py:  150,
  uax:  92, uay: 124,
  fax: 118, fay: 152,
};

const SIDE_POSES: Partial<Record<PostureCheckinPosture, Joints>> = {
  upright: UPRIGHT,
  forward_lean: FORWARD_LEAN,
  slouched: SLOUCHED,
  severe: SEVERE,
};

const TILT_DEG: Partial<Record<PostureCheckinPosture, number>> = {
  tilted_left: -16,
  tilted_right: 16,
};

interface Props {
  posture: PostureCheckinPosture;
  color: string;
  size?: number;
}

export default function PostureOptionFigure({ posture, color, size = 84 }: Props) {
  const height = (size * 242) / 200;
  const side = SIDE_POSES[posture];

  return (
    <Svg width={size} height={height} viewBox="0 0 200 242">
      {side ? <SideFigure j={side} color={color} /> : <FrontFigure tilt={TILT_DEG[posture] ?? 0} color={color} />}
    </Svg>
  );
}

function SideFigure({ j, color }: { j: Joints; color: string }) {
  const line = { stroke: color, strokeLinecap: "round" as const, fill: "none" };
  return (
    <>
      <Path d={`M ${SEAT_X1} ${SEAT_Y1} L ${SEAT_X2} ${SEAT_Y2}`} {...line} strokeWidth={5} opacity={0.35} />
      <Path d={`M ${HIP_X} ${HIP_Y} L ${KNEE_X} ${KNEE_Y}`} {...line} strokeWidth={LIMB_W} />
      <Path d={`M ${KNEE_X} ${KNEE_Y} L ${ANKLE_X} ${ANKLE_Y}`} {...line} strokeWidth={LIMB_W} />
      <Circle cx={KNEE_X} cy={KNEE_Y} r={JOINT_R} fill={color} />
      <Path d={SHOE_PATH} fill={color} stroke="white" strokeWidth={2} strokeLinejoin="round" />
      <Path d={`M ${j.sx} ${j.sy} C ${j.c1x} ${j.c1y}, ${j.c2x} ${j.c2y}, ${j.px} ${j.py}`} {...line} strokeWidth={TORSO_W} />
      <Path d={`M ${j.sx - 3} ${j.sy + 8} L ${j.uax} ${j.uay}`} {...line} strokeWidth={LIMB_W} />
      <Circle cx={j.uax} cy={j.uay} r={JOINT_R} fill={color} />
      <Path d={`M ${j.uax} ${j.uay} L ${j.fax} ${j.fay}`} {...line} strokeWidth={LIMB_W} />
      <Path d={`M ${j.n1x} ${j.n1y} L ${j.n2x} ${j.n2y}`} {...line} strokeWidth={NECK_W} />
      <Circle cx={j.hx} cy={j.hy} r={HEAD_R} fill="white" stroke={color} strokeWidth={3.5} />
      <Circle cx={j.hx + 9} cy={j.hy + 2} r={2.5} fill={color} />
    </>
  );
}

/** Seated, facing the viewer. The upper body rotates about the hips. */
function FrontFigure({ tilt, color }: { tilt: number; color: string }) {
  const line = { stroke: color, strokeLinecap: "round" as const, fill: "none" };
  return (
    <>
      <Path d="M 56 156 L 144 156" {...line} strokeWidth={5} opacity={0.35} />
      {/* Legs */}
      <Path d="M 84 150 L 82 226" {...line} strokeWidth={LIMB_W} />
      <Path d="M 116 150 L 118 226" {...line} strokeWidth={LIMB_W} />
      <Path d="M 72 232 L 88 232" {...line} strokeWidth={LIMB_W} />
      <Path d="M 112 232 L 128 232" {...line} strokeWidth={LIMB_W} />
      <Path d="M 80 150 L 120 150" {...line} strokeWidth={LIMB_W} />
      {/* Upper body */}
      <G rotation={tilt} origin="100, 150">
        <Path d="M 100 74 L 100 150" {...line} strokeWidth={TORSO_W} />
        <Path d="M 68 80 L 132 80" {...line} strokeWidth={LIMB_W} />
        <Path d="M 68 80 L 62 116 L 78 146" {...line} strokeWidth={LIMB_W} strokeLinejoin="round" />
        <Path d="M 132 80 L 138 116 L 122 146" {...line} strokeWidth={LIMB_W} strokeLinejoin="round" />
        <Path d="M 100 58 L 100 74" {...line} strokeWidth={NECK_W} />
        <Circle cx={100} cy={38} r={HEAD_R} fill="white" stroke={color} strokeWidth={3.5} />
        <Circle cx={92} cy={38} r={2.5} fill={color} />
        <Circle cx={108} cy={38} r={2.5} fill={color} />
      </G>
    </>
  );
}
