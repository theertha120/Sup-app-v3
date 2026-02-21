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

const TORSO_HEIGHT = 85;
const TORSO_WIDTH   = 20;
const SHOULDER_WIDTH  = 76;
const SHOULDER_HEIGHT = 13;
const HEAD_SIZE = 38;
const TRANSITION_DURATION = 800;

// ─── Colours ───────────────────────────────────────────────────────────────
const SKIN       = "#DBAB8A";
const PANTS      = "#455A64";   // dark blue-gray trousers
const CHAIR_COL  = "#78909C";   // medium steel-blue chair (clearly ≠ figure)
const CHAIR_DARK = "#546E7A";
const DESK_COL   = "#C8A370";   // warm wood
const DESK_DARK  = "#A07840";
const LAPTOP_BODY = "#37474F";  // near-black laptop shell
const SCREEN_BG  = "#1C2733";   // dark screen surround
const SCREEN_GLOW = "#90CAF9";  // blue-ish screen glow

export default function DeskPostureFigure({ state, score }: Props) {
  // ── Animation shared values (unchanged) ──────────────────────────────────
  const torsoRot    = useSharedValue(0);
  const shoulderRot = useSharedValue(0);
  const headRot     = useSharedValue(0);
  const accentColor = getScoreColor(score);

  useEffect(() => {
    const angles = POSTURE_ANGLES[state];
    const cfg = { duration: TRANSITION_DURATION, easing: Easing.out(Easing.cubic) };
    torsoRot.value    = withTiming(angles.torso,    cfg);
    shoulderRot.value = withTiming(angles.shoulder, cfg);
    headRot.value     = withTiming(angles.head,     cfg);
  }, [state]);

  // Upper body pivots around the hip
  const upperBodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: TORSO_HEIGHT / 2 },
      { rotate: `${torsoRot.value}deg` },
      { translateY: -(TORSO_HEIGHT / 2) },
    ],
  }));

  const shoulderStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${shoulderRot.value}deg` }],
  }));

  const headStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${headRot.value}deg` }],
  }));

  return (
    <View style={styles.scene}>

      {/* ── Layer 1: desk legs (back) ── */}
      <View style={[styles.deskLeg, { left: 28,  backgroundColor: DESK_DARK }]} />
      <View style={[styles.deskLeg, { right: 28, backgroundColor: DESK_DARK }]} />

      {/* ── Layer 2: chair legs ── */}
      <View style={[styles.chairLeg, { left: 56  }]} />
      <View style={[styles.chairLeg, { right: 56 }]} />

      {/* ── Layer 3: chair back-rest (behind torso) ── */}
      <View style={styles.chairBackrest} />

      {/* ── Layer 4: chair seat ── */}
      <View style={styles.chairSeat} />

      {/* ── Layer 5: lower body (hidden by desk surface above) ── */}
      <View style={styles.figureRoot}>
        {/* Hips */}
        <View style={[styles.hips, { backgroundColor: PANTS }]} />
        {/* Thighs – horizontal slabs going outward from hip */}
        <View style={[styles.thigh, styles.thighLeft,  { backgroundColor: PANTS }]} />
        <View style={[styles.thigh, styles.thighRight, { backgroundColor: PANTS }]} />
        {/* Lower legs */}
        <View style={[styles.lowerLeg, styles.lowerLegLeft,  { backgroundColor: PANTS }]} />
        <View style={[styles.lowerLeg, styles.lowerLegRight, { backgroundColor: PANTS }]} />
        {/* Feet */}
        <View style={[styles.foot, styles.footLeft,  { backgroundColor: "#263238" }]} />
        <View style={[styles.foot, styles.footRight, { backgroundColor: "#263238" }]} />
      </View>

      {/* ── Layer 6: laptop base (on desk) ── */}
      <View style={styles.laptopBase} />

      {/* ── Layer 7: DESK SURFACE – covers lower body for depth illusion ── */}
      <View style={[styles.deskSurface, { backgroundColor: DESK_COL }]} />
      {/* Desk edge highlight */}
      <View style={[styles.deskEdge, { backgroundColor: DESK_DARK }]} />

      {/* ── Layer 8: laptop screen (above desk) ── */}
      <View style={styles.laptopScreen}>
        {/* Screen bezel */}
        <View style={styles.screenBezel} />
        {/* Screen content glow */}
        <View style={styles.screenGlow} />
        {/* Camera dot */}
        <View style={styles.screenCamera} />
      </View>

      {/* ── Layer 9: upper body (animated, above desk) ── */}
      <View style={styles.figureRoot}>
        <Animated.View style={[styles.upperBodyGroup, upperBodyStyle]}>

          {/* Shirt / torso */}
          <View style={[styles.torso, { backgroundColor: accentColor }]} />

          {/* Shoulders */}
          <Animated.View style={[styles.shoulderRow, shoulderStyle]}>
            <View style={[styles.shoulderBar, { backgroundColor: accentColor }]} />
            {/* Upper arms angling down toward desk */}
            <View style={[styles.upperArm, styles.upperArmLeft,  { backgroundColor: SKIN }]} />
            <View style={[styles.upperArm, styles.upperArmRight, { backgroundColor: SKIN }]} />
          </Animated.View>

          {/* Neck */}
          <View style={[styles.neck, { backgroundColor: SKIN }]} />

          {/* Head */}
          <Animated.View style={[styles.headWrapper, headStyle]}>
            {/* Hair */}
            <View style={[styles.hair, { backgroundColor: "#4A3728" }]} />
            {/* Face */}
            <View style={[styles.head, { backgroundColor: SKIN }]} />
          </Animated.View>

        </Animated.View>
      </View>

      {/* ── Layer 10: forearms resting on desk toward laptop ── */}
      <View style={[styles.forearm, styles.forearmLeft,  { backgroundColor: SKIN }]} />
      <View style={[styles.forearm, styles.forearmRight, { backgroundColor: SKIN }]} />

      {/* ── Score glow ── */}
      <View style={[styles.scoreGlow, { backgroundColor: accentColor + "28" }]} />
    </View>
  );
}

// ─── Layout constants ───────────────────────────────────────────────────────
const HIP_Y   = 220;   // hip level from top of scene
const DESK_Y  = 185;   // desk surface y from top (above hips = person sits at desk)

const styles = StyleSheet.create({
  scene: {
    width: 260,
    height: 340,
    position: "relative",
  },

  // ── Desk ──
  deskSurface: {
    position: "absolute",
    top: DESK_Y,
    left: 0,
    right: 0,
    height: 12,
    borderRadius: 4,
  },
  deskEdge: {
    position: "absolute",
    top: DESK_Y + 12,
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    opacity: 0.6,
  },
  deskLeg: {
    position: "absolute",
    top: DESK_Y + 16,
    width: 10,
    height: 110,
    borderRadius: 4,
  },

  // ── Chair ──
  chairSeat: {
    position: "absolute",
    top: HIP_Y + 8,
    left: 42,
    right: 42,
    height: 10,
    borderRadius: 4,
    backgroundColor: CHAIR_COL,
  },
  chairBackrest: {
    position: "absolute",
    // Sits behind the torso – centred, from seat level up
    top: HIP_Y - 72,
    left: 113,
    width: 34,
    height: 80,
    borderRadius: 6,
    backgroundColor: CHAIR_COL,
    opacity: 0.55,
  },
  chairLeg: {
    position: "absolute",
    top: HIP_Y + 18,
    width: 8,
    height: 90,
    borderRadius: 3,
    backgroundColor: CHAIR_DARK,
  },

  // ── Figure root ──
  figureRoot: {
    position: "absolute",
    top: HIP_Y,
    left: 0,
    right: 0,
    alignItems: "center",
  },

  // ── Upper body group ──
  upperBodyGroup: {
    alignItems: "center",
    position: "absolute",
    top: -TORSO_HEIGHT,
    width: SHOULDER_WIDTH + 44,
  },
  torso: {
    position: "absolute",
    bottom: 0,
    width: TORSO_WIDTH,
    height: TORSO_HEIGHT,
    borderRadius: 7,
  },
  shoulderRow: {
    position: "absolute",
    top: -(SHOULDER_HEIGHT / 2),
    alignItems: "center",
    width: SHOULDER_WIDTH + 44,
  },
  shoulderBar: {
    width: SHOULDER_WIDTH,
    height: SHOULDER_HEIGHT,
    borderRadius: 6,
  },
  upperArm: {
    position: "absolute",
    width: 11,
    height: 36,
    borderRadius: 5,
    top: SHOULDER_HEIGHT,
  },
  upperArmLeft: {
    left: 6,
    transform: [{ rotate: "22deg" }],
  },
  upperArmRight: {
    right: 6,
    transform: [{ rotate: "-22deg" }],
  },
  neck: {
    position: "absolute",
    top: -(HEAD_SIZE * 0.25 + 14),
    width: 11,
    height: 18,
    borderRadius: 5,
  },
  headWrapper: {
    position: "absolute",
    top: -(HEAD_SIZE + HEAD_SIZE * 0.25 + 14),
    alignItems: "center",
  },
  hair: {
    position: "absolute",
    top: 0,
    width: HEAD_SIZE,
    height: HEAD_SIZE * 0.55,
    borderTopLeftRadius: HEAD_SIZE / 2,
    borderTopRightRadius: HEAD_SIZE / 2,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  head: {
    width: HEAD_SIZE,
    height: HEAD_SIZE,
    borderRadius: HEAD_SIZE / 2,
  },

  // ── Hips ──
  hips: {
    position: "absolute",
    top: -8,
    width: 48,
    height: 14,
    borderRadius: 6,
  },

  // ── Thighs (horizontal on chair) ──
  thigh: {
    position: "absolute",
    top: 4,
    width: 38,
    height: 12,
    borderRadius: 5,
  },
  thighLeft: {
    left: 14,
  },
  thighRight: {
    right: 14,
  },

  // ── Lower legs ──
  lowerLeg: {
    position: "absolute",
    top: 16,
    width: 11,
    height: 68,
    borderRadius: 5,
  },
  lowerLegLeft: {
    left: 58,
  },
  lowerLegRight: {
    right: 58,
  },

  // ── Feet ──
  foot: {
    position: "absolute",
    top: 82,
    width: 18,
    height: 9,
    borderRadius: 4,
  },
  footLeft: {
    left: 54,
  },
  footRight: {
    right: 54,
  },

  // ── Forearms on desk ──
  forearm: {
    position: "absolute",
    top: DESK_Y + 2,
    width: 38,
    height: 11,
    borderRadius: 5,
  },
  forearmLeft: {
    left: 60,
  },
  forearmRight: {
    right: 60,
  },

  // ── Laptop ──
  laptopBase: {
    position: "absolute",
    top: DESK_Y - 9,
    left: 88,
    right: 88,
    height: 9,
    borderRadius: 3,
    backgroundColor: LAPTOP_BODY,
  },
  laptopScreen: {
    position: "absolute",
    top: DESK_Y - 62,
    left: 84,
    right: 84,
    height: 52,
    borderRadius: 5,
    backgroundColor: LAPTOP_BODY,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  screenBezel: {
    position: "absolute",
    inset: 3,
    borderRadius: 3,
    backgroundColor: SCREEN_BG,
  },
  screenGlow: {
    position: "absolute",
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 2,
    backgroundColor: SCREEN_GLOW,
    opacity: 0.22,
  },
  screenCamera: {
    position: "absolute",
    top: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#546E7A",
  },

  // ── Score glow ──
  scoreGlow: {
    position: "absolute",
    bottom: 2,
    alignSelf: "center",
    width: 150,
    height: 18,
    borderRadius: 75,
  },
});
