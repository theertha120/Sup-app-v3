import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFonts } from "expo-font";
import { colours } from "@/theme/colours";
import type { WeeklyGoalId } from "@/src/services/user/behaviorProfileService";
import React from "react";

const GOALS: { id: WeeklyGoalId; label: string }[] = [
  { id: "3_resets_per_day", label: "complete 3 posture resets/day" },
  { id: "reduce_slouching_sessions", label: "reduce slouching sessions" },
  { id: "awareness_only", label: "build awareness only" },
];

export default function WeeklyGoalStep({
  value,
  onChange,
}: {
  value: WeeklyGoalId[];
  onChange: (value: WeeklyGoalId[]) => void;
}) {
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  if (!fontsLoaded) return null;

  return (
    <View style={styles.step}>
      <Text style={styles.title}>What is your weekly goal?</Text>
      <View style={styles.options}>
        {GOALS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={value.includes(option.id)}
            onPress={() => {
              if (value.includes(option.id)) {
                onChange(value.filter((id) => id !== option.id));
              } else {
                onChange([...value, option.id]);
              }
            }}
          />
        ))}
      </View>

      {/* custom weekly goal removed */}
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
  customField: {
    gap: 8,
  },
  customLabel: {
    fontSize: 13,
    fontFamily: "Agrandir-Regular",
    color: colours.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: "#AB99FA",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#1D014A",
    fontSize: 15,
    fontFamily: "Agrandir-Regular",
  },
});