import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colours } from "@/theme/colours";

interface TutorialActionsProps {
  children?: ReactNode;
}

// Layout only for now; Skip page and Exit will be wired in a separate change.
export default function TutorialActions({ children }: TutorialActionsProps) {
  return (
    <View style={styles.actions}>
      {children}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Skip page" style={styles.button}>
          <Text style={styles.text}>skip page</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit tutorial" style={styles.button}>
          <Text style={styles.text}>exit</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { alignSelf: "stretch", marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  button: { minHeight: 32, justifyContent: "center" },
  text: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },
});
