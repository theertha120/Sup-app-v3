import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { DeskPostureState, POSTURE_ANGLES, getScoreColor } from "../data/mockDeskPostureData";

interface Props {
  state: DeskPostureState;
  score: number;
}

const TORSO_HEIGHT = 90;
const TORSO_WIDTH = 16;
const SHOULDER_WIDTH = 72;
const SHOULDER_HEIGHT = 10;
const HEAD_SIZE = 36;
const SPINE_COLOR_GOOD = "#4CAF50";
const TRANSITION_DURATION = 800;

/**
 * 2D stick/silhouette figure seated at a desk.
 * Body parts are absolutely positioned around a hip-origin coordinate system.
 * The upper body (head, neck, torso, shoulders) rotates as a group to
 * simulate forward lean / slouch / side tilt.
 */
export default function DeskPostureFigure({ state, score }: Props) {
  const torsoRot  = useSharedValue(0); // degrees – positive = lean forward (left on screen = screen-right lean)
  const shoulderRot = useSharedValue(0);
  const headRot   = useSharedValue(0);
  const accentColor = getScoreColor(score);

  useEffect(() => {
    const angles = POSTURE_ANGLES[state];
    const cfg = { duration: TRANSITION_DURATION, easing: Easing.out(Easing.cubic) };
    torsoRot.value    = withTiming(angles.torso,    cfg);
    shoulderRot.value = withTiming(angles.shoulder, cfg);
    headRot.value     = withTiming(angles.head,     cfg);
  }, [state]);

  // Upper body group pivots around the hip (bottom of the torso).
  // Pivot trick: translate down by TORSO_HEIGHT/2, rotate, translate back up.
  const upperBodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: TORSO_HEIGHT / 2 },
      { rotate: `${torsoRot.value}deg` },
      { translateY: -(TORSO_HEIGHT / 2) },
    ],
  }));

  // Shoulders additionally tilt (for side-lean states)
  const shoulderStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${shoulderRot.value}deg` }],
  }));

  // Head tilts a little independently
  const headStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${headRot.value}deg` }],
  }));

  return (
    <View style={styles.scene}>
      {/* ── DESK SURFACE ── */}
      <View style={[styles.desk, { backgroundColor: "#C8B89A" }]} />
      <View style={[styles.deskLeg, { left: 30, backgroundColor: "#A99070" }]} />
      <View style={[styles.deskLeg, { right: 30, backgroundColor: "#A99070" }]} />

      {/* ── CHAIR SEAT ── */}
      <View style={styles.chairSeat} />
      <View style={[styles.chairLeg, { left: 52 }]} />
      <View style={[styles.chairLeg, { right: 52 }]} />

      {/* ── FIGURE ── origin at hip point = (scene center-x, hipY) ── */}
      <View style={styles.figureRoot}>

        {/* UPPER BODY GROUP – rotates around the hip */}
        <Animated.View style={[styles.upperBodyGroup, upperBodyStyle]}>

          {/* Torso / Spine */}
          <View
            style={[
              styles.torso,
              { backgroundColor: accentColor },
            ]}
          />

          {/* Shoulders – horizontal bar at top of torso */}
          <Animated.View style={[styles.shoulderRow, shoulderStyle]}>
            <View style={[styles.shoulderBar, { backgroundColor: accentColor }]} />
            {/* Left arm */}
            <View style={[styles.arm, styles.armLeft, { backgroundColor: "#C2A685" }]} />
            {/* Right arm */}
            <View style={[styles.arm, styles.armRight, { backgroundColor: "#C2A685" }]} />
          </Animated.View>

          {/* Neck */}
          <View style={[styles.neck, { backgroundColor: "#C2A685" }]} />

          {/* Head */}
          <Animated.View style={[styles.headWrapper, headStyle]}>
            <View style={[styles.head, { borderColor: accentColor, backgroundColor: "#C2A685" }]} />
          </Animated.View>

        </Animated.View>

        {/* HIPS */}
        <View style={[styles.hips, { backgroundColor: "#5D5072" }]} />

        {/* THIGHS – going forward at roughly 90° (horizontal) */}
        <View style={[styles.thigh, styles.thighLeft,  { backgroundColor: "#5D5072" }]} />
        <View style={[styles.thigh, styles.thighRight, { backgroundColor: "#5D5072" }]} />

        {/* LOWER LEGS – going down from knee */}
        <View style={[styles.lowerLeg, styles.lowerLegLeft,  { backgroundColor: "#5D5072" }]} />
        <View style={[styles.lowerLeg, styles.lowerLegRight, { backgroundColor: "#5D5072" }]} />

        {/* FOREARMS resting on desk */}
        <View style={[styles.forearm, styles.forearmLeft,  { backgroundColor: "#C2A685" }]} />
        <View style={[styles.forearm, styles.forearmRight, { backgroundColor: "#C2A685" }]} />
      </View>

      {/* Score accent glow under figure */}
      <View style={[styles.scoreGlow, { backgroundColor: accentColor + "33" }]} />
    </View>
  );
}

const HIP_Y = 180; // px from top of scene where hips are

const styles = StyleSheet.create({
  scene: {
    width: 240,
    height: 300,
    position: "relative",
  },

  // Desk
  desk: {
    position: "absolute",
    top: HIP_Y - 90,
    left: 10,
    right: 10,
    height: 10,
    borderRadius: 3,
  },
  deskLeg: {
    position: "absolute",
    top: HIP_Y - 80,
    width: 8,
    height: 50,
    borderRadius: 3,
  },

  // Chair
  chairSeat: {
    position: "absolute",
    top: HIP_Y + 10,
    left: 50,
    right: 50,
    height: 8,
    borderRadius: 3,
    backgroundColor: "#8B7BA8",
  },
  chairLeg: {
    position: "absolute",
    top: HIP_Y + 18,
    width: 6,
    height: 55,
    borderRadius: 2,
    backgroundColor: "#7A6B96",
  },

  // Figure root – centred horizontally, hip at HIP_Y
  figureRoot: {
    position: "absolute",
    top: HIP_Y,
    left: 0,
    right: 0,
    alignItems: "center",
  },

  // Upper body group
  upperBodyGroup: {
    alignItems: "center",
    position: "absolute",
    top: -TORSO_HEIGHT,
    width: SHOULDER_WIDTH + 40,
  },

  torso: {
    position: "absolute",
    bottom: 0,
    width: TORSO_WIDTH,
    height: TORSO_HEIGHT,
    borderRadius: 6,
  },

  shoulderRow: {
    position: "absolute",
    top: -(SHOULDER_HEIGHT / 2),
    alignItems: "center",
    width: SHOULDER_WIDTH + 40,
  },
  shoulderBar: {
    width: SHOULDER_WIDTH,
    height: SHOULDER_HEIGHT,
    borderRadius: 5,
  },

  arm: {
    position: "absolute",
    width: 10,
    height: 40,
    borderRadius: 4,
    top: SHOULDER_HEIGHT / 2,
  },
  armLeft: {
    left: 4,
    transform: [{ rotate: "15deg" }],
  },
  armRight: {
    right: 4,
    transform: [{ rotate: "-15deg" }],
  },

  neck: {
    position: "absolute",
    top: -(HEAD_SIZE * 0.3 + 12),
    width: 10,
    height: 16,
    borderRadius: 4,
  },

  headWrapper: {
    position: "absolute",
    top: -(HEAD_SIZE + HEAD_SIZE * 0.3 + 12),
    alignItems: "center",
  },
  head: {
    width: HEAD_SIZE,
    height: HEAD_SIZE,
    borderRadius: HEAD_SIZE / 2,
    borderWidth: 3,
  },

  // Hips at origin (centre)
  hips: {
    position: "absolute",
    top: -6,
    width: 44,
    height: 12,
    borderRadius: 5,
  },

  // Thighs – go horizontally outward (seats figure on chair)
  thigh: {
    position: "absolute",
    top: 0,
    width: 10,
    height: 36,
    borderRadius: 4,
    transform: [{ rotate: "90deg" }],
  },
  thighLeft: {
    left: 16,
    transformOrigin: "top",
  },
  thighRight: {
    right: 16,
    transformOrigin: "top",
  },

  // Lower legs dropping from knee
  lowerLeg: {
    position: "absolute",
    top: 18,
    width: 10,
    height: 50,
    borderRadius: 4,
  },
  lowerLegLeft: {
    left: 50,
  },
  lowerLegRight: {
    right: 50,
  },

  // Forearms on desk surface
  forearm: {
    position: "absolute",
    top: -100,
    width: 32,
    height: 10,
    borderRadius: 4,
  },
  forearmLeft: {
    left: 12,
  },
  forearmRight: {
    right: 12,
  },

  // Subtle glow circle below figure reflecting posture score colour
  scoreGlow: {
    position: "absolute",
    bottom: 0,
    alignSelf: "center",
    width: 140,
    height: 20,
    borderRadius: 70,
  },
});
