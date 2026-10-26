import React, { createContext, useContext } from "react";
import { Text as NativeText, StyleSheet, Platform, type TextProps } from "react-native";

export const CommunityFonts = createContext(false);

/** Font loading is cosmetic; Community must remain visible and readable. */
export function CommunityText({ style, ...props }: TextProps) {
  const ready = useContext(CommunityFonts);
  const flat = StyleSheet.flatten(style);
  return <NativeText {...props} style={[style, !ready && {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    fontWeight: flat?.fontFamily === "Agrandir-GrandHeavy" ? "700" : flat?.fontWeight ?? "400",
  }]} />;
}
