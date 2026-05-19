import { Pressable, StyleSheet, Text, View } from "react-native";
import { colours } from "@/theme/colours";
import type { BehaviorGoalId } from "@/src/services/user/behaviorProfileService";

const GOALS: { id: BehaviorGoalId; label: string }[] = [
  { id: "study_posture", label: "better study posture" },
  { id: "less_back_discomfort", label: "less back discomfort" },
  { id: "desk_posture", label: "desk posture" },
  { id: "pilates_form_awareness", label: "Pilates/form awareness" },
  { id: "general_posture_awareness", label: "general posture awareness" },
];

export default function GoalSelectionStep({
  value,
  onChange,
}: {
  value: BehaviorGoalId;
  onChange: (value: BehaviorGoalId) => void;
}) {
  return (
    <View style={styles.step}>
      <Text style={styles.title}>What do you want help with?</Text>
      <View style={styles.options}>
        {GOALS.map((goal) => (
          <Chip
            key={goal.id}
            label={goal.label}
            selected={value === goal.id}
            onPress={() => onChange(goal.id)}
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
});
