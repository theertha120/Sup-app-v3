import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colours } from "@/theme/colours";
import type { ActiveTimePreset } from "@/src/services/user/behaviorProfileService";

const PRESETS: { id: ActiveTimePreset; label: string }[] = [
  { id: "morning", label: "morning" },
  { id: "afternoon", label: "afternoon" },
  { id: "evening", label: "evening" },
  { id: "late_night", label: "late night" },
  
];

export default function ActiveHoursStep({
  preset,
  activeTimeStart,
  activeTimeEnd,
  onPresetChange,
  onStartTimeChange,
  onEndTimeChange,
}: {
  preset: ActiveTimePreset;
  activeTimeStart: string;
  activeTimeEnd: string;
  onPresetChange: (value: ActiveTimePreset) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
}) {
  return (
    <View style={styles.step}>
      <Text style={styles.title}>When do you usually need reminders?</Text>
      <View style={styles.options}>
        {PRESETS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={preset === option.id}
            onPress={() => onPresetChange(option.id)}
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
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colours.textPrimary,
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
    borderColor: colours.border,
    backgroundColor: "#FFFFFF",
  },
  chipSelected: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  chipLabel: {
    color: colours.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  chipLabelSelected: {
    color: "#FFFFFF",
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
    fontWeight: "600",
    color: colours.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colours.border,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colours.textPrimary,
    fontSize: 15,
  },
});
