/**
 * CalibrationFigure.tsx
 *
 * Animated stick-figure demo for each calibration step — reuses
 * DeskPostureFigure's joint-interpolation system (Joints, lerpJoints, the
 * same seated side-profile SVG geometry) instead of the old static
 * hand-drawn SVGs, so the figure actually shows the user the motion to
 * perform rather than a single frozen pose.
 *
 * For a movement step (lean forward/back/left/right) the figure loops
 * upright → target lean → upright, with a short hold at each end, so the
 * animation itself demonstrates "move like this." For step 1 (sit upright)
 * there's no motion to teach, so it renders a still upright figure instead.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Animated, StyleSheet, Easing } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import {
  Joints, lerpJoints, UPRIGHT,
  HEAD_R, TORSO_W, NECK_W, LIMB_W, JOINT_R,
  HIP_X, HIP_Y, KNEE_X, KNEE_Y, ANKLE_X, ANKLE_Y, SHOE_PATH,
  SEAT_X1, SEAT_Y1, SEAT_X2, SEAT_Y2,
} from "../desk/DeskPostureFigure";

interface Props {
  /** Target pose to demo. Pass UPRIGHT itself for a still, non-looping figure. */
  target: Joints;
  color: string;
}

export default function CalibrationFigure({ target, color }: Props) {
  const loop = target !== UPRIGHT;

  const progress = useRef(new Animated.Value(0)).current;
  const [joints, setJoints] = useState<Joints>({ ...UPRIGHT });

  useEffect(() => {
    if (!loop) {
      setJoints({ ...UPRIGHT });
      return;
    }

    progress.setValue(0);
    const listenerId = progress.addListener(({ value }) => {
      setJoints(lerpJoints(UPRIGHT, target, value));
    });

    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(progress, {
          toValue: 1, duration: 1100,
          easing: Easing.inOut(Easing.quad), useNativeDriver: false,
        }),
        Animated.delay(600),
        Animated.timing(progress, {
          toValue: 0, duration: 1100,
          easing: Easing.inOut(Easing.quad), useNativeDriver: false,
        }),
      ])
    );
    anim.start();

    return () => {
      anim.stop();
      progress.removeListener(listenerId);
    };
  }, [target, loop, progress]);

  const {
    hx, hy,
    n1x, n1y, n2x, n2y,
    sx, sy,
    c1x, c1y, c2x, c2y,
    px, py,
    uax, uay,
    fax, fay,
  } = joints;

  const spinePath    = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${px} ${py}`;
  const neckPath     = `M ${n1x} ${n1y} L ${n2x} ${n2y}`;
  const upperArmPath = `M ${sx - 3} ${sy + 8} L ${uax} ${uay}`;
  const forearmPath  = `M ${uax} ${uay} L ${fax} ${fay}`;
  const thighPath    = `M ${HIP_X} ${HIP_Y} L ${KNEE_X} ${KNEE_Y}`;
  const shinPath     = `M ${KNEE_X} ${KNEE_Y} L ${ANKLE_X} ${ANKLE_Y}`;
  const seatPath     = `M ${SEAT_X1} ${SEAT_Y1} L ${SEAT_X2} ${SEAT_Y2}`;
  // Straight-up reference line at the upright hip/head x — makes the lean
  // visually obvious by comparison, since it never moves with the figure.
  const referenceX   = UPRIGHT.px;

  return (
    <View style={styles.scene}>
      <Svg width={130} height={158} viewBox="0 0 200 242">
        <Path
          d={`M ${referenceX} 12 L ${referenceX} 150`}
          stroke={color} strokeWidth={1.5} strokeDasharray="5 4"
          opacity={0.22} strokeLinecap="round"
        />

        <Path d={seatPath} stroke={color} strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.35} />

        <Path d={thighPath} stroke={color} strokeWidth={LIMB_W} strokeLinecap="round" fill="none" />
        <Path d={shinPath}  stroke={color} strokeWidth={LIMB_W} strokeLinecap="round" fill="none" />
        <Circle cx={KNEE_X} cy={KNEE_Y} r={JOINT_R} fill={color} />
        <Path d={SHOE_PATH} fill={color} stroke="white" strokeWidth={2} strokeLinejoin="round" />

        <Path d={spinePath} stroke={color} strokeWidth={TORSO_W} strokeLinecap="round" fill="none" />

        <Path d={upperArmPath} stroke={color} strokeWidth={LIMB_W} strokeLinecap="round" fill="none" />
        <Circle cx={uax} cy={uay} r={JOINT_R} fill={color} />
        <Path d={forearmPath} stroke={color} strokeWidth={LIMB_W} strokeLinecap="round" fill="none" />

        <Path d={neckPath} stroke={color} strokeWidth={NECK_W} strokeLinecap="round" fill="none" />

        <Circle cx={hx} cy={hy} r={HEAD_R} fill="white" stroke={color} strokeWidth={3.5} />
        <Circle cx={hx + 9} cy={hy + 2} r={2.5} fill={color} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    width: 130,
    height: 158,
    alignItems: "center",
    justifyContent: "center",
  },
});
