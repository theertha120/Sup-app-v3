import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { colours } from "../../theme/colours";
import { useIMUContext } from "../../src/contexts/IMUContext";
import type { PostureSessionStats } from "../../src/services/posture/postureAnalysisService";
import {
  useSessionStats,
  formatDuration,
  formatPercent,
  StateTimeMap,
  DayData,
} from "../../src/hooks/useSessionStats";
import { DeskPostureState } from "../../src/components/desk/mockDeskPostureData";

type DateRange = "today" | "last7days";

// Using live IMU session data via `useSessionStats` instead of mock stream

// ── Posture colours ───────────────────────────────────────

const STATE_COLORS: Record<DeskPostureState, string> = {
  upright: "#4CAF50",
  transition: "#8BC34A",
  forward_lean: "#CDDC39",
  slouched: "#FF9800",
  severe: "#F44336",
  tilted_left: "#FF9800",
  tilted_right: "#FF9800",
};

const STATE_INFO: Record<DeskPostureState, { label: string }> = {
  upright: { label: "good alignment" },
  transition: { label: "slight forward shift" },
  forward_lean: { label: "leaning forward" },
  slouched: { label: "spine rounding" },
  severe: { label: "high spinal load" },
  tilted_left: { label: "shifting left" },
  tilted_right: { label: "shifting right" },
};

const STATE_ORDER: DeskPostureState[] = [
  "upright",
  "transition",
  "forward_lean",
  "slouched",
  "severe",
  "tilted_left",
  "tilted_right",
];

const BAR_STACK_ORDER: DeskPostureState[] = [
  "severe",
  "slouched",
  "tilted_left",
  "tilted_right",
  "forward_lean",
  "transition",
  "upright",
];

// Animated number component for smooth transitions
function AnimatedNumber({
  value,
  style,
  decimals = 2,
}: {
  value: number;
  style?: any;
  decimals?: number;
}) {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const animationRef = useRef<any>(null);
  useEffect(() => {
    // Clear any existing animation
    if (animationRef.current) {
      clearInterval(animationRef.current);
    }

    const startValue = displayValue;
    const endValue = value;
    const duration = 250; // 250ms animation
    const startTime = Date.now();

    if (startValue === endValue) return;
    animationRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease out animation
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeProgress;
      
      setDisplayValue(Math.round(current));

      if (progress >= 1) {
        setDisplayValue(endValue);
        if (animationRef.current) {
          clearInterval(animationRef.current);
          animationRef.current = null;
        }
      }
    }, 16); // ~60fps

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [value]);

  return <Text style={style}>{displayValue}</Text>;
}

function AnimatedProgressBar({ goodPercent, animationKey }: { goodPercent: number; animationKey?: string | number }) {
  const animatedWidth = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    animatedWidth.setValue(0);
    Animated.timing(animatedWidth, { toValue: goodPercent, duration: 300, useNativeDriver: false }).start();
  }, [goodPercent, animationKey]);
  return (
    <View style={styles.metricBarRow}>
      <Animated.View style={[styles.metricBarGood, { width: animatedWidth.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }]} />
    </View>
  );
}

// ── Stacked bar chart ─────────────────────────────────────────────────────────

const CHART_HEIGHT = 100;

function StackedBarChart({ days }: { days: DayData[] }) {
  const maxMs     = Math.max(...days.map((d) => d.totalMs), 1);
  const withData  = days.filter((d) => d.totalMs > 0);
  const avgMs     = withData.length > 0 ? withData.reduce((s, d) => s + d.totalMs, 0) / withData.length : 0;

  const recentMs  = days.slice(4).reduce((s, d) => s + d.totalMs, 0);
  const priorMs   = days.slice(0, 4).reduce((s, d) => s + d.totalMs, 0);
  const trendPct  = priorMs > 0 ? Math.round(((recentMs - priorMs) / priorMs) * 100) : null;

  const weekTotal   = days.reduce((s, d) => s + d.totalMs, 0);
  const weekUpright = days.reduce((s, d) => s + (d.states.upright ?? 0), 0);
  const alignPct    = weekTotal > 0 ? Math.round((weekUpright / weekTotal) * 100) : null;

  const bestDay = withData.reduce<DayData | null>((best, d) => {
    const pct     = d.totalMs > 0 ? (d.states.upright ?? 0) / d.totalMs : 0;
    const bestPct = best && best.totalMs > 0 ? (best.states.upright ?? 0) / best.totalMs : 0;
    return pct > bestPct ? d : best;
  }, null);

  return (
    <View style={ch.container}>
      {/* Header */}
      <View style={ch.insightHeader}>
        <View style={ch.insightMain}>
          <Text style={ch.avgLabel}>daily average</Text>
          <Text style={ch.avgValue}>{avgMs > 0 ? formatDuration(avgMs) : "--"}</Text>
          {trendPct !== null && (
            <View style={ch.trendRow}>
              <Ionicons name={trendPct >= 0 ? "arrow-up" : "arrow-down"} size={12} color={trendPct >= 0 ? "#4CAF50" : "#FF9800"} />
              <Text style={[ch.trendText, { color: trendPct >= 0 ? "#4CAF50" : "#FF9800" }]}>
                {Math.abs(trendPct)}% vs prior days
              </Text>
            </View>
          )}
        </View>
        <View style={ch.insightChips}>
          {alignPct !== null && (
            <View style={ch.chip}>
              <Text style={ch.chipValue}>{alignPct}%</Text>
              <Text style={ch.chipLabel}>aligned</Text>
            </View>
          )}
          {bestDay && (
            <View style={ch.chip}>
              <Text style={ch.chipValue}>{bestDay.label}</Text>
              <Text style={ch.chipLabel}>best day</Text>
            </View>
          )}
        </View>
      </View>

      {/* Bars */}
      <View style={ch.chartArea}>
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <View key={frac} style={[ch.gridLine, { bottom: frac * CHART_HEIGHT }]} />
        ))}
        <View style={ch.barsRow}>
          {days.map((day) => {
            const barH    = day.totalMs > 0 ? (day.totalMs / maxMs) * CHART_HEIGHT : 0;
            const isToday = day.isToday;
            return (
              <View key={day.dateKey} style={ch.barCol}>
                <View style={[ch.barContainer, { height: CHART_HEIGHT }]}>
                  {barH > 0 ? (
                    <View style={[ch.bar, { height: barH }]}>
                      {BAR_STACK_ORDER.map((k) => {
                        const ms  = day.states[k] ?? 0;
                        const pct = day.totalMs > 0 ? ms / day.totalMs : 0;
                        if (pct === 0) return null;
                        return <View key={k} style={{ height: `${pct * 100}%` as any, backgroundColor: STATE_COLORS[k] }} />;
                      })}
                    </View>
                  ) : (
                    <View style={ch.emptyBar} />
                  )}
                </View>
                <Text style={[ch.dayLabel, isToday && ch.dayLabelToday]}>{day.label}</Text>
              </View>
            );
          })}
        </View>
        <View style={ch.xAxis} />
      </View>

      {/* Legend */}
      <View style={ch.legend}>
        {([["upright", "aligned"], ["forward_lean", "forward"], ["slouched", "rounding"], ["severe", "high load"]] as [DeskPostureState, string][]).map(([k, lbl]) => (
          <View key={k} style={ch.legendItem}>
            <View style={[ch.legendDot, { backgroundColor: STATE_COLORS[k] }]} />
            <Text style={ch.legendText}>{lbl}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Posture breakdown (week filter) ───────────────────────────────────────────

type StatFilter = "today" | "week";

function PostureBreakdown({ todayStats, weekStats, todayTotalMs, weekTotalMs }: {
  todayStats: StateTimeMap; weekStats: StateTimeMap;
  todayTotalMs: number; weekTotalMs: number;
}) {
  const [filter, setFilter] = useState<StatFilter>("today");
  const stats = filter === "today" ? todayStats : weekStats;
  const total = filter === "today" ? todayTotalMs : weekTotalMs;

  return (
    <View style={pb.container}>
      <View style={pb.headerRow}>
        <Text style={pb.heading}>posture breakdown</Text>
        <View style={pb.filterRow}>
          {(["today", "week"] as StatFilter[]).map((f) => (
            <Pressable key={f} style={[pb.pill, filter === f && pb.pillActive]} onPress={() => setFilter(f)}>
              <Text style={[pb.pillText, filter === f && pb.pillTextActive]}>{f === "today" ? "today" : "7 days"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={pb.totalTime}>{total > 0 ? `${formatDuration(total)} tracked` : "no data yet"}</Text>

      {total === 0 ? (
        <View style={pb.empty}>
          <Text style={pb.emptyText}>use desk mode with your s'pots connected to start building your breakdown</Text>
        </View>
      ) : (
        <>
          {/* Stacked horizontal bar */}
          <View style={pb.stackedBar}>
            {STATE_ORDER.map((k) => {
              const ms  = stats[k] ?? 0;
              const pct = total > 0 ? (ms / total) * 100 : 0;
              if (pct < 1) return null;
              return <View key={k} style={{ width: `${pct}%` as any, backgroundColor: STATE_COLORS[k], height: "100%" }} />;
            })}
          </View>

          <View style={pb.list}>
            {STATE_ORDER.map((k) => {
              const ms = stats[k] ?? 0;
              if (ms === 0) return null;
              const pct   = total > 0 ? Math.round((ms / total) * 100) : 0;
              const color = STATE_COLORS[k];
              return (
                <View key={k} style={pb.row}>
                  <View style={[pb.dot, { backgroundColor: color }]} />
                  <Text style={pb.stateLabel}>{STATE_INFO[k].label}</Text>
                  <Text style={[pb.statePct, { color }]}>{pct}%</Text>
                  <Text style={pb.stateTime}>{formatDuration(ms)}</Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }, [])
  );

  const [dateRange, setDateRange] = useState<DateRange>("last7days");

  const { posture, bothConnected, isNeutralCalibrated, neckAlignmentPercent, shoulderBalancePercent, upperBackPercent } = useIMUContext();
  const currentState = (posture?.state ?? "upright") as DeskPostureState;
  const isTracking = bothConnected && isNeutralCalibrated;

  const {
    sessionStats: liveSessionStats,
    sessionTotalMs,
    todayStats,
    weekDays,
    weekStats,
    todayTotalMs,
    weekTotalMs,
  } = useSessionStats(isTracking ? currentState : undefined);

  const sessionStats = useMemo(() => {
    const totalMs = sessionTotalMs;
    const goodMs = liveSessionStats.upright ?? 0;
    const badMs = Math.max(0, totalMs - goodMs);
    const goodPct = totalMs > 0 ? (goodMs / totalMs) * 100 : 0;
    const avgScore = Math.round(goodPct);
    return {
      avgScore,
      totalMs,
      goodPosturePercent: goodPct,
      goodPostureMs: goodMs,
      badPostureMs: badMs,
      isVariableSession: false,
    } as PostureSessionStats;
  }, [liveSessionStats, sessionTotalMs]);

  // --- UI throttle: snapshot displayed stats only every 5 minutes ---
  const STATS_UI_UPDATE_MS = 5 * 60_000; // 5 minutes
  const liveStatsRef = useRef({
    avgScore: sessionStats.avgScore,
    totalMs: sessionStats.totalMs,
    goodPosturePercent: sessionStats.goodPosturePercent,
    neckAlignmentPercent: neckAlignmentPercent,
    shoulderBalancePercent: shoulderBalancePercent,
    upperBackPercent: upperBackPercent,
  });

  useEffect(() => {
    liveStatsRef.current = {
      avgScore: sessionStats.avgScore,
      totalMs: sessionStats.totalMs,
      goodPosturePercent: sessionStats.goodPosturePercent,
      neckAlignmentPercent: neckAlignmentPercent,
      shoulderBalancePercent: shoulderBalancePercent,
      upperBackPercent: upperBackPercent,
    };
  }, [sessionStats, neckAlignmentPercent, shoulderBalancePercent, upperBackPercent]);

  const [displayAvgScore, setDisplayAvgScore] = useState<number>(sessionStats.avgScore);
  const [displayTotalMs, setDisplayTotalMs] = useState<number>(sessionStats.totalMs);
  const [displayGoodPosturePercent, setDisplayGoodPosturePercent] = useState<number>(sessionStats.goodPosturePercent);
  const [displayNeckPercent, setDisplayNeckPercent] = useState<number | null>(neckAlignmentPercent ?? null);
  const [displayShoulderPercent, setDisplayShoulderPercent] = useState<number | null>(shoulderBalancePercent ?? null);
  const [displayUpperBackPercent, setDisplayUpperBackPercent] = useState<number | null>(upperBackPercent ?? null);

  // Immediate refresh when screen focused
  useFocusEffect(
    useCallback(() => {
      setDisplayAvgScore(liveStatsRef.current.avgScore);
      setDisplayTotalMs(liveStatsRef.current.totalMs);
      setDisplayGoodPosturePercent(liveStatsRef.current.goodPosturePercent);
      setDisplayNeckPercent(liveStatsRef.current.neckAlignmentPercent ?? null);
      setDisplayShoulderPercent(liveStatsRef.current.shoulderBalancePercent ?? null);
      setDisplayUpperBackPercent(liveStatsRef.current.upperBackPercent ?? null);
    }, [])
  );

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayAvgScore(liveStatsRef.current.avgScore);
      setDisplayTotalMs(liveStatsRef.current.totalMs);
      setDisplayGoodPosturePercent(liveStatsRef.current.goodPosturePercent);
      setDisplayNeckPercent(liveStatsRef.current.neckAlignmentPercent ?? null);
      setDisplayShoulderPercent(liveStatsRef.current.shoulderBalancePercent ?? null);
      setDisplayUpperBackPercent(liveStatsRef.current.upperBackPercent ?? null);
    }, STATS_UI_UPDATE_MS);
    return () => clearInterval(id);
  }, []);

  const todayStatsDisplay = useMemo(() => {
    if (dateRange !== "today") return null;
    if (!todayStats || todayTotalMs <= 0) return null;
    return {
      totalMinutes: todayTotalMs / 60000,
      goodPostureMinutes: (todayStats.upright ?? 0) / 60000,
      avgScore: todayTotalMs > 0 ? Math.round(((todayStats.upright ?? 0) / todayTotalMs) * 100) : 0,
    } as { totalMinutes: number; goodPostureMinutes: number; avgScore: number };
  }, [dateRange, todayStats, todayTotalMs]);

  const { bestDay, worstDay } = useMemo(() => {
    const days = (weekDays ?? []).filter((d) => d.totalMs > 0);
    if (days.length === 0) return { bestDay: null, worstDay: null };
    const sorted = [...days].sort((a, b) => {
      const aPct = a.totalMs > 0 ? (a.states.upright ?? 0) / a.totalMs : 0;
      const bPct = b.totalMs > 0 ? (b.states.upright ?? 0) / b.totalMs : 0;
      return bPct - aPct;
    });
    return { bestDay: sorted[0], worstDay: sorted[sorted.length - 1] };
  }, [weekDays]);

  const hasData = sessionStats != null && displayTotalMs > 0;
  const hasHistoricalData = false; // historical/mock data removed

  const MIN_MS = 5 * 60_000; // 5 minutes in ms
  const hasEnoughData = sessionStats != null && displayTotalMs >= MIN_MS;

  // Snapshot session stats for display (throttled)
  const displaySessionStats: PostureSessionStats = useMemo(() => {
    const totalMs = displayTotalMs;
    const goodPct = displayGoodPosturePercent;
    const goodMs = Math.round((goodPct / 100) * totalMs);
    const badMs = Math.max(0, totalMs - goodMs);
    return {
      avgScore: Math.round(goodPct),
      totalMs,
      goodPosturePercent: goodPct,
      goodPostureMs: goodMs,
      badPostureMs: badMs,
      isVariableSession: sessionStats.isVariableSession,
    } as PostureSessionStats;
  }, [displayTotalMs, displayGoodPosturePercent, sessionStats.isVariableSession]);

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Your posture health</Text>
          <Text style={styles.headerSubtitle}>Based on daily wearable data</Text>
        </View>

        {/* Date Range Selector */}
        <View style={styles.dateRangeContainer}>
          <Pressable style={[styles.dateRangeButton, dateRange === "today" && styles.dateRangeButtonActive]} onPress={() => setDateRange("today")}>
            <Text style={[styles.dateRangeText, dateRange === "today" && styles.dateRangeTextActive]}>Today</Text>
          </Pressable>
          <Pressable style={[styles.dateRangeButton, dateRange === "last7days" && styles.dateRangeButtonActive]} onPress={() => setDateRange("last7days")}>
            <Text style={[styles.dateRangeText, dateRange === "last7days" && styles.dateRangeTextActive]}>Last 7 days</Text>
          </Pressable>
        </View>

        {/* Summary Cards */}
        {hasHistoricalData ? (
          dateRange === "today" && todayStatsDisplay ? (
            <View style={styles.summaryCardsRow}>
              <View style={styles.summaryMiniCard}>
                <Text style={styles.summaryMiniEmoji}>⏱️</Text>
                <Text style={styles.summaryMiniLabel}>Total Time</Text>
                <AnimatedNumber value={todayStatsDisplay.totalMinutes} style={styles.summaryMiniScore} />
                <Text style={styles.summaryMiniDate}>minutes</Text>
              </View>
              <View style={styles.summaryMiniCard}>
                <Text style={styles.summaryMiniEmoji}>✨</Text>
                <Text style={styles.summaryMiniLabel}>Good Posture</Text>
                <AnimatedNumber value={todayStatsDisplay.goodPostureMinutes} style={styles.summaryMiniScore} />
                <Text style={styles.summaryMiniDate}>minutes</Text>
              </View>
            </View>
          ) : (
            <View style={styles.summaryCardsRow}>
              {bestDay && (
                <View style={styles.summaryMiniCard}>
                  <Text style={styles.summaryMiniEmoji}>🌟</Text>
                  <Text style={styles.summaryMiniLabel}>Best Day</Text>
                  <AnimatedNumber
                    value={
                      bestDay.totalMs > 0
                        ? Math.round(((bestDay.states.upright ?? 0) / bestDay.totalMs) * 100)
                        : 0
                    }
                    style={styles.summaryMiniScore}
                  />
                  <Text style={styles.summaryMiniDate}>{new Date(bestDay.dateKey).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
                </View>
              )}
              {worstDay && bestDay?.dateKey !== worstDay?.dateKey && (
                <View style={styles.summaryMiniCard}>
                  <Text style={styles.summaryMiniEmoji}>💪</Text>
                  <Text style={styles.summaryMiniLabel}>Needs Work</Text>
                  <AnimatedNumber
                    value={
                      worstDay.totalMs > 0
                        ? Math.round(((worstDay.states.upright ?? 0) / worstDay.totalMs) * 100)
                        : 0
                    }
                    style={styles.summaryMiniScore}
                  />
                  <Text style={styles.summaryMiniDate}>{new Date(worstDay.dateKey).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
                </View>
              )}
            </View>
          )
        ) : (
          <View style={styles.noDataCard}>
            <Text style={styles.noDataText}>No data available for {dateRange === "today" ? "today" : "the last 7 days"}</Text>
          </View>
        )}

        

      {/* Overall Score */}
      <View style={styles.scoreCard}>
        <Text style={styles.scoreLabel}>Spine Health Score</Text>
        <Text style={styles.scoreValue}>
          {hasEnoughData ? displaySessionStats.avgScore : hasData ? "--" : "0"}
        </Text>
        <Text style={styles.scoreHint}>
          {hasData
            ? "From your latest IMU session"
            : "Score appears after your first session"}
        </Text>
      </View>

      {/* Metrics */}
      <View style={styles.metrics}>
        {/* Derive neck alignment from session data: slightly reduced from overall score */}
        {hasData ? (
          <MetricCard
            label="Neck alignment"
            goodPercent={
              displayNeckPercent != null
                ? Math.round(displayNeckPercent)
                : Math.round(Math.max(0, displaySessionStats.goodPosturePercent - 5))
            }
            animationKey={dateRange}
          />
        ) : (
          <MetricSkeleton label="Neck alignment" />
        )}
        {/* Derive shoulder balance from session data: slightly increased variance */}
        {hasData ? (
          <MetricCard
            label="Shoulder balance"
            goodPercent={
              displayShoulderPercent != null
                ? Math.round(displayShoulderPercent)
                : Math.round(Math.min(100, displaySessionStats.goodPosturePercent + 3))
            }
            animationKey={dateRange}
          />
        ) : (
          <MetricSkeleton label="Shoulder balance" />
        )}
        {hasData ? (
          <UpperBackSessionCard stats={displaySessionStats} animationKey={dateRange} liveUpperBackPercent={displayUpperBackPercent} />
        ) : (
          <MetricSkeleton label="Upper back support" />
        )}
      </View>

      {/* Weekly Summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>This week</Text>
        <Text style={styles.summaryText}>
          {hasData
            ? `Session: ${(displaySessionStats.totalMs / 1000).toFixed(2)}s total · ${displaySessionStats.goodPosturePercent.toFixed(0)}% good posture${displaySessionStats.isVariableSession ? " · Variable posture" : ""}`
            : "Your weekly summary will appear here once you start wearing your s'pots"}
        </Text>
      </View>
      </ScrollView>
    </Animated.View>
  );
}

// ── Preserved metric components ───────────────────────────────────────────────

function MetricSkeleton({ label }: { label: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricBar} />
      <Text style={styles.metricHint}>Tracking starts after your first session</Text>
    </View>
  );
}

function MetricCard({ label, goodPercent, animationKey }: { label: string; goodPercent: number; animationKey?: string | number }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <AnimatedProgressBar goodPercent={goodPercent} animationKey={animationKey} />
      <Text style={styles.metricHint}>Good: {goodPercent.toFixed(0)}% · Needs work: {(100 - goodPercent).toFixed(0)}%</Text>
    </View>
  );
}

function UpperBackSessionCard({ stats, animationKey, liveUpperBackPercent }: { stats: PostureSessionStats; animationKey?: string | number; liveUpperBackPercent?: number | null }) {
  const sessionPercent = stats.totalMs > 0 ? stats.goodPosturePercent : 0;
  const displayPercent = liveUpperBackPercent != null ? liveUpperBackPercent : sessionPercent;
  const totalMinutes = (stats.totalMs / 60_000).toFixed(2);
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>Upper back support</Text>
      <AnimatedProgressBar goodPercent={displayPercent} animationKey={animationKey} />
      <Text style={styles.metricHint}>Good: {displayPercent.toFixed(0)}% · {sessionPercent.toFixed(0)}% (session) · {totalMinutes} min{stats.isVariableSession ? " · Variable session" : ""}</Text>
    </View>
  );
}

// ── Chart styles ──────────────────────────────────────────────────────────────

const chartCard = StyleSheet.create({
  container: {
    backgroundColor: "#fff", borderRadius: 20, padding: 16,
    marginHorizontal: 16, marginBottom: 16,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  title: { fontSize: 16, fontWeight: "700", color: "#222", marginBottom: 2 },
  sub:   { fontSize: 12, color: "#999", marginBottom: 12 },
});

const ch = StyleSheet.create({
  container: { marginTop: 4 },
  insightHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 },
  insightMain:   { gap: 3 },
  avgLabel:      { fontSize: 11, color: "#999" },
  avgValue:      { fontSize: 26, fontWeight: "800", color: "#222", lineHeight: 30 },
  trendRow:      { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  trendText:     { fontSize: 12, fontWeight: "600" },
  insightChips:  { flexDirection: "row", gap: 8 },
  chip:          { backgroundColor: "#F5F3FF", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, alignItems: "center" },
  chipValue:     { fontSize: 15, fontWeight: "800", color: colours.primary },
  chipLabel:     { fontSize: 10, color: "#999", marginTop: 1 },
  chartArea:     { position: "relative", height: CHART_HEIGHT + 24, marginBottom: 8 },
  gridLine:      { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "#F0F0F0" },
  barsRow:       { position: "absolute", bottom: 24, left: 0, right: 0, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  barCol:        { flex: 1, alignItems: "center", gap: 6 },
  barContainer:  { justifyContent: "flex-end" },
  bar:           { width: 26, borderTopLeftRadius: 5, borderTopRightRadius: 5, overflow: "hidden", flexDirection: "column-reverse" },
  emptyBar:      { width: 26, height: 3, backgroundColor: "#F0F0F0", borderRadius: 2, alignSelf: "center" },
  dayLabel:      { fontSize: 10, color: "#999", textAlign: "center" },
  dayLabelToday: { color: colours.primary, fontWeight: "700" },
  xAxis:         { position: "absolute", bottom: 24, left: 0, right: 0, height: 1, backgroundColor: "#E0E0E0" },
  legend:        { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  legendItem:    { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:     { width: 8, height: 8, borderRadius: 4 },
  legendText:    { fontSize: 11, color: "#999" },
});

const pb = StyleSheet.create({
  container: {
    backgroundColor: "#fff", borderRadius: 20, padding: 16,
    marginHorizontal: 16, marginBottom: 16,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }, android: { elevation: 2 } }),
  },
  headerRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  heading:       { fontSize: 16, fontWeight: "700", color: "#222" },
  filterRow:     { flexDirection: "row", gap: 6 },
  pill:          { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 20, backgroundColor: "#F5F5F5" },
  pillActive:    { backgroundColor: colours.primary },
  pillText:      { fontSize: 12, fontWeight: "600", color: "#999" },
  pillTextActive:{ color: "#fff" },
  totalTime:     { fontSize: 13, color: "#999", marginBottom: 14, textAlign: "center" },
  stackedBar:    { height: 10, borderRadius: 5, overflow: "hidden", flexDirection: "row", marginBottom: 14, backgroundColor: "#F0F0F0" },
  empty:         { alignItems: "center", paddingVertical: 20 },
  emptyText:     { fontSize: 13, color: "#bbb", textAlign: "center" },
  list:          { gap: 10 },
  row:           { flexDirection: "row", alignItems: "center", gap: 8 },
  dot:           { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  stateLabel:    { flex: 1, fontSize: 13, color: "#444" },
  statePct:      { fontSize: 13, fontWeight: "700", minWidth: 36, textAlign: "right" },
  stateTime:     { fontSize: 12, color: "#999", minWidth: 40, textAlign: "right" },
});

// ── Preserved styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:              { flex: 1, backgroundColor: "#EDE9FF" },
  header:                 { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle:            { fontSize: 22, fontWeight: "600", color: "#222" },
  headerSubtitle:         { marginTop: 4, color: "#666" },
  dateRangeContainer:     { flexDirection: "row", marginHorizontal: 16, marginBottom: 16, backgroundColor: "#E5E5EA", borderRadius: 12, padding: 4 },
  dateRangeButton:        { flex: 1, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: "center" },
  dateRangeButtonActive:  { backgroundColor: "white", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  dateRangeText:          { fontSize: 14, fontWeight: "500", color: "#666" },
  dateRangeTextActive:    { color: colours.primary, fontWeight: "600" },
  summaryCardsRow:        { flexDirection: "row", paddingHorizontal: 16, gap: 12, marginBottom: 16 },
  summaryMiniCard:        { flex: 1, backgroundColor: "white", padding: 16, borderRadius: 16, alignItems: "center", borderLeftWidth: 4, borderLeftColor: colours.primary },
  summaryMiniEmoji:       { fontSize: 24, marginBottom: 8 },
  summaryMiniLabel:       { fontSize: 12, color: "#666", marginBottom: 4 },
  summaryMiniScore:       { fontSize: 28, fontWeight: "700", color: colours.primary },
  summaryMiniDate:        { fontSize: 11, color: "#999", marginTop: 2 },
  noDataCard:             { backgroundColor: "white", marginHorizontal: 16, marginBottom: 16, padding: 24, borderRadius: 16, alignItems: "center" },
  noDataText:             { fontSize: 14, color: "#999", textAlign: "center" },
  scoreCard:              { backgroundColor: colours.primary, margin: 16, padding: 24, borderRadius: 24 },
  scoreLabel:             { color: "white", opacity: 0.9 },
  scoreValue:             { color: "white", fontSize: 40, fontWeight: "700", marginVertical: 6 },
  scoreHint:              { color: "white", opacity: 0.8, fontSize: 12 },
  metrics:                { paddingHorizontal: 16, gap: 12 },
  metricCard:             { backgroundColor: "white", padding: 16, borderRadius: 16 },
  metricLabel:            { color: "#444", fontWeight: "500" },
  metricBar:              { height: 10, backgroundColor: "#E5E5EA", borderRadius: 5, marginVertical: 10 },
  metricBarRow:           { height: 10, borderRadius: 5, marginVertical: 10, overflow: "hidden", backgroundColor: "#E5E5EA" },
  metricBarGood:          { backgroundColor: colours.primary, height: 10, borderRadius: 5 },
  metricHint:             { fontSize: 12, color: "#888" },
  summaryCard:            { backgroundColor: "white", margin: 16, padding: 16, borderRadius: 16 },
  summaryTitle:           { fontWeight: "600", marginBottom: 12 },
  summaryText:            { fontSize: 13, color: "#666", lineHeight: 20 },
  disclaimer:             { textAlign: "center", fontSize: 12, color: "#777", padding: 20 },
});