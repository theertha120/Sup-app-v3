import React from "react";
import Svg, { Path, Ellipse } from "react-native-svg";
import type { HairStyleId, HairColourId } from "../../types/supsona";
import { HAIR_COLOR_MAP } from "./supsonaColors";

const VIEWBOX = "0 0 100 120";

interface HairLayerProps {
  hairStyle: HairStyleId;
  hairColour: HairColourId;
  width: number;
  height: number;
}

export default function HairLayer({
  hairStyle,
  hairColour,
  width,
  height,
}: HairLayerProps) {
  const fill = HAIR_COLOR_MAP[hairColour];

  const renderHair = () => {
    switch (hairStyle) {
      /** ---------------- SHORT ---------------- */
      case "short":
        return (
          <Path
            d="
              M 18 38
              Q 18 20 50 18
              Q 82 20 82 38
              L 82 60
              Q 70 34 50 34
              Q 30 34 18 60
              Z
            "
            fill={fill}
          />
        );

      /** ---------------- LONG STRAIGHT ---------------- */
      case "long-straight":
        return (
          <Path
            d="
              M 18 36
              Q 18 18 50 16
              Q 82 18 82 36
              L 90 112
              L 78 112
              L 64 42
              Q 58 36 50 36
              Q 42 36 36 42
              L 20 112
              L 10 112
              Z
            "
            fill={fill}
          />
        );

      /** ---------------- CURLY ---------------- */
      case "curly":
        return (
          <Path
            d="
              M 18 36
              Q 18 16 50 14
              Q 82 16 82 36
              Q 18 50 18 36
              Z
            "
            fill={fill}
          />
        );

      default:
        return null;
    }
  };

  return (
    <Svg
      viewBox={VIEWBOX}
      width={width}
      height={height}
      style={{ position: "absolute" }}
    >
      {renderHair()}
    </Svg>
  );
}