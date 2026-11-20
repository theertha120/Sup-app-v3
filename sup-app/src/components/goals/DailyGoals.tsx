// Goals cards inside home's "today:" section (after DailySummary's cards):
// "your goals" (picked goals to tick off, plus the history link) and "pick
// your goals" (one easy/medium/hard offer per section; any number can be picked).
// State comes from useDailyGoals() in home.tsx, which also feeds the
// "s'goals completed" card in DailySummary. Fonts are loaded by home.tsx.
// Text sizes follow DailySummary: card titles GrandHeavy 14, rows Regular 13.
import PressFeedback from "@/src/components/ui/PressFeedback";
import TutorialActions from "@/src/components/onboarding/TutorialActions";
import { View, Text, StyleSheet, ActivityIndicator, Image } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import { colours } from "@/theme/colours";
import { useTutorial, type TutorialStep } from "@/src/contexts/TutorialContext";
import { InfoButton, InfoModal, type InfoModalEntry } from "@/src/components/ui/InfoModal";
import type { DailyGoalsState } from "@/src/hooks/useDailyGoals";
import type { GoalDifficulty, GoalSection } from "@/src/lib/goals/dailyGoals";

const PRIMARY_TEXT = "#1D014A";
const ACCENT = "#5222AE";

export const DIFFICULTY_COLOURS: Record<GoalDifficulty, string> = {
  easy: "#6DC96D",
  medium: "#F5A623",
  hard: "#EC555E",
};

export const SECTION_META: Record<GoalSection, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  posture: { label: "posture", icon: "body-outline" },
  exercise: { label: "exercise", icon: "barbell-outline" },
  sitting: { label: "sitting", icon: "desktop-outline" },
};

// "?" explainers, shared with DailySummary's completed card and the history screen.
export const GOAL_INFO: Record<"todaysGoals" | "completedGoals", InfoModalEntry> = {
  todaysGoals: {
    title: "today's goals",
    body:
      "every day you get 3 new goals in each section: one easy, one medium and one hard.\n\n" +
      "• sections: posture and exercise for everyone. sitting (desk mode time) is added once you've tracked a s'pot session.\n" +
      "• goals are picked at random from our goal list, and stay the same all day. new ones arrive at midnight (your phone's time).\n" +
      "• in \"pick your goals\", tap + to add as many as you like, from any section and difficulty. tap an added goal again to remove it.\n" +
      "• your added goals show under \"your goals\". tick one when you've done it. it's on the honour system: the app doesn't check it against your data.\n" +
      "• goals you add but don't tick are cleared at the end of the day.",
  },
  completedGoals: {
    title: "completed goals",
    body:
      "every goal you tick off is saved here, under the day you picked it for.\n\n" +
      "• today's ticked goals also show in \"s'goals completed\" in today's data.\n" +
      "• untick a goal to take it back out. a completed goal can't be removed from today's list.\n" +
      "• goals you added but never ticked aren't kept.\n" +
      "• your history is saved to your account, so it stays when you sign out or change phones.",
  },
};

/** Inline mascot tip for the goals tutorial steps (matches DailySummary's tips). */
export function GoalsTutorialTip({ text, next, nextLabel = "next >>", onLayout }: {
  text: string;
  next: TutorialStep;
  nextLabel?: string;
  onLayout?: (y: number) => void;
}) {
  const { setTutorialStep } = useTutorial();
  return (
    <View style={styles.tutorialTip} onLayout={(e) => onLayout?.(e.nativeEvent.layout.y)}>
      <Image
        source={require("../../../assets/images/mascot_tutorial.png")}
        style={styles.tutorialTipMascot}
        resizeMode="contain"
      />
      <View style={styles.tutorialTipTextWrap}>
        <Text style={styles.tutorialTipText}>{text}</Text>
        <TutorialActions>
          <PressFeedback feedback="link" onPress={() => setTutorialStep(next)}>
            <Text style={styles.tutorialTipNext}>{nextLabel}</Text>
          </PressFeedback>
        </TutorialActions>
      </View>
    </View>
  );
}

export function DifficultyPill({ difficulty }: { difficulty: GoalDifficulty }) {
  return (
    <View style={[styles.pill, { backgroundColor: DIFFICULTY_COLOURS[difficulty] }]}>
      <Text style={styles.pillText}>{difficulty}</Text>
    </View>
  );
}

export default function DailyGoals({ state, onTipLayout }: {
  state: DailyGoalsState;
  /** Called with the y (within this component) a tutorial step should scroll to. */
  onTipLayout?: (y: number) => void;
}) {
  const { sections, goals, loading, error, pending, pick, unpick, toggleComplete, reload } = state;
  const { tutorialStep } = useTutorial();
  const [showInfo, setShowInfo] = useState(false);
  const pickedById = new Map(goals.map((g) => [g.goal_id, g]));
  // The history tip sits below the "your goals" card; scrolling to the tip
  // alone left the history link above the screen, so scroll to the link.
  const goalsCardYRef = useRef(0);
  const historyLinkYRef = useRef(0);

  return (
    <View style={styles.container}>
      <InfoModal
        metricKey={showInfo ? "todaysGoals" : null}
        onClose={() => setShowInfo(false)}
        metricInfo={GOAL_INFO}
        accentColor={PRIMARY_TEXT}
      />

      {/* Picked goals to tick off, plus the history link */}
      <View
        style={[styles.card, styles.shadow]}
        onLayout={(e) => { goalsCardYRef.current = e.nativeEvent.layout.y; }}
      >
        <InfoButton onPress={() => setShowInfo(true)} color={PRIMARY_TEXT} />
        <Text style={styles.cardTitle}>your goals</Text>

        {error && (
          <PressFeedback feedback="link" onPress={() => void reload()} style={styles.errorRow}>
            <Text style={styles.errorText}>{error} tap to try again.</Text>
          </PressFeedback>
        )}

        {goals.length === 0 ? (
          <Text style={styles.emptyText}>{"no goals yet. add some from \"pick your goals\" below."}</Text>
        ) : (
          goals.map((goal) => {
            const done = goal.completed_at != null;
            return (
              <PressFeedback
                key={goal.id}
                feedback="link"
                style={styles.goalRow}
                onPress={() => void toggleComplete(goal)}
                disabled={pending.has(goal.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done, busy: pending.has(goal.id) }}
                accessibilityLabel={`${goal.difficulty} ${goal.section} goal: ${goal.goal_text}`}
              >
                <Ionicons
                  name={done ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={done ? DIFFICULTY_COLOURS.easy : ACCENT}
                />
                <View style={styles.goalTextWrap}>
                  <Text style={[styles.rowText, done && styles.rowTextDone]}>{goal.goal_text}</Text>
                  <View style={styles.metaRow}>
                    <DifficultyPill difficulty={goal.difficulty} />
                    <Text style={styles.metaText}>{SECTION_META[goal.section].label}</Text>
                  </View>
                </View>
              </PressFeedback>
            );
          })
        )}

        <PressFeedback
          feedback="link"
          style={[
            styles.historyLink,
            styles.highlightable,
            tutorialStep === "goals-history-tip" && styles.outlined,
          ]}
          onLayout={(e) => { historyLinkYRef.current = e.nativeEvent.layout.y; }}
          onPress={() => router.push("/goal-history" as any)}
          accessibilityRole="button"
          accessibilityLabel="history of goals"
        >
          <Ionicons name="trophy-outline" size={16} color={ACCENT} />
          <Text style={styles.historyLinkText}>history of completed goals</Text>
          <Ionicons name="chevron-forward" size={16} color={ACCENT} />
        </PressFeedback>
      </View>

      {tutorialStep === "goals-history-tip" && (
        <GoalsTutorialTip
          text={"tap \"history of goals\" to see every goal you've ever completed."}
          next="go-settings-tip"
          nextLabel="got it"
          onLayout={() => onTipLayout?.(goalsCardYRef.current + historyLinkYRef.current - 24)}
        />
      )}

      {tutorialStep === "goals-pick-tip" && (
        <GoalsTutorialTip
          text={"every day you get an easy, medium and hard goal per section. tap + to add any you want, then tick them off in \"your goals\"."}
          next="goals-history-tip"
          onLayout={onTipLayout}
        />
      )}

      {/* Today's offers, grouped by section */}
      <View
        style={[
          styles.card,
          styles.shadow,
          styles.highlightable,
          tutorialStep === "goals-pick-tip" && styles.highlighted,
        ]}
      >
        <Text style={styles.cardTitle}>pick your goals</Text>
        {loading && sections.length === 0 ? (
          <ActivityIndicator color={ACCENT} style={styles.loader} />
        ) : (
          sections.map(({ section, offers }) => (
            <View key={section} style={styles.group}>
              <View style={styles.groupHeader}>
                <Ionicons name={SECTION_META[section].icon} size={14} color={PRIMARY_TEXT} style={styles.groupIcon} />
                <Text style={styles.groupLabel}>{SECTION_META[section].label}</Text>
              </View>
              <View style={styles.groupList}>
                {offers.map((offer, i) => {
                  const picked = pickedById.get(offer.goalId);
                  const locked = picked?.completed_at != null;
                  const busy = pending.has(offer.goalId) || (picked != null && pending.has(picked.id));
                  return (
                    <PressFeedback
                      key={offer.goalId}
                      feedback="link"
                      style={[styles.offerRow, i === offers.length - 1 && styles.lastRow]}
                      onPress={() => void (picked ? unpick(picked) : pick(offer))}
                      disabled={busy || locked}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: picked != null, disabled: locked, busy }}
                      accessibilityLabel={`${offer.difficulty} goal: ${offer.text}`}
                      accessibilityHint={locked ? "completed" : picked ? "removes it from your goals" : "adds it to your goals"}
                    >
                      <DifficultyPill difficulty={offer.difficulty} />
                      <Text style={styles.rowText}>{offer.text}</Text>
                      <Ionicons
                        name={locked ? "checkmark-done" : picked ? "checkmark-circle" : "add-circle-outline"}
                        size={22}
                        color={picked ? ACCENT : PRIMARY_TEXT}
                        style={!picked && styles.addIcon}
                      />
                    </PressFeedback>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
  },

  // Card, title, highlight and tip styles match DailySummary's.
  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 18,
    paddingTop: 16,
    borderRadius: 28,
    position: "relative",
  },
  shadow: {
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 5,
  },
  highlightable: {
    borderWidth: 3,
    borderColor: "transparent",
  },
  highlighted: {
    borderColor: ACCENT,
    shadowColor: ACCENT,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  // Border-only highlight for the history link: its background is nearly
  // transparent, so the glow above shaded the whole link on Android.
  outlined: {
    borderColor: ACCENT,
  },
  cardTitle: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.75,
    marginBottom: 12,
  },

  errorRow: {
    marginBottom: 8,
  },
  errorText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 12,
    color: "#C0313A",
  },
  emptyText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: PRIMARY_TEXT,
    opacity: 0.7,
    lineHeight: 18,
  },
  loader: {
    marginVertical: 16,
  },

  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  goalTextWrap: {
    flex: 1,
  },
  rowText: {
    flex: 1,
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: PRIMARY_TEXT,
    lineHeight: 18,
  },
  rowTextDone: {
    textDecorationLine: "line-through",
    opacity: 0.55,
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

  historyLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "rgba(63, 36, 131, 0.06)",
  },
  historyLinkText: {
    flex: 1,
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 12,
    color: ACCENT,
  },

  // Section groups match DailySummary's posture breakdown list.
  group: {
    marginBottom: 12,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  groupIcon: {
    opacity: 0.75,
  },
  groupLabel: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 12,
    color: PRIMARY_TEXT,
    opacity: 0.75,
  },
  groupList: {
    borderRadius: 14,
    backgroundColor: "rgba(63, 36, 131, 0.06)",
    paddingVertical: 2,
    paddingHorizontal: 12,
  },
  offerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(63, 36, 131, 0.08)",
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  addIcon: {
    opacity: 0.6,
  },

  // Matches DailySummary's ChangeBadge text.
  pill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 54,
    alignItems: "center",
  },
  pillText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 11,
    fontWeight: "700",
    color: "white",
  },

  tutorialTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginBottom: 16,
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
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },
});
