import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PressFeedback from "@/src/components/ui/PressFeedback";
import PostureOptionFigure from "@/src/components/posture/PostureOptionFigure";
import { useToast } from "@/src/contexts/ToastContext";
import { colours } from "@/theme/colours";
import {
  savePostureCheckin,
  type BackFeel,
  type PostureCheckinPosture,
} from "@/src/services/posture/postureCheckinService";

const POSTURE_OPTIONS: { id: PostureCheckinPosture; label: string }[] = [
  { id: "upright", label: "Upright" },
  { id: "forward_lean", label: "Forward lean" },
  { id: "slouched", label: "Slouched" },
  { id: "severe", label: "Severe" },
  { id: "tilted_left", label: "Tilted L" },
  { id: "tilted_right", label: "Tilted R" },
];

const BACK_FEEL_OPTIONS: BackFeel[] = [1, 2, 3, 4, 5];

const FIGURE_IDLE = "#B9B3D6";

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function PostureCheckinScreen() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { sentAt, source } = useLocalSearchParams<{ sentAt?: string; source?: string }>();

  const [posture, setPosture] = useState<PostureCheckinPosture | null>(null);
  const [backFeel, setBackFeel] = useState<BackFeel | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const canSave = posture !== null && backFeel !== null && !saving;

  const handleSave = async () => {
    if (!posture || !backFeel) return;
    setSaving(true);
    setError(null);
    const result = await savePostureCheckin({
      posture,
      backFeel,
      notificationSentAt: sentAt || null,
      source: source === "in_app" ? "in_app" : "notification",
    });
    setSaving(false);
    if (result.success) {
      showToast("Posture logged!", "success");
      router.back();
    } else {
      setError(result.error ?? "Couldn't save your check-in.");
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: 24, paddingBottom: insets.bottom + 24 }]}
    >
      <Text style={styles.title}>Quick check</Text>
      <Text style={styles.subtitle}>
        Catching your posture during the day is how habits change.
      </Text>

      <Text style={styles.question}>How are you sitting right now?</Text>
      <View style={styles.grid}>
        {POSTURE_OPTIONS.map((opt) => {
          const selected = posture === opt.id;
          return (
            <PressFeedback
              key={opt.id}
              feedback="scale"
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={opt.label}
              onPress={() => setPosture(opt.id)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <PostureOptionFigure posture={opt.id} color={selected ? colours.primary : FIGURE_IDLE} size={72} />
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{opt.label}</Text>
            </PressFeedback>
          );
        })}
      </View>

      <Text style={styles.question}>How does your back feel?</Text>
      <View style={styles.ratingRow}>
        {BACK_FEEL_OPTIONS.map((n) => {
          const selected = backFeel === n;
          return (
            <PressFeedback
              key={n}
              feedback="scale"
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${n} of 5`}
              onPress={() => setBackFeel(n)}
              style={[styles.ratingDot, selected && styles.ratingDotSelected]}
            >
              <Text style={[styles.ratingText, selected && styles.ratingTextSelected]}>{n}</Text>
            </PressFeedback>
          );
        })}
      </View>
      <View style={styles.ratingLabels}>
        <Text style={styles.ratingHint}>Stiff</Text>
        <Text style={styles.ratingHint}>Great</Text>
      </View>

      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>Time</Text>
        <Text style={styles.timeValue}>Now · {formatTime(now)}</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <PressFeedback
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        disabled={!canSave}
        onPress={handleSave}
      >
        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Log it</Text>}
      </PressFeedback>

      <PressFeedback feedback="link" style={styles.skip} onPress={() => router.back()}>
        <Text style={styles.skipText}>Not now</Text>
      </PressFeedback>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.background },
  content: { paddingHorizontal: 20 },
  title: { fontSize: 24, fontWeight: "700", color: colours.textPrimary, textAlign: "center" },
  subtitle: {
    fontSize: 15,
    color: colours.textSecondary,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 21,
  },
  question: { fontSize: 17, fontWeight: "600", color: colours.textPrimary, marginTop: 28, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  option: {
    width: "31.5%",
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: colours.card,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colours.border,
  },
  optionSelected: { borderColor: colours.primary, backgroundColor: colours.primarySoft },
  optionLabel: { fontSize: 13, color: colours.textSecondary, marginTop: 4 },
  optionLabelSelected: { color: colours.textPrimary, fontWeight: "600" },
  ratingRow: { flexDirection: "row", justifyContent: "space-between" },
  ratingDot: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.card,
    borderWidth: 2,
    borderColor: colours.border,
  },
  ratingDotSelected: { backgroundColor: colours.primary, borderColor: colours.primary },
  ratingText: { fontSize: 18, fontWeight: "600", color: colours.textSecondary },
  ratingTextSelected: { color: "#FFFFFF" },
  ratingLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingHorizontal: 8 },
  ratingHint: { fontSize: 12, color: colours.textSecondary },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 28,
    padding: 14,
    backgroundColor: colours.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.border,
  },
  timeLabel: { fontSize: 15, fontWeight: "600", color: colours.textPrimary },
  timeValue: { fontSize: 15, color: colours.textSecondary },
  error: { color: "#F44336", textAlign: "center", marginTop: 16 },
  saveButton: {
    marginTop: 24,
    backgroundColor: colours.primary,
    paddingVertical: 15,
    borderRadius: 28,
    alignItems: "center",
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  skip: { alignSelf: "center", marginTop: 14, padding: 6 },
  skipText: { color: colours.textSecondary, fontSize: 15 },
});
