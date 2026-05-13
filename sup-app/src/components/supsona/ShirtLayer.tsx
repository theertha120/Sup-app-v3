// Shirt Layer
import React from "react";
import Svg, { Circle } from "react-native-svg";
import type { ShirtColourId } from "./supsona";
import { SHIRT_COLOR_MAP } from "./supsonaColors";

const VIEWBOX = "0 0 100 120";

interface ShirtLayerProps {
  shirtColour: ShirtColourId;
  width: number;
  height: number;
}

export default function ShirtLayer({
  shirtColour,
  width,
  height,
}: ShirtLayerProps) {
  const fill = SHIRT_COLOR_MAP[shirtColour];

  return (
    <Svg
      viewBox={VIEWBOX}
      width={width}
      height={height}
      style={{ position: "absolute" }}
    >
      {/* Circular torso */}
      <Circle cx={50} cy={100} r={30} fill={fill} />
    </Svg>
  );
}