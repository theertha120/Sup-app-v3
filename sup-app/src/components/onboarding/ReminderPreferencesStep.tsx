import { Pressable, StyleSheet, Text, View } from "react-native";
import { colours } from "@/theme/colours";
import type { ReminderFrequency, ReminderTone } from "@/src/services/user/behaviorProfileService";

const TONES: { id: ReminderTone; label: string }[] = [
  { id: "gentle", label: "gentle" },
  { id: "cute", label: "cute" },
  { id: "direct", label: "direct" },
  { id: "funny", label: "funny" },
  { id: "coach_like", label: "coach-like" },
];

const FREQUENCIES: { id: ReminderFrequency; label: string }[] = [
  { id: "light", label: "light" },
  { id: "medium", label: "medium" },
  { id: "active", label: "active" },
  
];

export default function ReminderPreferencesStep({
  tones,
  frequency,
  onTonesChange,
  onFrequencyChange,
}: {
  tones: ReminderTone[];
  frequency: ReminderFrequency;
  onTonesChange: (value: ReminderTone[]) => void;
  onFrequencyChange: (value: ReminderFrequency) => void;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.group}>
        <Text style={styles.title}>What reminder style do you prefer?</Text>
        <View style={styles.options}>
          {TONES.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              selected={tones.includes(option.id)}
              onPress={() => {
                if (tones.includes(option.id)) {
                  onTonesChange(tones.filter((id) => id !== option.id));
                } else {
                  onTonesChange([...tones, option.id]);
                }
              }}
            />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.title}>How often do you want reminders?</Text>
        <View style={styles.options}>
          {FREQUENCIES.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              selected={frequency === option.id}
              onPress={() => onFrequencyChange(option.id)}
            />
          ))}
        </View>
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
    gap: 18,
  },
  group: {
    gap: 12,
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
