import PressFeedback from "@/src/components/ui/PressFeedback";
import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colours } from "@/theme/colours";
import { useRouter } from "expo-router";
import { useTutorial } from "@/src/contexts/TutorialContext";

interface TutorialActionsProps {
  children?: ReactNode;
  onBeforeSkip?: () => void;
  skipDisabled?: boolean;
}

export default function TutorialActions({ children, onBeforeSkip, skipDisabled = false }: TutorialActionsProps) {
  const router = useRouter();
  const { tutorialStep, setTutorialStep, dismissTutorial } = useTutorial();

  const handleSkip = () => {
    if (skipDisabled || tutorialStep === null) return;
    onBeforeSkip?.();

    // Skip the whole page, including any remaining tips on that page.
    switch (tutorialStep) {
      case "goals-tip":
      case "data-tip":
        setTutorialStep("snapshot-tip");
        router.push("/(tabs)/daily");
        break;
      case "snapshot-tip":
      case "snapshot-tip-stats":
        setTutorialStep("settings-tip");
        router.push("/settings");
        break;
      case "settings-tip":
      case "coaching-tip":
        setTutorialStep("connect-tip");
        router.push("/sensor-setup");
        break;
      case "figure-tip":
      case "supdate-tip":
      case "end-session-tip":
        setTutorialStep("stats-tip");
        router.replace("/(tabs)/stats");
        break;
      case "stats-tip":
      case "stats-tip-trend":
      case "stats-tip-session":
      case "stats-tip-breakdown":
        setTutorialStep("community-tip");
        router.replace("/(tabs)/leaderboard");
        break;
      case "community-tip":
      case "community-tip-full":
        setTutorialStep("add-friends-tip");
        break;
      case "add-friends-tip":
        dismissTutorial();
        break;
      // Sensor setup retains its own existing skip controls.
      case "connect-tip":
      case "calibrate-tip":
        break;
    }
  };

  return (
    <View style={styles.actions}>
      {children}
      <View style={styles.row}>
        <PressFeedback feedback="link" accessibilityRole="button" accessibilityLabel="Skip page" onPress={handleSkip} disabled={skipDisabled} style={styles.button}>
          <Text style={styles.text}>skip page</Text>
        </PressFeedback>
        <PressFeedback feedback="link" accessibilityRole="button" accessibilityLabel="Exit tutorial" onPress={dismissTutorial} style={styles.button}>
          <Text style={styles.text}>exit</Text>
        </PressFeedback>
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
