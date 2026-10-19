import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import PressFeedback from "@/src/components/ui/PressFeedback";
import { captureRenderError } from "@/src/lib/sentry";

const PRIMARY_TEXT = "#1D014A";

/**
 * Re-export as `ErrorBoundary` from a route file. Expo Router renders it in
 * place of that screen when it throws during render, so a crash on one tab is
 * reported to Sentry instead of taking down the whole app.
 */
export default function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureRenderError(error);
  }, [error]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>something went wrong</Text>
      <Text style={styles.body}>we&apos;ve been notified. please try again in a moment, thank you for your patience.</Text>
      <PressFeedback feedback="scale" style={styles.button} onPress={retry}>
        <Text style={styles.buttonText}>try again</Text>
      </PressFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
    backgroundColor: "rgba(211, 193, 231, 0.64)",
  },
  title: { fontSize: 20, fontWeight: "700", color: PRIMARY_TEXT },
  body: { fontSize: 14, color: PRIMARY_TEXT, opacity: 0.8, textAlign: "center" },
  button: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, backgroundColor: "#AB99FA" },
  buttonText: { fontSize: 16, fontWeight: "600", color: "white" },
});
