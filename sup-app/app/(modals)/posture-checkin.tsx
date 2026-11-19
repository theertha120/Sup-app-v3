import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PressFeedback from "@/src/components/ui/PressFeedback";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import PostureOptionFigure from "@/src/components/posture/PostureOptionFigure";
import { useToast } from "@/src/contexts/ToastContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { syncDayXp } from "@/src/services/xp/xpService";
// Same tokens as the Exercise page and workout form, so the check-in matches.
import { s, purple, soft, ink } from "@/src/features/exercise/ui";
import { FEELINGS } from "@/src/features/exercise/model";
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

const FIGURE_IDLE = "#C4B8DA";

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function PostureCheckinScreen() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { userId } = useAuth();
  const { sentAt, source } = useLocalSearchParams<{ sentAt?: string; source?: string }>();
  // Opened straight from a notification, so the fonts may not be loaded yet.
  const [fontsLoaded, fontError] = useFonts({
    "Agrandir-Regular": require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-TextBold": require("../../assets/fonts/Agrandir-TextBold.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

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
      // Today's XP may have changed (first check-in of the day earns 10).
      if (userId) void syncDayXp(userId);
      showToast("Posture logged!", "success");
      router.back();
    } else {
      setError(result.error ?? "Couldn't save your check-in.");
    }
  };

  if (!fontsLoaded && !fontError) {
    return <View style={[styles.page, styles.center]}><ActivityIndicator color={purple} /></View>;
  }

  return (
    <View style={styles.page}>
      <BackgroundBlobs />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: 28, paddingBottom: insets.bottom + 28 }]}
      >
        <View style={styles.handle} />

        <View style={s.between}>
          <View style={styles.chip}>
            <Ionicons name="body-outline" size={15} color={purple} />
            <Text style={[s.label, { color: purple }]}>Quick check</Text>
          </View>
          <View style={styles.chip}>
            <Ionicons name="time-outline" size={15} color={purple} />
            <Text style={[s.label, { color: purple }]}>Now · {formatTime(now)}</Text>
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={s.title}>How are you sitting?</Text>
          <Text style={s.text}>Catching your posture during the day is how habits change.</Text>
        </View>

        <View style={s.card}>
          <Text style={s.heading}>Right now I’m…</Text>
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
                  <PostureOptionFigure posture={opt.id} color={selected ? purple : FIGURE_IDLE} size={66} />
                  <Text style={[s.muted, selected && { color: ink, fontFamily: "Agrandir-TextBold" }]}>{opt.label}</Text>
                </PressFeedback>
              );
            })}
          </View>
        </View>

        <View style={s.card}>
          <View style={{ gap: 4 }}>
            <Text style={s.heading}>How does your back feel?</Text>
            <Text style={s.muted}>From 1 (stiff) to 5 (great)</Text>
          </View>
          <View style={s.row}>
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
                  style={[styles.rating, selected && { backgroundColor: purple }]}
                >
                  <Text style={[s.heading, selected && { color: "#fff" }]}>{n}</Text>
                </PressFeedback>
              );
            })}
          </View>
          <View style={s.between}>
            <Text style={s.muted}>1 · Stiff</Text>
            <Text style={[s.label, { color: purple }]}>{backFeel ? FEELINGS[backFeel - 1] : ""}</Text>
            <Text style={s.muted}>5 · Great</Text>
          </View>
        </View>

        {error && <Text accessibilityRole="alert" style={[s.error, { textAlign: "center" }]}>{error}</Text>}

        <View style={s.row}>
          <PressFeedback style={[s.button, s.secondary, { flex: 1 }]} onPress={() => router.back()}>
            <Text style={[s.buttonText, { color: purple }]}>Not now</Text>
          </PressFeedback>
          <PressFeedback
            style={[s.button, { flex: 2 }, !canSave && styles.disabled]}
            disabled={!canSave}
            onPress={handleSave}
          >
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.buttonText}>Log it</Text>}
          </PressFeedback>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "rgba(211,193,231,0.64)" },
  center: { justifyContent: "center", alignItems: "center" },
  content: { paddingHorizontal: 20, gap: 18 },
  handle: { width: 36, height: 4, backgroundColor: "rgba(29,1,74,0.18)", borderRadius: 2, alignSelf: "center", marginTop: -14 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  option: {
    width: "31.5%", alignItems: "center", gap: 4, paddingVertical: 10,
    backgroundColor: "#F8F6FB", borderRadius: 18, borderWidth: 1.5, borderColor: "transparent",
  },
  optionSelected: { backgroundColor: soft, borderColor: purple },
  rating: { flex: 1, minHeight: 48, borderRadius: 15, backgroundColor: soft, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.45 },
});
