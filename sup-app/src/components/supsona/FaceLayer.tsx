// Face Layer
import React from "react";
import Svg, { Ellipse, Path, G } from "react-native-svg";
import type { FaceShapeId, SkinToneId } from "../../types/supsona";
import { SKIN_TONE_MAP } from "./supsonaColors";

const VIEWBOX = "0 0 100 120";
const FACE_CX = 50;
const FACE_CY = 58;

interface FaceLayerProps {
  faceShape: FaceShapeId;
  skinTone: SkinToneId;
  width: number;
  height: number;
}

export default function FaceLayer({
  faceShape,
  skinTone,
  width,
  height,
}: FaceLayerProps) {
  const fill = SKIN_TONE_MAP[skinTone];
  const eyeColor = "#2E2E2E";
  const mouthColor = "#6B3E3E";

  const renderFaceShape = () => {
    if (faceShape === "round") {
      return <Ellipse cx={FACE_CX} cy={FACE_CY} rx={32} ry={34} fill={fill} />;
    }
    if (faceShape === "oval") {
      return <Ellipse cx={FACE_CX} cy={FACE_CY} rx={28} ry={38} fill={fill} />;
    }

    // soft-square
    return (
      <Path
        d="M 22 28
           Q 100 22 28 22 
           L 72 22 
           Q 10 22 78 28 
           L 78 88 
           Q 78 94 72 94 
           L 28 94 
           Q 22 94 22 88 
           Z"
        fill={fill}
      />
    );
  };

  const renderEyes = () => {
    const eyeY = faceShape === "oval" ? 52 : 50;

    return (
      <>
        {/* Left eye */}
        <Ellipse cx={40} cy={eyeY} rx={4} ry={5} fill="#FFFFFF" />
        <Ellipse cx={40} cy={eyeY + 1} rx={2} ry={3} fill={eyeColor} />

        {/* Right eye */}
        <Ellipse cx={60} cy={eyeY} rx={4} ry={5} fill="#FFFFFF" />
        <Ellipse cx={60} cy={eyeY + 1} rx={2} ry={3} fill={eyeColor} />
      </>
    );
  };

  const renderMouth = () => {
    const mouthY = faceShape === "oval" ? 72 : 70;

    return (
      <Path
        d={`M 42 ${mouthY} Q 50 ${mouthY + 6} 58 ${mouthY}`}
        stroke={mouthColor}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    );
  };

  return (
    <Svg
      viewBox={VIEWBOX}
      width={width}
      height={height}
      style={{ position: "absolute" }}
    >
      {renderFaceShape()}

      {/* Facial features */}
      <G>
        {renderEyes()}
        {renderMouth()}
      </G>
    </Svg>
  );
}