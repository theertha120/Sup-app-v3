import { useEffect, useMemo, useState } from "react";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { useFonts } from "expo-font";
import { supabase } from "@/src/lib/supabase";
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

type StepId = 0 | 1 | 2 | 3 | 4;

/** Today's date in SGT (UTC+8) as YYYY-MM-DD */
function todayInSGT(): string {
  const now = new Date();
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().slice(0, 10);
}

export default function CoachingSetupModal({
  visible,
  onComplete,
  onCancel = () => {},
  initialProfile,
}: {
  visible: boolean;
  onComplete: () => void;
  onCancel?: () => void;
  initialProfile?: BehaviorProfile | null;
}) {
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const { tutorialStep, dismissTutorial } = useTutorial();
  const defaults = useMemo(() => createDefaultBehaviorProfile(), []);
  const [step, setStep] = useState<StepId>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [summaryGeneratedToday, setSummaryGeneratedToday] = useState(false);

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
  const [dailyRunHour, setDailyRunHour] = useState<number>(
    initial ? initial.dailyRun : defaults.dailyRun
  );

  useEffect(() => {
    if (!visible) return;

    async function checkTodaySummary() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("daily_ai_summary")
        .select("user_id")
        .eq("user_id", user.id)
        .eq("date", todayInSGT())
        .maybeSingle();

      setSummaryGeneratedToday(!!data);
    }

    checkTodaySummary();
  }, [visible]);

  if (!visible || !fontsLoaded) return null;

  const canGoBack = step > 0;
  const isLastStep = step === 4;

  const resetToInitial = () => {
    setPrimaryGoals(initial ? initial.primaryGoals : defaults.primaryGoals);
    setActiveTimePresets(initial ? initial.activeTimePresets : defaults.activeTimePresets);
    setPreferredTones(initial ? initial.preferredTones : defaults.preferredTones);
    setReminderFrequency(initial ? initial.reminderFrequency : defaults.reminderFrequency);
    setWeeklyGoals(initial ? initial.weeklyGoals : defaults.weeklyGoals);
    setDailyRunHour(initial ? initial.dailyRun : defaults.dailyRun);
    setStep(0);
    setError("");
  };

  const handleCancel = () => {
    resetToInitial();
    dismissTutorial();
    onCancel();
  };

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
      dailyRun: dailyRunHour,
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
            <View style={styles.headerText}>
              <Text style={styles.kicker}>Coaching setup</Text>
              <Text style={styles.title}>Set up your behaviour engine</Text>
            </View>
            <Pressable
              onPress={handleCancel}
              disabled={saving}
              style={styles.cancelButton}
              hitSlop={8}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
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

          {tutorialStep === "coaching-tip" && (
            <View style={styles.tutorialTip}>
              <Image
                source={require("../../../assets/images/mascot.png")}
                style={styles.tutorialTipMascot}
                resizeMode="contain"
              />
              <View style={styles.tutorialTipTextWrap}>
                <Text style={styles.tutorialTipText}>
                  {step < 4
                    ? "you can personalise your s'up experience here!"
                    : "you can set this time as the time you will start your first session."}
                </Text>
              </View>
            </View>
          )}

          {/* Body */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
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
              <DailyRunStep
                value={dailyRunHour}
                onChange={setDailyRunHour}
                summaryGeneratedToday={summaryGeneratedToday}
              />
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

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
  headerText: {
    flex: 1,
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
  cancelButton: {
    paddingTop: 2,
  },
  cancelButtonText: {
    fontFamily: "Agrandir-Regular",
    color: "#AB99FA",
    fontSize: 14,
  },
  tutorialTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  tutorialTipMascot: {
    width: 34,
    height: 34,
  },
  tutorialTipTextWrap: {
    flex: 1,
  },
  tutorialTipText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
    color: "#FFFFFF",
    lineHeight: 20,
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
    maxHeight: 420,
  },
  bodyContent: {
    gap: 16,
    paddingBottom: 4,
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
    fontFamily: "Agrandir-Regular",
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
    fontFamily: "Agrandir-Regular",
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});