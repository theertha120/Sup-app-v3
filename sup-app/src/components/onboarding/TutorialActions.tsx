import PressFeedback from "@/src/components/ui/PressFeedback";
import React, { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colours } from "@/theme/colours";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { BrandAlert } from "@/src/components/ui/BrandAlert";

interface TutorialActionsProps {
  children?: ReactNode;
  onBeforeSkip?: () => void;
  skipDisabled?: boolean;
  /** Only show "exit" — used by "go to" prompts, where there's nothing to skip. */
  hideSkip?: boolean;
}

export default function TutorialActions({ children, onBeforeSkip, skipDisabled = false, hideSkip = false }: TutorialActionsProps) {
  const { tutorialStep, setTutorialStep, dismissTutorial } = useTutorial();
  const [confirmExit, setConfirmExit] = useState(false);

  const handleSkip = () => {
    if (skipDisabled || tutorialStep === null) return;
    onBeforeSkip?.();

    // Skip the whole page, including any remaining tips on that page.
    // Every page is reached via the header or navbar, so skipping shows the
    // "go to" prompt and the user opens the next page themselves.
    switch (tutorialStep) {
      case "goals-tip":
      case "data-tip":
        setTutorialStep("go-daily-tip");
        break;
      case "snapshot-tip":
      case "snapshot-tip-stats":
        setTutorialStep("go-settings-tip");
        break;
      case "settings-tip":
      case "coaching-tip":
        setTutorialStep("go-sensor-tip");
        break;
      case "figure-tip":
      case "supdate-tip":
      case "end-session-tip":
        setTutorialStep("go-stats-tip");
        break;
      case "stats-tip":
        setTutorialStep("go-community-tip");
        break;
      case "community-tip":
        setTutorialStep("add-friends-tip");
        break;
      case "add-friends-tip":
      case "header-settings-tip":
      case "header-sensor-tip":
      case "header-streak-tip":
        dismissTutorial();
        break;
      // Sensor setup retains its own existing skip controls, and "go to"
      // prompts hide the skip button.
      case "connect-tip":
      case "calibrate-tip":
      case "go-home-tip":
      case "go-daily-tip":
      case "go-settings-tip":
      case "go-sensor-tip":
      case "go-desk-tip":
      case "go-stats-tip":
      case "go-community-tip":
        break;
    }
  };

  return (
    <View style={styles.actions}>
      {children}
      <View style={[styles.row, hideSkip && styles.rowExitOnly]}>
        {!hideSkip && (
          <PressFeedback feedback="link" accessibilityRole="button" accessibilityLabel="Skip page" onPress={handleSkip} disabled={skipDisabled} style={styles.button}>
            <Text style={styles.text}>skip page</Text>
          </PressFeedback>
        )}
        <PressFeedback feedback="link" accessibilityRole="button" accessibilityLabel="Exit tutorial" onPress={() => setConfirmExit(true)} style={styles.button}>
          <Text style={styles.text}>exit</Text>
        </PressFeedback>
      </View>

      <BrandAlert
        visible={confirmExit}
        title="exit tutorial?"
        message="are you sure you want to exit the tutorial? you can replay it anytime from settings."
        onRequestClose={() => setConfirmExit(false)}
        buttons={[
          { text: "keep going", style: "cancel" },
          { text: "exit", style: "destructive", onPress: dismissTutorial },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { alignSelf: "stretch", marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rowExitOnly: { justifyContent: "flex-end" },
  button: { minHeight: 32, justifyContent: "center" },
  text: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },
});
