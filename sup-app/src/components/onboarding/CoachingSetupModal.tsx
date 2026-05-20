import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colours } from "@/theme/colours";
import ActiveHoursStep from "./ActiveHoursStep";
import GoalSelectionStep from "./GoalSelectionStep";
import ReminderPreferencesStep from "./ReminderPreferencesStep";
import WeeklyGoalStep from "./WeeklyGoalStep";
import {
  type ActiveTimePreset,
  type BehaviorGoalId,
  type BehaviorProfileInput,
  type BehaviorProfile,
  type ReminderFrequency,
  type ReminderTone,
  type WeeklyGoalId,
  createDefaultBehaviorProfile,
  getPresetBehaviorHours,
  saveCurrentBehaviorProfile,
} from "@/src/services/user/behaviorProfileService";

type StepId = 0 | 1 | 2 | 3;

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export default function CoachingSetupModal({
  visible,
  onComplete,
  initialProfile,
}: {
  visible: boolean;
  onComplete: () => void;
  initialProfile?: BehaviorProfile | null;
}) {
  const defaults = useMemo(() => createDefaultBehaviorProfile(), []);
  const [step, setStep] = useState<StepId>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Prefill from `initialProfile` when editing from settings
  const initial = initialProfile ?? null;

  const inferPreset = (start: string, end: string): ActiveTimePreset => {
    const candidates: ActiveTimePreset[] = [
      "morning",
      "afternoon",
      "evening",
      "late_night",
    ];
    for (const p of candidates) {
      const r = getPresetBehaviorHours(p);
      if (r.start === start && r.end === end) return p;
    }
    return "afternoon";
  };

  const [primaryGoal, setPrimaryGoal] = useState<BehaviorGoalId>(
    initial ? initial.primaryGoal : defaults.primaryGoal
  );
  const [preset, setPreset] = useState<ActiveTimePreset>(
    initial ? inferPreset(initial.activeTimeStart, initial.activeTimeEnd) : "afternoon"
  );
  const [activeTimeStart, setActiveTimeStart] = useState(
    initial ? initial.activeTimeStart : defaults.activeTimeStart
  );
  const [activeTimeEnd, setActiveTimeEnd] = useState(
    initial ? initial.activeTimeEnd : defaults.activeTimeEnd
  );
  const [preferredTone, setPreferredTone] = useState<ReminderTone>(
    initial ? initial.preferredTone : defaults.preferredTone
  );
  const [reminderFrequency, setReminderFrequency] = useState<ReminderFrequency>(
    initial ? initial.reminderFrequency : defaults.reminderFrequency
  );
  const [weeklyGoal, setWeeklyGoal] = useState<WeeklyGoalId>(
    initial ? initial.weeklyGoal : defaults.weeklyGoal
  );

  if (!visible) return null;

  const canGoBack = step > 0;
  const isLastStep = step === 3;

  const applyPreset = (nextPreset: ActiveTimePreset) => {
    setPreset(nextPreset);
    const range = getPresetBehaviorHours(nextPreset);
    setActiveTimeStart(range.start);
    setActiveTimeEnd(range.end);
  };

  const buildProfileInput = (): BehaviorProfileInput => ({
    primaryGoal,
    preferredTone,
    reminderFrequency,
    activeTimeStart: getPresetBehaviorHours(preset).start,
    activeTimeEnd: getPresetBehaviorHours(preset).end,
    weeklyGoal,
  });

  const handleNext = async () => {
    setError("");

    if (step < 3) {
      setStep((current) => ((current + 1) as StepId));
      return;
    }

    const profile = buildProfileInput();

    if (!isValidTime(profile.activeTimeStart) || !isValidTime(profile.activeTimeEnd)) {
      setError("Use 24-hour time like 09:00 and 17:00.");
      return;
    }

    setSaving(true);
    try {
      await saveCurrentBehaviorProfile(profile);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your setup.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.kicker}>Coaching setup</Text>
              <Text style={styles.title}>Set up your behaviour engine</Text>
            </View>
          </View>

          <View style={styles.progressRow}>
            {[0, 1, 2, 3].map((index) => (
              <View
                key={index}
                style={[styles.progressDot, step >= index && styles.progressDotActive]}
              />
            ))}
          </View>

          <View style={styles.body}>
            {step === 0 ? (
              <GoalSelectionStep value={primaryGoal} onChange={setPrimaryGoal} />
            ) : null}
            {step === 1 ? (
              <ActiveHoursStep
                preset={preset}
                activeTimeStart={activeTimeStart}
                activeTimeEnd={activeTimeEnd}
                onPresetChange={applyPreset}
                onStartTimeChange={setActiveTimeStart}
                onEndTimeChange={setActiveTimeEnd}
              />
            ) : null}
            {step === 2 ? (
              <ReminderPreferencesStep
                tone={preferredTone}
                frequency={reminderFrequency}
                onToneChange={setPreferredTone}
                onFrequencyChange={setReminderFrequency}
              />
            ) : null}
            {step === 3 ? (
              <WeeklyGoalStep
                value={weeklyGoal}
                onChange={setWeeklyGoal}
              />
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.footer}>

            <View style={styles.primaryActions}>
              {canGoBack ? (
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => setStep((current) => ((current - 1) as StepId))}
                  disabled={saving}
                >
                  <Text style={styles.primaryButtonText}>Back</Text>
                </Pressable>
              ) : null}

              <Pressable style={styles.primaryButton} onPress={handleNext} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isLastStep ? "Complete setup" : "Next"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(20, 20, 35, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 28,
    backgroundColor: "#F8F6FF",
    padding: 20,
    gap: 18,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  kicker: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  title: {
    color: colours.textPrimary,
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  close: {
    color: colours.textSecondary,
    fontSize: 18,
    fontWeight: "700",
  },
  progressRow: {
    flexDirection: "row",
    gap: 8,
  },
  progressDot: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(24, 24, 36, 0.12)",
  },
  progressDotActive: {
    backgroundColor: colours.primary,
  },
  body: {
    gap: 16,
  },
  error: {
    color: "#B42318",
    fontSize: 13,
    fontWeight: "600",
  },
  footer: {
    gap: 12,
  },
  primaryActions: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.primarySoft,
    backgroundColor: colours.primarySoft,
    paddingVertical: 15,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: colours.primary,
    fontSize: 15,
    fontWeight: "700",
  },
  primaryButton: {
    flex: 1.2,
    borderRadius: 16,
    backgroundColor: colours.primary,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});
