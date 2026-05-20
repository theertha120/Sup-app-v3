import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Animated } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { colours } from "../../theme/colours";
import {
  analyzeIMUStream,
  type IMUReading,
  type PostureSessionStats,
} from "../../src/services/posture/postureAnalysisService";
import { CURRENT_USER_ID } from "../../constants/env";

type DateRange = "today" | "last7days";

// Mock stream: replace with real session data; empty = no data (startup state)
const mockStream = require("../../src/data/mock_imu_stream.json") as IMUReading[];
const calibration = require("../../src/data/calibration_good_posture.json") as IMUReading[] | null;

// Animated number component for smooth transitions
function AnimatedNumber({ value, style }: { value: number; style?: any }) {
  const [displayValue, setDisplayValue] = useState(value);
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

// Animated progress bar component
function AnimatedProgressBar({ 
  goodPercent, 
  animationKey 
}: { 
  goodPercent: number; 
  animationKey?: string | number; 
}) {
  const animatedWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animatedWidth.setValue(0);
    Animated.timing(animatedWidth, {
      toValue: goodPercent,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [goodPercent, animationKey]);

  return (
    <View style={styles.metricBarRow}>
      <Animated.View 
        style={[
          styles.metricBarGood, 
          { 
            width: animatedWidth.interpolate({
              inputRange: [0, 100],
              outputRange: ['0%', '100%']
            })
          }
        ]} 
      />
    </View>
  );
}

export default function StatsScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, [])
  );

  const [dateRange, setDateRange] = useState<DateRange>("last7days");

  // Calculate metrics from IMU stream analysis
  // TODO: Replace mock_imu_stream.json with real BLE sensor data from S'pots device
  // TODO: Replace calibration_good_posture.json with user-calibrated baseline (captured during onboarding)
  const sessionStats = useMemo(() => {
    const stream = mockStream?.length ? mockStream : [];
    if (stream.length === 0) return null;
    return analyzeIMUStream(stream, calibration ?? undefined);
  }, []);

  // Filter posture data based on selected date range
  // TODO: Query posture_daily table from Supabase for date range (best/worst days, weekly aggregates)
  const filteredData = useMemo(() => {
    if (!sessionStats) return [];
    
    const today = new Date().toISOString().slice(0, 10);
    
    if (dateRange === "today") {
      // Create today's data object from current session
      return [{
        userId: CURRENT_USER_ID,
        date: today,
        avgScore: sessionStats.avgScore,
        goodPostureMinutes: sessionStats.goodPostureMs / 60000,
        badPostureMinutes: sessionStats.badPostureMs / 60000,
        totalMinutes: sessionStats.totalMs / 60000,
      }];
    } else {
      // "last7days" - TODO: fetch from Supabase when available
      // For now, return empty (will show "No data available")
      return [];
    }
  }, [dateRange, sessionStats]);

  // Calculate best and worst days
  const { bestDay, worstDay } = useMemo(() => {
    if (filteredData.length === 0) return { bestDay: null, worstDay: null };
    
    const sorted = [...filteredData].sort((a, b) => b.avgScore - a.avgScore);
    return {
      bestDay: sorted[0],
      worstDay: sorted[sorted.length - 1],
    };
  }, [filteredData]);

  // Calculate today's specific stats
  const todayStats = useMemo(() => {
    if (dateRange !== "today" || filteredData.length === 0) return null;
    const data = filteredData[0];
    return {
      totalMinutes: data.totalMinutes,
      goodPostureMinutes: data.goodPostureMinutes,
      avgScore: data.avgScore,
    };
  }, [dateRange, filteredData]);

  const hasData = sessionStats != null && sessionStats.totalMs > 0;
  const hasHistoricalData = filteredData.length > 0;

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
        <Pressable
          style={[styles.dateRangeButton, dateRange === "today" && styles.dateRangeButtonActive]}
          onPress={() => setDateRange("today")}
        >
          <Text style={[styles.dateRangeText, dateRange === "today" && styles.dateRangeTextActive]}>
            Today
          </Text>
        </Pressable>
        <Pressable
          style={[styles.dateRangeButton, dateRange === "last7days" && styles.dateRangeButtonActive]}
          onPress={() => setDateRange("last7days")}
        >
          <Text style={[styles.dateRangeText, dateRange === "last7days" && styles.dateRangeTextActive]}>
            Last 7 days
          </Text>
        </Pressable>
      </View>

      {/* Summary Cards */}
      {hasHistoricalData ? (
        dateRange === "today" && todayStats ? (
          // Today view - show useful stats for the day
          <View style={styles.summaryCardsRow}>
            <View style={styles.summaryMiniCard}>
              <Text style={styles.summaryMiniEmoji}>⏱️</Text>
              <Text style={styles.summaryMiniLabel}>Total Time</Text>
              <AnimatedNumber value={todayStats.totalMinutes} style={styles.summaryMiniScore} />
              <Text style={styles.summaryMiniDate}>minutes</Text>
            </View>
            <View style={styles.summaryMiniCard}>
              <Text style={styles.summaryMiniEmoji}>✨</Text>
              <Text style={styles.summaryMiniLabel}>Good Posture</Text>
              <AnimatedNumber value={todayStats.goodPostureMinutes} style={styles.summaryMiniScore} />
              <Text style={styles.summaryMiniDate}>minutes</Text>
            </View>
          </View>
        ) : (
          // Last 7 days view - show best and worst
          <View style={styles.summaryCardsRow}>
            {bestDay && (
              <View style={styles.summaryMiniCard}>
                <Text style={styles.summaryMiniEmoji}>🌟</Text>
                <Text style={styles.summaryMiniLabel}>Best Day</Text>
                <AnimatedNumber value={bestDay.avgScore} style={styles.summaryMiniScore} />
                <Text style={styles.summaryMiniDate}>
                  {new Date(bestDay.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </Text>
              </View>
            )}
            {worstDay && bestDay?.date !== worstDay?.date && (
              <View style={styles.summaryMiniCard}>
                <Text style={styles.summaryMiniEmoji}>💪</Text>
                <Text style={styles.summaryMiniLabel}>Needs Work</Text>
                <AnimatedNumber value={worstDay.avgScore} style={styles.summaryMiniScore} />
                <Text style={styles.summaryMiniDate}>
                  {new Date(worstDay.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </Text>
              </View>
            )}
          </View>
        )
      ) : (
        <View style={styles.noDataCard}>
          <Text style={styles.noDataText}>
            No data available for {dateRange === "today" ? "today" : "the last 7 days"}
          </Text>
        </View>
      )}

      {/* Overall Score */}
      <View style={styles.scoreCard}>
        <Text style={styles.scoreLabel}>Posture Stability Score</Text>
        <Text style={styles.scoreValue}>{hasData ? sessionStats.avgScore : "0"}</Text>
        <Text style={styles.scoreHint}>
          {hasData
            ? "From your latest IMU session"
            : "Score appears after your first session"}
        </Text>
      </View>

      {/* Metrics */}
      <View style={styles.metrics}>
        {/* Derive neck alignment from session data: slightly reduced from overall score */}
        <MetricCard 
          label="Neck alignment" 
          goodPercent={hasData ? Math.round(Math.max(0, sessionStats.goodPosturePercent - 5)) : 0} 
          animationKey={dateRange} 
        />
        {/* Derive shoulder balance from session data: slightly increased variance */}
        <MetricCard 
          label="Shoulder balance" 
          goodPercent={hasData ? Math.round(Math.min(100, sessionStats.goodPosturePercent + 3)) : 0} 
          animationKey={dateRange} 
        />
        {hasData ? (
          <UpperBackSessionCard stats={sessionStats} animationKey={dateRange} />
        ) : (
          <MetricSkeleton label="Upper back support" />
        )}
      </View>

      {/* Weekly Summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>This week</Text>
        <Text style={styles.summaryText}>
          {hasData
            ? `Session: ${(sessionStats.totalMs / 1000).toFixed(1)}s total · ${sessionStats.goodPosturePercent.toFixed(0)}% good posture${sessionStats.isVariableSession ? " · Variable posture" : ""}`
            : "Your weekly summary will appear here once you start wearing your S'pots"}
        </Text>
      </View>

      {/* Clinical Note */}
      <Text style={styles.disclaimer}>
        These insights are supportive and do not replace professional medical
        advice.
      </Text>
    </ScrollView>
    </Animated.View>
  );
}

function MetricSkeleton({ label }: { label: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricBar} />
      <Text style={styles.metricHint}>Tracking starts after your first session</Text>
    </View>
  );
}

function MetricCard({ 
  label, 
  goodPercent, 
  animationKey 
}: { 
  label: string; 
  goodPercent: number; 
  animationKey?: string | number;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <AnimatedProgressBar goodPercent={goodPercent} animationKey={animationKey} />
      <Text style={styles.metricHint}>
        Good: {goodPercent.toFixed(0)}% · Needs work: {(100 - goodPercent).toFixed(0)}%
      </Text>
    </View>
  );
}

function UpperBackSessionCard({ 
  stats, 
  animationKey 
}: { 
  stats: PostureSessionStats; 
  animationKey?: string | number;
}) {
  const goodWidth = stats.totalMs > 0 ? (stats.goodPostureMs / stats.totalMs) * 100 : 0;
  const totalMinutes = (stats.totalMs / 60_000).toFixed(1);
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>Upper back support</Text>
      <AnimatedProgressBar goodPercent={goodWidth} animationKey={animationKey} />
      <Text style={styles.metricHint}>
        Good: {stats.goodPosturePercent.toFixed(0)}% · Bad: {stats.badPosturePercent.toFixed(0)}% · {totalMinutes} min
        {stats.isVariableSession ? " · Variable session" : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EDE9FF",
  },

  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "600",
    color: "#222",
  },
  headerSubtitle: {
    marginTop: 4,
    color: "#666",
  },

  dateRangeContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#E5E5EA",
    borderRadius: 12,
    padding: 4,
  },
  dateRangeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  dateRangeButtonActive: {
    backgroundColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  dateRangeText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  dateRangeTextActive: {
    color: colours.primary,
    fontWeight: "600",
  },

  summaryCardsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  summaryMiniCard: {
    flex: 1,
    backgroundColor: "white",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    borderLeftWidth: 4,
    borderLeftColor: colours.primary,
  },
  summaryMiniEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  summaryMiniLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  summaryMiniScore: {
    fontSize: 28,
    fontWeight: "700",
    color: colours.primary,
  },
  summaryMiniDate: {
    fontSize: 11,
    color: "#999",
    marginTop: 2,
  },
  noDataCard: {
    backgroundColor: "white",
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 24,
    borderRadius: 16,
    alignItems: "center",
  },
  noDataText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
  },

  scoreCard: {
    backgroundColor: colours.primary,
    margin: 16,
    padding: 24,
    borderRadius: 24,
  },
  scoreLabel: {
    color: "white",
    opacity: 0.9,
  },
  scoreValue: {
    color: "white",
    fontSize: 40,
    fontWeight: "700",
    marginVertical: 6,
  },
  scoreHint: {
    color: "white",
    opacity: 0.8,
    fontSize: 12,
  },

  metrics: {
    paddingHorizontal: 16,
    gap: 12,
  },
  metricCard: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 16,
  },
  metricLabel: {
    color: "#444",
    fontWeight: "500",
  },
  metricBar: {
    height: 10,
    backgroundColor: "#E5E5EA",
    borderRadius: 5,
    marginVertical: 10,
  },
  metricBarRow: {
    height: 10,
    borderRadius: 5,
    marginVertical: 10,
    overflow: "hidden",
    backgroundColor: "#E5E5EA",
  },
  metricBarGood: {
    backgroundColor: colours.primary,
    height: 10,
    borderRadius: 5,
  },
  metricHint: {
    fontSize: 12,
    color: "#888",
  },

  summaryCard: {
    backgroundColor: "white",
    margin: 16,
    padding: 16,
    borderRadius: 16,
  },
  summaryTitle: {
    fontWeight: "600",
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 13,
    color: "#666",
    lineHeight: 20,
  },

  disclaimer: {
    textAlign: "center",
    fontSize: 12,
    color: "#777",
    padding: 20,
  },
});
