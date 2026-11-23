// Every goal the user has completed, grouped by day (newest first).
// Opened from the "history of goals" button in home's "today's goals" section.
import PressFeedback from "@/src/components/ui/PressFeedback";
import { View, Text, StyleSheet, SectionList, ActivityIndicator } from "react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import HeaderBar from "@/src/components/ui/HeaderBar";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchCompletedGoals } from "@/src/services/goals/dailyGoalsService";
import { groupByDate, type DailyGoal } from "@/src/lib/goals/dailyGoals";
import { DifficultyPill, GOAL_INFO, SECTION_META } from "@/src/components/goals/DailyGoals";
import { InfoButton, InfoModal } from "@/src/components/ui/InfoModal";
import { fromLocalDateKey, toLocalDateKey, addDaysToDateKey } from "@/src/lib/dateKey";
import { captureError } from "@/src/lib/sentry";

export { default as ErrorBoundary } from "@/src/components/ui/ScreenErrorBoundary";

const PRIMARY_TEXT = "#1D014A";

function dayLabel(dateKey: string): string {
  const today = toLocalDateKey();
  if (dateKey === today) return "today";
  if (dateKey === addDaysToDateKey(today, -1)) return "yesterday";
  return fromLocalDateKey(dateKey)
    .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .toLowerCase();
}

export default function GoalHistoryScreen() {
  const { userId } = useAuth();
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../assets/fonts/Agrandir-GrandHeavy.otf"),
  });
  const [goals, setGoals] = useState<DailyGoal[] | null>(null);
  const [error, setError] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    let cancelled = false;
    setError(false);
    fetchCompletedGoals(userId)
      .then((rows) => { if (!cancelled) setGoals(rows); })
      .catch((err) => {
        captureError(err, "goal-history-load");
        if (!cancelled) setError(true);
      });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => load(), [load]);

  const sections = useMemo(
    () => groupByDate(goals ?? []).map(({ date, goals: data }) => ({ title: dayLabel(date), data })),
    [goals],
  );

  if (!fontsLoaded) return null;

  return (
    <View style={{ flex: 1, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />
      <InfoModal
        metricKey={showInfo ? "completedGoals" : null}
        onClose={() => setShowInfo(false)}
        metricInfo={GOAL_INFO}
        accentColor={PRIMARY_TEXT}
      />
      <SectionList
        style={styles.container}
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(goal) => goal.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<>
          <HeaderBar />
          <View style={styles.titleRow}>
            <PressFeedback feedback="scale" onPress={() => router.back()} style={styles.backArrow} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="back">
              <Ionicons name="arrow-back" size={20} color={PRIMARY_TEXT} />
            </PressFeedback>
            <Text style={styles.title}>completed goals</Text>
            <InfoButton onPress={() => setShowInfo(true)} color={PRIMARY_TEXT} style={styles.inlineInfoBtn} />
          </View>
          {goals != null && goals.length > 0 && (
            <Text style={styles.total}>{goals.length} goal{goals.length === 1 ? "" : "s"} completed so far</Text>
          )}
        </>}
        ListEmptyComponent={
          error ? (
            <PressFeedback feedback="link" onPress={load} style={styles.emptyWrap}>
              <Text style={styles.emptyText}>{"couldn't load your goals. tap to try again."}</Text>
            </PressFeedback>
          ) : goals == null ? (
            <ActivityIndicator color="#5222AE" style={styles.emptyWrap} />
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>no completed goals yet. pick some on home and tick them off!</Text>
            </View>
          )
        }
        renderSectionHeader={({ section }) => <Text style={styles.dayLabel}>{section.title}</Text>}
        renderItem={({ item }) => (
          <View style={[styles.row, styles.shadow]}>
            <Ionicons name="checkmark-circle" size={22} color="#6DC96D" />
            <View style={styles.rowText}>
              <Text style={styles.goalText}>{item.goal_text}</Text>
              <View style={styles.metaRow}>
                <DifficultyPill difficulty={item.difficulty} />
                <Text style={styles.metaText}>{SECTION_META[item.section].label}</Text>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 48 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backArrow: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  // Overrides InfoButton's absolute top-right placement to sit after the title.
  inlineInfoBtn: {
    position: "relative",
    top: 0,
    right: 0,
  },
  title: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 20,
    color: PRIMARY_TEXT,
  },
  total: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: PRIMARY_TEXT,
    opacity: 0.7,
    paddingHorizontal: 24,
    marginBottom: 4,
  },
  dayLabel: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.75,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20,
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  shadow: {
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 5,
  },
  rowText: { flex: 1 },
  goalText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  metaText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 11,
    color: PRIMARY_TEXT,
    opacity: 0.6,
  },
  emptyWrap: {
    marginTop: 32,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  emptyText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.75,
    textAlign: "center",
    lineHeight: 20,
  },
});
