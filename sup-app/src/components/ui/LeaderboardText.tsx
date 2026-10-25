import React, { createContext, useContext } from "react";
import { Platform, StyleSheet, Text as NativeText, type TextProps } from "react-native";

export const LeaderboardFontsContext = createContext(false);

/** Ranking content must remain readable when custom font assets are unavailable. */
export function LeaderboardText({ style, ...props }: TextProps) {
  const ready = useContext(LeaderboardFontsContext);
  const flat = StyleSheet.flatten(style);
  return <NativeText {...props} style={[style, !ready && {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    fontWeight: flat?.fontFamily === "Agrandir-GrandHeavy" ? "700" : (flat?.fontWeight ?? "400"),
  }]} />;
}
