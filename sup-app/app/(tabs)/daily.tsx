// Daily tab ("today:"): today's posture snapshot (share of time per state),
// session time and s'up s'core, with % change badges against yesterday.
// Data is today's + yesterday's posture_daily row, refetched on every focus.
import PressFeedback from "@/src/components/ui/PressFeedback";
import TutorialActions from "@/src/components/onboarding/TutorialActions";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  Image,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useFonts } from "expo-font";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  fetchDailyPosturePair,
  type DailyPosturePair,
} from "../../src/services/posture/postureSyncService";
import { getCachedDailyPair, setCachedDailyPair } from "@/src/services/posture/dailyPostureCache";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { colours } from "@/theme/colours";
import { InfoButton, InfoModal } from "@/src/components/ui/InfoModal";
import { toLocalDateKey } from "@/src/lib/dateKey";
import { formatSessionMins } from "@/src/lib/formatDuration";
import { captureError } from "@/src/lib/sentry";

export { default as ErrorBoundary } from "@/src/components/ui/ScreenErrorBoundary";

const { width: SCREEN_W } = Dimensions.get("window");
const PRIMARY_TEXT = "#1D014A";

const SEGMENT_COLORS: Record<string, string> = {
  upright:  "#6DC96D",
  forward_lean: "#FFD600",
  slouched:  "#F5A623",
  severe: "#EC555E",
  tilted_left:   "#F5A623",
  tilted_right:  "#F5A623",
};

/** Stacked bar: one segment per posture state, each as wide as its % of the day. */
function ScoreBar({ postureAverages }: { postureAverages: Record<string, number> }) {
  const segments = Object.entries(postureAverages).map(([key, pct]) => ({
      pct,
      color: SEGMENT_COLORS[key] ?? "#ccc",
    })
  );

  return (
    <View style={scoreBarStyles.track}>
      {segments.map(({ pct, color }, i) =>
        pct > 0 ? (
          <View
            key={i}
            style={[scoreBarStyles.segment, { flex: pct, backgroundColor: color }]}
          />
        ) : null
      )}
    </View>
  );
}

const scoreBarStyles = StyleSheet.create({
  // Matches stats.tsx's posture breakdown bar (bdStyles.track)
  track: {
    flexDirection: "row",
    height: 14,
    borderRadius: 7,
    overflow: "hidden",
  },
  segment: {
    height: "100%",
  },
});

/** Small pill badge for % changes */
function ChangeBadge({ value }: { value: number }) {
  const isUp = value >= 0;
  return (
    <View style={[badgeStyles.pill, { backgroundColor: isUp ? "#6DC96D" : "#EC555E" }]}>
      <Text style={badgeStyles.text}>
        {isUp ? "↑" : "↓"}{Math.abs(value)}%
      </Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    position: "absolute",
    top: -10,
    right: -10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    zIndex: 1,
  },
  text: {
    fontFamily: "Agrandir-Regular",
    color: "white",
    fontSize: 11,
    fontWeight: "700",
  },
});

// InfoButton / InfoModal now live in src/components/ui/InfoModal.tsx — shared
// with desk.tsx's s'train explainer so every metric popup consistently
// includes a "view sources & methodology" link.

/** Posture breakdown list shown inside the snapshot card */
function PostureBreakdown({ stats }: { stats: { label: string; value: string; color?: string }[] }) {
  return (
    <View style={breakdownStyles.container}>
      {stats.map((stat, i) => (
        <View
          key={stat.label}
          style={[
            breakdownStyles.row,
            i === stats.length - 1 && { borderBottomWidth: 0 },
          ]}
        >
          <View style={breakdownStyles.labelRow}>
            {stat.color && (
              <View style={[breakdownStyles.dot, { backgroundColor: stat.color }]} />
            )}
            <Text style={breakdownStyles.label}>{stat.label}</Text>
          </View>
          <Text style={breakdownStyles.value}>{stat.value}</Text>
        </View>
      ))}
    </View>
  );
}

// Matches stats.tsx's posture breakdown list (bdStyles)
const breakdownStyles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "rgba(63, 36, 131, 0.06)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(63, 36, 131, 0.08)",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    fontFamily: "Agrandir-Regular",
    fontSize: 12,
    color: PRIMARY_TEXT,
    opacity: 0.75,
  },
  value: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 12,
    color: PRIMARY_TEXT,
  },
});

export default function DailyScreen() {
  const { isAuthenticated, userId } = useAuth();
  const { tutorialStep, setTutorialStep } = useTutorial();
  const { bottom: bottomInset } = useSafeAreaInsets();
  // Clears the floating navigation bar: 72 high, 25 above the safe area (same as stats.tsx).
  const scrollPaddingBottom = 72 + 25 + bottomInset + 16;

  const [dailyPair, setDailyPair] = useState<DailyPosturePair>({ today: null, previous: null });

  const [fontsLoaded] = useFonts({
    "Agrandir-Regular":  require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const [activeInfo, setActiveInfo] = useState<string | null>(null);

  // Stale-while-revalidate: paint the cached pair (if under a minute old), then
  // replace it with a fresh fetch and re-cache.
  const loadDailyPosture = useCallback(async () => {
    if (!userId) return;
    // Worked out on every load (not once at app start) so the screen rolls
    // over to the new day if the app stays open past midnight.
    const TODAY_KEY = toLocalDateKey();
 
    // show cached data immediately so UI and AI prompt unblock right away
    const cached = await getCachedDailyPair(userId, TODAY_KEY);
    if (cached) {
      setDailyPair(cached);
    }
 
    // fetch fresh in background regardless
    fetchDailyPosturePair(userId, TODAY_KEY)
      .then((fresh) => {
        setDailyPair(fresh);
        setCachedDailyPair(userId, TODAY_KEY, fresh);
      })
      // On failure, keep whatever is on screen (cached pair) rather than zeroing the day.
      .catch((err) => {
        console.error("[DailyScreen] fetchDailyPosturePair failed", err);
        captureError(err, "daily-posture-pair", { dateKey: TODAY_KEY, hadCache: cached != null });
      });
  }, [userId]);

  // Reset on sign-out only; loading is done by the focus effect below, which
  // also fires on first mount (calling it here too fetched the day twice).
  useEffect(() => {
    if (!isAuthenticated) {
      setDailyPair({ today: null, previous: null });
    }
  }, [isAuthenticated]);

  // Refetch every time the tab is focused, so a just-finished session shows up.
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      loadDailyPosture();
    }, [isAuthenticated, loadDailyPosture])
  );

  const { today, previous } = dailyPair;

  // Current day
  const totalDeskMs = today?.totalDeskMs ?? 0;
  const supScore = today?.supScore ?? 0;
  const stateTotals = today?.stateTotals ?? {};

  // Previous day
  const prevSupScore = previous?.supScore ?? 0;
  const prevTotalDeskMs = previous?.totalDeskMs ?? 0;


  // % changes per metric (computed here so they use live step data)
  // null when yesterday's value is 0 — dividing by it rendered "↑Infinity%" / "↓NaN%".
  const scoreChange   = prevSupScore > 0 ? Math.round(((supScore - prevSupScore) / prevSupScore) * 100) : null;
  const sessionChange = prevTotalDeskMs > 0 ? Math.round(((totalDeskMs - prevTotalDeskMs) / prevTotalDeskMs) * 100) : null;
  const showBadges = today != null && previous != null;

  // Today's ms per posture state (transition excluded), filled with 0 for missing states.
  const STATE_TOTALS = {
    upright: stateTotals.upright ?? 0,
    forward_lean: stateTotals.forward_lean ?? 0,
    slouched: stateTotals.slouched ?? 0,
    severe: stateTotals.severe ?? 0,
    tilted_left: stateTotals.tilted_left ?? 0,
    tilted_right: stateTotals.tilted_right ?? 0,
  };
  // normalise scores to out of 100%
  const TOTAL = Object.values(STATE_TOTALS).reduce((sum, v) => sum + v, 0);
  const POSTURE_AVERAGES = (
    Object.fromEntries(
      Object.entries(STATE_TOTALS).map(([key, val]) => [
        key,
        (val / TOTAL) * 100,
      ])
    )
  ) as Record<keyof typeof STATE_TOTALS, number>;

  // after normalising, if any of the posture averages are NaN (due to TOTAL being 0), set them to 0
  for (const key in POSTURE_AVERAGES) {
    const postureKey = key as keyof typeof POSTURE_AVERAGES;
    if (isNaN(POSTURE_AVERAGES[postureKey])) {
      POSTURE_AVERAGES[postureKey] = 0;
    }
  }

  const POSTURE_STATS = [
    { label: "upright",      value: `${POSTURE_AVERAGES.upright.toFixed(1)}%`,      color: SEGMENT_COLORS.upright },
    { label: "forward lean", value: `${POSTURE_AVERAGES.forward_lean.toFixed(1)}%`, color: SEGMENT_COLORS.forward_lean },
    { label: "slouched",     value: `${POSTURE_AVERAGES.slouched.toFixed(1)}%`,     color: SEGMENT_COLORS.slouched },
    { label: "severe",       value: `${POSTURE_AVERAGES.severe.toFixed(1)}%`,       color: SEGMENT_COLORS.severe },
    { label: "tilted left",  value: `${POSTURE_AVERAGES.tilted_left.toFixed(1)}%`,  color: SEGMENT_COLORS.tilted_left },
    { label: "tilted right", value: `${POSTURE_AVERAGES.tilted_right.toFixed(1)}%`, color: SEGMENT_COLORS.tilted_right },
  ];

  const METRIC_INFO: Record<string, { title: string; body: string }> = {
    snapshot: {
      title: "s'napshot",
      body: `a real-time summary of today's posture activity. the bar shows your average posture quality across today's sessions.\ntips below are personalised to your current posture patterns.\n\ngo into desk mode to see the data from each session.`,
    },
    session: {
      title: "s'ession",
      body: "total time tracked in active posture sessions today. the more you track, the more your s'core reflects your real posture.",
    },
    score: {
      title: "s'core",
      body:
        "your daily posture score out of 100, based on how good your posture was across all the time you tracked today.\n\n• every tracked minute earns credit: upright 100, transition 75, forward lean or tilted 50, slouched 25, severe 0.\n• your s'core starts at 50 each day and moves towards your real posture as you track — after 10 minutes your posture counts for half, after an hour it's almost all you.",
    },
  };

  if (!fontsLoaded) return null;

  return (
    <View style={{ flex: 1, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <InfoModal
        metricKey={activeInfo}
        onClose={() => setActiveInfo(null)}
        metricInfo={METRIC_INFO}
        accentColor={PRIMARY_TEXT}
      />

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: scrollPaddingBottom }}
      >
        {/* Top bar */}
        <HeaderBar />

        {/* Section label with back arrow */}
        <View style={styles.sectionRow}>
          <PressFeedback feedback="scale" onPress={() => router.back()} style={styles.backArrow} hitSlop={8}>
            <Ionicons name="arrow-back" size={20} color={PRIMARY_TEXT} />
          </PressFeedback>
          <Text style={styles.sectionLabel}>today:</Text>
        </View>

        {tutorialStep === "snapshot-tip" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../assets/images/mascot_tutorial.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>
                here's your snapshot, the % of time you spent in each posture state today.
              </Text>
              <TutorialActions>
                <PressFeedback feedback="link" onPress={() => setTutorialStep("snapshot-tip-stats")}>
                  <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
                </PressFeedback>
              </TutorialActions>
            </View>
          </View>
        )}

        {/* S'napshot card */}
        <View
          style={[
            styles.card,
            styles.shadow,
            styles.highlightable,
            tutorialStep === "snapshot-tip" && styles.highlighted,
          ]}
        >
          <InfoButton onPress={() => setActiveInfo("snapshot")} color={PRIMARY_TEXT} />
          <Text style={styles.cardTitle}>s'napshot</Text>
          <ScoreBar postureAverages={POSTURE_AVERAGES} />
          <PostureBreakdown stats={POSTURE_STATS} />
        </View>

        {tutorialStep === "snapshot-tip-stats" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../assets/images/mascot_tutorial.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>
                here's your total session time and s'up score for today's s'pot sessions.
              </Text>
              <TutorialActions>
                <PressFeedback feedback="link" onPress={() => setTutorialStep("go-settings-tip")}>
                  <Text style={styles.tutorialTipNext}>got it</Text>
                </PressFeedback>
              </TutorialActions>
            </View>
          </View>
        )}

        {/* Stats grid */}
        <View style={styles.grid}>
          {/* S'ession */}
          <View
            style={[
              styles.card,
              styles.gridCell,
              styles.shadow,
              styles.highlightable,
              tutorialStep === "snapshot-tip-stats" && styles.highlighted,
            ]}
          >
            <InfoButton onPress={() => setActiveInfo("session")} color={PRIMARY_TEXT} />
            {showBadges && sessionChange != null && <ChangeBadge value={sessionChange} />}
            <Text style={styles.statLabel}>s'ession</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatSessionMins(totalDeskMs / 60_000)}
            </Text>
          </View>

          {/* S'core */}
          <View
            style={[
              styles.card,
              styles.gridCell,
              styles.shadow,
              styles.highlightable,
              tutorialStep === "snapshot-tip-stats" && styles.highlighted,
            ]}
          >
            <InfoButton onPress={() => setActiveInfo("score")} color={PRIMARY_TEXT} />
            {showBadges && scoreChange != null && <ChangeBadge value={scoreChange} />}
            <Text style={styles.statLabel}>s'core</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{supScore} pts</Text>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  backArrow: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionLabel: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 20,
    color: PRIMARY_TEXT,
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

  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 18,
    paddingTop: 16,
    borderRadius: 28,
    position: "relative",
  },
  // Matches stats.tsx's card title
  cardTitle: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.75,
    marginBottom: 12,
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
    borderColor: "#5222AE",
    shadowColor: "#5222AE",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    gap: 14,
    marginBottom: 16,
  },
  gridCell: {
    marginHorizontal: 0,
    marginBottom: 0,
    width: (SCREEN_W - 20 * 2 - 14) / 2,
    alignItems: "center",
  },
  statLabel: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.75,
    marginBottom: 4,
    textAlign: "center",
  },
  statValue: {
    fontFamily: "Agrandir-Regular",
    fontSize: 30,
    color: PRIMARY_TEXT,
    lineHeight: 36,
  },

});
