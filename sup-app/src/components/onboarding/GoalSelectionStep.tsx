import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFonts } from "expo-font";
import type { BehaviorGoalId } from "@/src/services/user/behaviorProfileService";
import React from "react";

const GOALS: { id: BehaviorGoalId; label: string }[] = [
  { id: "study_posture", label: "better study posture" },
  { id: "less_back_discomfort", label: "more comfortable sitting" },
  { id: "desk_posture", label: "desk posture" },
  { id: "pilates_form_awareness", label: "pilates/form awareness" },
  { id: "general_posture_awareness", label: "general posture awareness" },
];

export default function GoalSelectionStep({
  value,
  onChange,
}: {
  value: BehaviorGoalId[];
  onChange: (value: BehaviorGoalId[]) => void;
}) {
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  if (!fontsLoaded) return null;

  return (
    <View style={styles.step}>
      <Text style={styles.title}>What do you want help with?</Text>
      <View style={styles.options}>
        {GOALS.map((goal) => (
          <Chip
            key={goal.id}
            label={goal.label}
            selected={value.includes(goal.id)}
            onPress={() => {
              if (value.includes(goal.id)) {
                onChange(value.filter((id) => id !== goal.id));
              } else {
                onChange([...value, goal.id]);
              }
            }}
          />
        ))}
      </View>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#1D014A",
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#AB99FA",
    backgroundColor: "#FFFFFF",
  },
  chipSelected: {
    backgroundColor: "#AB99FA",
    borderColor: "#AB99FA",
  },
  chipLabel: {
    color: "#1D014A",
    fontSize: 13,
    fontFamily: "Agrandir-Regular",
  },
  chipLabelSelected: {
    color: "#1D014A",
    fontFamily: "Agrandir-Regular",
  },
});