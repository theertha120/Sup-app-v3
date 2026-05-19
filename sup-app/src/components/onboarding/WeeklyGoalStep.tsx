import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colours } from "@/theme/colours";
import type { WeeklyGoalId } from "@/src/services/user/behaviorProfileService";

const GOALS: { id: WeeklyGoalId; label: string }[] = [
  { id: "3_resets_per_day", label: "complete 3 posture resets/day" },
  { id: "reduce_slouching_sessions", label: "reduce slouching sessions" },
  { id: "awareness_only", label: "build awareness only" },
  { id: "custom", label: "custom" },
];

export default function WeeklyGoalStep({
  value,
  customValue,
  onChange,
  onCustomValueChange,
}: {
  value: WeeklyGoalId;
  customValue: string;
  onChange: (value: WeeklyGoalId) => void;
  onCustomValueChange: (value: string) => void;
}) {
  return (
    <View style={styles.step}>
      <Text style={styles.title}>What is your weekly goal?</Text>
      <View style={styles.options}>
        {GOALS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={value === option.id}
            onPress={() => onChange(option.id)}
          />
        ))}
      </View>

      {value === "custom" ? (
        <View style={styles.customField}>
          <Text style={styles.customLabel}>Custom weekly goal</Text>
          <TextInput
            style={styles.input}
            value={customValue}
            onChangeText={onCustomValueChange}
            placeholder="e.g. stay consistent during exam week"
            placeholderTextColor="#8D8D8D"
          />
        </View>
      ) : null}
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
  customField: {
    gap: 8,
  },
  customLabel: {
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
