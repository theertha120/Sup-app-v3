import React from "react";
import { View, Text, StyleSheet, ViewStyle, TextStyle } from "react-native";
import type { Supsona } from "./supsona";
import { parseSupsona, isSupsonaAvatar, DEFAULT_SUPSONA } from "./supsona";
import FaceLayer from "./FaceLayer";
import HairLayer from "./HairLayer";
import ShirtLayer from "./ShirtLayer";
import { colours } from "../../../theme/colours";

interface SupsonaAvatarProps {
  /** If provided, parse as supsona JSON; otherwise show default. */
  avatar?: string | null;
  /** Fallback initials when no supsona (e.g. "JD"). Shown inside default avatar. */
  initials?: string;
  size?: number;
  style?: ViewStyle;
}

/**
 * Renders either a custom supsona (stacked SVG layers) or a default avatar (circle + initials).
 */
export default function SupsonaAvatar({
  avatar,
  initials = "?",
  size = 64,
  style,
}: SupsonaAvatarProps) {
  const supsona = parseSupsona(avatar ?? undefined) ?? DEFAULT_SUPSONA;

  return (
    <View style={[styles.wrapper, { width: size, height: size }, style]}>
      {/* Stack order: shirt (back), face, hair (front) */}
      <ShirtLayer shirtColour={supsona.shirtColour} width={size} height={size} />
      <FaceLayer faceShape={supsona.faceShape} skinTone={supsona.skinTone} width={size} height={size} />
      <HairLayer hairStyle={supsona.hairStyle} hairColour={supsona.hairColour} width={size} height={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: "hidden",
    borderRadius: 9999,
  },
});

/**
 * Default avatar when user has no supsona saved: circle with initials (Duolingo-style placeholder).
 */
export function DefaultAvatar({
  initials,
  size = 64,
  style,
  textStyle,
  backgroundColor = colours.primary,
}: {
  initials: string;
  size?: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
  backgroundColor?: string;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
        },
        style,
      ]}
    >
      <Text
        style={[
          {
            fontSize: size * 0.4,
            color: backgroundColor === colours.primary ? "white" : colours.primary,
          },
          textStyle,
        ]}
        numberOfLines={1}
      >
        {initials}
      </Text>
    </View>
  );
}

/**
 * Chooses SupsonaAvatar (if user has saved supsona) or DefaultAvatar (initials).
 */
export function UserSupsonaAvatar({
  avatar,
  name,
  size = 64,
  style,
  textStyle,
  defaultAvatarBackgroundColor,
}: {
  avatar?: string | null;
  name: string;
  size?: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
  /** Background colour for the default (initials) avatar when no supsona is set. */
  defaultAvatarBackgroundColor?: string;
}) {
  const hasSupsona = isSupsonaAvatar(avatar);
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  if (hasSupsona) {
    return <SupsonaAvatar avatar={avatar!} size={size} style={style} />;
  }
  return (
    <DefaultAvatar
      initials={initials || "?"}
      size={size}
      style={style}
      textStyle={textStyle}
      backgroundColor={defaultAvatarBackgroundColor}
    />
  );
}
