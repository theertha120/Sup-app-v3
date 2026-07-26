import { useMemo, useState } from "react";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFonts } from "expo-font";
import { colours } from "@/theme/colours";
import ActiveHoursStep from "./ActiveHoursStep";
import GoalSelectionStep from "./GoalSelectionStep";
import ReminderPreferencesStep from "./ReminderPreferencesStep";
import WeeklyGoalStep from "./WeeklyGoalStep";
import DailyRunStep from "./DailyRunStep";
import {
  type ActiveTimePreset,
  type BehaviorGoalId,
  type BehaviorProfileInput,
  type BehaviorProfile,
  type ReminderFrequency,
  type ReminderTone,
  type WeeklyGoalId,
  createDefaultBehaviorProfile,
  resolveTimeRangeFromPresets,
  saveCurrentBehaviorProfile,
} from "@/src/services/user/behaviorProfileService";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepId = 0 | 1 | 2 | 3 | 4;

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function CoachingSetupModal({
  visible,
  onComplete,
  initialProfile,
}: {
  visible: boolean;
  onComplete: () => void;
  initialProfile?: BehaviorProfile | null;
}) {
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../../assets/fonts/Agrandir-GrandHeavy.otf")
  });

  const defaults = useMemo(() => createDefaultBehaviorProfile(), []);
  const [step, setStep] = useState<StepId>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const initial = initialProfile ?? null;

  const [primaryGoals, setPrimaryGoals] = useState<BehaviorGoalId[]>(
    initial ? initial.primaryGoals : defaults.primaryGoals
  );
  const [activeTimePresets, setActiveTimePresets] = useState<ActiveTimePreset[]>(
    initial ? initial.activeTimePresets : defaults.activeTimePresets
  );
  const [preferredTones, setPreferredTones] = useState<ReminderTone[]>(
    initial ? initial.preferredTones : defaults.preferredTones
  );
  const [reminderFrequency, setReminderFrequency] = useState<ReminderFrequency>(
    initial ? initial.reminderFrequency : defaults.reminderFrequency
  );
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoalId[]>(
    initial ? initial.weeklyGoals : defaults.weeklyGoals
  );
  // Default daily run to 9 AM (hour 9)
  const [dailyRunHour, setDailyRunHour] = useState<number>(
    initial && typeof (initial as any).dailyRun === "number"
      ? (initial as any).dailyRun
      : 8
  );

  if (!visible || !fontsLoaded) return null;

  const canGoBack = step > 0;
  const isLastStep = step === 4;

  const buildProfileInput = (): BehaviorProfileInput => {
    const { start, end } = resolveTimeRangeFromPresets(activeTimePresets);
    return {
      primaryGoals,
      preferredTones,
      reminderFrequency,
      activeTimePresets,
      activeTimeStart: start,
      activeTimeEnd: end,
      weeklyGoals,
    };
  };

  const handleNext = async () => {
    setError("");

    if (step === 0 && primaryGoals.length === 0) {
      setError("Please select at least one goal.");
      return;
    }
    if (step === 1 && activeTimePresets.length === 0) {
      setError("Please select at least one time period.");
      return;
    }
    if (step === 2 && preferredTones.length === 0) {
      setError("Please select at least one reminder style.");
      return;
    }
    if (step === 3 && weeklyGoals.length === 0) {
      setError("Please select at least one weekly goal.");
      return;
    }

    if (step < 4) {
      setStep((current) => (current + 1) as StepId);
      return;
    }

    const profile = buildProfileInput();

    setSaving(true);
    try {
      await saveCurrentBehaviorProfile(profile);
      // TODO: also persist `dailyRunHour` to `user_profile.daily_run` via Supabase here
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your setup.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.kicker}>Coaching setup</Text>
              <Text style={styles.title}>Set up your behaviour engine</Text>
            </View>
          </View>

          {/* Progress */}
          <View style={styles.progressRow}>
            {[0, 1, 2, 3, 4].map((index) => (
              <View
                key={index}
                style={[
                  styles.progressDot,
                  step >= index && styles.progressDotActive,
                ]}
              />
            ))}
          </View>

          {/* Step content */}
          <View style={styles.body}>
            {step === 0 && (
              <GoalSelectionStep value={primaryGoals} onChange={setPrimaryGoals} />
            )}
            {step === 1 && (
              <ActiveHoursStep
                presets={activeTimePresets}
                onPresetsChange={setActiveTimePresets}
              />
            )}
            {step === 2 && (
              <ReminderPreferencesStep
                tones={preferredTones}
                frequency={reminderFrequency}
                onTonesChange={setPreferredTones}
                onFrequencyChange={setReminderFrequency}
              />
            )}
            {step === 3 && (
              <WeeklyGoalStep value={weeklyGoals} onChange={setWeeklyGoals} />
            )}
            {step === 4 && (
              <DailyRunStep value={dailyRunHour} onChange={setDailyRunHour} />
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={styles.primaryActions}>
              {canGoBack && (
                <Pressable
                  style={styles.backButton}
                  onPress={() => setStep((current) => (current - 1) as StepId)}
                  disabled={saving}
                >
                  <Text style={styles.backButtonText}>Back</Text>
                </Pressable>
              )}

              <Pressable
                style={styles.primaryButton}
                onPress={handleNext}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isLastStep ? "Done" : "Next"}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    fontFamily: "Agrandir-GrandHeavy",
    color: "#AB99FA",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  title: {
    fontFamily: "Agrandir-GrandHeavy",
    color: "#1D014A",
    fontSize: 24,
    lineHeight: 30,
  },
  progressRow: {
    flexDirection: "row",
    gap: 8,
  },
  progressDot: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(29, 1, 74, 0.12)",
  },
  progressDotActive: {
    backgroundColor: "#AB99FA",
  },
  body: {
    gap: 16,
  },
  error: {
    fontFamily: "Agrandir-Regular",
    color: "#B42318",
    fontSize: 13,
  },
  footer: {
    gap: 12,
  },
  primaryActions: {
    flexDirection: "row",
    gap: 12,
  },
  backButton: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#AB99FA",
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  backButtonText: {
    fontFamily: "Agrandir-GrandHeavy",
    color: "#AB99FA",
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  primaryButton: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "#AB99FA",
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  primaryButtonText: {
    fontFamily: "Agrandir-GrandHeavy",
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});