import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFonts } from "expo-font";
import { colours } from "@/theme/colours";
import type { ActiveTimePreset } from "@/src/services/user/behaviorProfileService";
import React from "react";

const PRESETS: { id: ActiveTimePreset; label: string }[] = [
  { id: "morning", label: "morning" },
  { id: "afternoon", label: "afternoon" },
  { id: "evening", label: "evening" },
  { id: "late_night", label: "late night" },
];

export default function ActiveHoursStep({
  presets,
  onPresetsChange,
}: {
  presets: ActiveTimePreset[];
  onPresetsChange: (value: ActiveTimePreset[]) => void;
}) {
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  if (!fontsLoaded) return null;

  return (
    <View style={styles.step}>
      <Text style={styles.title}>When do you usually need reminders?</Text>
      <View style={styles.options}>
        {PRESETS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={presets.includes(option.id)}
            onPress={() => {
              if (presets.includes(option.id)) {
                onPresetsChange(presets.filter((id) => id !== option.id));
              } else {
                onPresetsChange([...presets, option.id]);
              }
            }}
          />
        ))}
      </View>

      {/* custom time range removed — only presets shown */}
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
  customRange: {
    flexDirection: "row",
    gap: 12,
  },
  timeField: {
    flex: 1,
    gap: 8,
  },
  timeLabel: {
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