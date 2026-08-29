import React from "react";
import { Dimensions, StyleSheet } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Ellipse } from "react-native-svg";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

export default function BackgroundBlobs() {
  return (
    <Svg
      width={SCREEN_W}
      height={SCREEN_H}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient id="g1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <Stop offset="0%"   stopColor="rgba(225, 163, 175, 1)" stopOpacity="1" />
          <Stop offset="50%"  stopColor="rgba(225, 163, 175, 1)" stopOpacity="0.9" />
          <Stop offset="100%" stopColor="rgba(225, 163, 175, 0)" stopOpacity="0"   />
        </RadialGradient>
        <RadialGradient id="g2" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <Stop offset="0%"   stopColor="rgba(179, 163, 225, 1)" stopOpacity="1" />
          <Stop offset="50%"  stopColor="rgba(179, 163, 225, 1)" stopOpacity="0.9" />
          <Stop offset="100%" stopColor="rgba(179, 163, 225, 0)" stopOpacity="0"   />
        </RadialGradient>
        <RadialGradient id="g3" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <Stop offset="0%"   stopColor="rgba(163, 218, 225, 1)" stopOpacity="1" />
          <Stop offset="50%"  stopColor="rgba(163, 218, 225, 1)" stopOpacity="0.9" />
          <Stop offset="100%" stopColor="rgba(163, 218, 225, 0)" stopOpacity="0"   />
        </RadialGradient>
      </Defs>

      <Ellipse
        cx={SCREEN_W * 0.78}
        cy={SCREEN_H * 0.12}
        rx={220}
        ry={220}
        fill="url(#g1)"
      />
      <Ellipse
        cx={SCREEN_W * 0.08}
        cy={SCREEN_H * 0.45}
        rx={190}
        ry={190}
        fill="url(#g2)"
      />
      <Ellipse
        cx={SCREEN_W * 0.85}
        cy={SCREEN_H * 0.82}
        rx={210}
        ry={210}
        fill="url(#g3)"
      />
    </Svg>
  );
}
