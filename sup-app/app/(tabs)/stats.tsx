import { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colours } from "../../theme/colours";
import {
  analyzeIMUStream,
  type IMUReading,
  type PostureSessionStats,
} from "../../src/services/postureAnalysisService";

// Mock stream: replace with real session data; empty = no data (startup state)
const mockStream = require("../../src/data/mock_imu_stream.json") as IMUReading[];
const calibration = require("../../src/data/calibration_good_posture.json") as IMUReading[] | null;

export default function StatsScreen() {
  const sessionStats = useMemo(() => {
    const stream = mockStream?.length ? mockStream : [];
    if (stream.length === 0) return null;
    return analyzeIMUStream(stream, calibration ?? undefined);
  }, []);

  const hasData = sessionStats != null && sessionStats.totalMs > 0;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your posture health</Text>
        <Text style={styles.headerSubtitle}>Based on daily wearable data</Text>
      </View>

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
        <MetricSkeleton label="Neck alignment" />
        <MetricSkeleton label="Shoulder balance" />
        {hasData ? (
          <UpperBackSessionCard stats={sessionStats} />
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

function UpperBackSessionCard({ stats }: { stats: PostureSessionStats }) {
  const goodWidth = stats.totalMs > 0 ? (stats.goodPostureMs / stats.totalMs) * 100 : 0;
  const totalMinutes = (stats.totalMs / 60_000).toFixed(1);
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>Upper back support</Text>
      <View style={styles.metricBarRow}>
        <View style={[styles.metricBarGood, { flex: goodWidth }]} />
        <View style={[styles.metricBarBad, { flex: 100 - goodWidth }]} />
      </View>
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
    backgroundColor: "#F6F6FA",
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
    flexDirection: "row",
    height: 10,
    borderRadius: 5,
    marginVertical: 10,
    overflow: "hidden",
  },
  metricBarGood: {
    backgroundColor: colours.primary,
    minWidth: 0,
  },
  metricBarBad: {
    backgroundColor: "#E5E5EA",
    minWidth: 0,
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
