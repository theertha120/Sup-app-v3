import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colours } from "../../theme/colours";
import DeskPostureFigure from "../../src/components/desk/DeskPostureFigure";
import {
  MOCK_DESK_POSTURE_SEQUENCE,
  getScoreColor,
  getScoreLabel,
  type DeskPostureSnapshot,
} from "../../src/components/desk/mockDeskPostureData";

const CYCLE_INTERVAL_MS = 3500; // how long each snapshot is shown

// State-specific tip copy
const POSTURE_TIPS: Record<string, string> = {
  upright:      "Keep your feet flat, shoulders relaxed, and eyes level with the screen.",
  forward_lean: "Sit back into your chair. Move your screen closer if needed.",
  slouched:     "Engage your core and roll your shoulders back and down.",
  tilted_left:  "Centre your weight evenly across both sit bones.",
  tilted_right: "Centre your weight evenly across both sit bones.",
};

export default function DeskScreen() {
  const [snapshotIndex, setSnapshotIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const elapsedRef = useRef(0);

  const currentSnapshot: DeskPostureSnapshot =
    MOCK_DESK_POSTURE_SEQUENCE[snapshotIndex];

  // Advance to next snapshot
  const advance = useCallback(() => {
    setSnapshotIndex((prev) =>
      (prev + 1) % MOCK_DESK_POSTURE_SEQUENCE.length
    );
    elapsedRef.current += 1;
    setElapsedS(elapsedRef.current);
  }, []);

  // Play / pause logic
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(advance, CYCLE_INTERVAL_MS);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, advance]);

  const togglePlayPause = () => setIsPlaying((p) => !p);

  const handleDotPress = (idx: number) => {
    setSnapshotIndex(idx);
  };

  const accentColor = getScoreColor(currentSnapshot.score);
  const scoreLabel = getScoreLabel(currentSnapshot.score);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Desk Mode</Text>
          <Text style={styles.headerSub}>Live posture analysis</Text>
        </View>

        {/* ── Score badge ── */}
        <View style={[styles.scoreBadge, { borderColor: accentColor }]}>
          <Text style={[styles.scoreNumber, { color: accentColor }]}>
            {currentSnapshot.score}
          </Text>
          <Text style={[styles.scoreLabel, { color: accentColor }]}>
            {scoreLabel}
          </Text>
        </View>

        {/* ── Figure card ── */}
        <View style={styles.figureCard}>
          {/* Animated figure */}
          <View style={styles.figureWrapper}>
            <DeskPostureFigure
              state={currentSnapshot.state}
              score={currentSnapshot.score}
            />
          </View>

          {/* State label + description */}
          <View style={styles.stateInfo}>
            <Text style={[styles.stateLabel, { color: accentColor }]}>
              {currentSnapshot.label}
            </Text>
            <Text style={styles.stateDescription}>
              {currentSnapshot.description}
            </Text>
          </View>
        </View>

        {/* ── Timeline dots ── */}
        <View style={styles.timelineRow}>
          {MOCK_DESK_POSTURE_SEQUENCE.map((snap, idx) => {
            const dotColor = getScoreColor(snap.score);
            const isActive = idx === snapshotIndex;
            return (
              <Pressable
                key={idx}
                onPress={() => handleDotPress(idx)}
                style={[
                  styles.dot,
                  {
                    backgroundColor: isActive ? dotColor : dotColor + "55",
                    transform: [{ scale: isActive ? 1.4 : 1 }],
                  },
                ]}
                accessibilityLabel={`Go to snapshot ${idx + 1}`}
              />
            );
          })}
        </View>

        {/* ── Play / Pause control ── */}
        <Pressable
          style={[styles.playBtn, { borderColor: colours.primary }]}
          onPress={togglePlayPause}
          accessibilityLabel={isPlaying ? "Pause simulation" : "Play simulation"}
        >
          <Ionicons
            name={isPlaying ? "pause-circle" : "play-circle"}
            size={28}
            color={colours.primary}
          />
          <Text style={styles.playBtnText}>
            {isPlaying ? "Pause simulation" : "Resume simulation"}
          </Text>
        </Pressable>

        {/* ── Tip card ── */}
        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Ionicons name="bulb-outline" size={18} color={colours.primary} />
            <Text style={styles.tipTitle}>Tip</Text>
          </View>
          <Text style={styles.tipText}>
            {POSTURE_TIPS[currentSnapshot.state]}
          </Text>
        </View>

        {/* ── Session snapshot list ── */}
        <Text style={styles.sectionTitle}>Session Snapshots</Text>
        <View style={styles.snapshotList}>
          {MOCK_DESK_POSTURE_SEQUENCE.map((snap, idx) => {
            const color = getScoreColor(snap.score);
            const isActive = idx === snapshotIndex;
            return (
              <Pressable
                key={idx}
                onPress={() => handleDotPress(idx)}
                style={[
                  styles.snapshotRow,
                  isActive && { backgroundColor: colour(color, 0.08) },
                ]}
              >
                {/* Colour indicator bar */}
                <View style={[styles.snapshotBar, { backgroundColor: color }]} />
                <View style={styles.snapshotText}>
                  <Text style={styles.snapshotLabel}>{snap.label}</Text>
                  <Text style={styles.snapshotDesc}>{snap.description}</Text>
                </View>
                <Text style={[styles.snapshotScore, { color }]}>
                  {snap.score}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Tints a hex colour with alpha for background use */
function colour(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colours.background,
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    alignItems: "center",
  },

  // Header
  header: {
    alignSelf: "stretch",
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: colours.textPrimary,
  },
  headerSub: {
    fontSize: 14,
    color: colours.textSecondary,
    marginTop: 2,
  },

  // Score badge
  scoreBadge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    backgroundColor: colours.card,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  scoreNumber: {
    fontSize: 34,
    fontWeight: "800",
  },
  scoreLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Figure card
  figureCard: {
    backgroundColor: colours.card,
    borderRadius: 20,
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignSelf: "stretch",
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  figureWrapper: {
    height: 280,
    justifyContent: "center",
    alignItems: "center",
  },
  stateInfo: {
    marginTop: 12,
    alignItems: "center",
  },
  stateLabel: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  stateDescription: {
    fontSize: 14,
    color: colours.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },

  // Timeline dots
  timelineRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // Play button
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 30,
    paddingVertical: 10,
    paddingHorizontal: 22,
    marginBottom: 24,
    backgroundColor: colours.card,
  },
  playBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colours.primary,
  },

  // Tip card
  tipCard: {
    backgroundColor: colours.primarySoft,
    borderRadius: 14,
    padding: 16,
    alignSelf: "stretch",
    marginBottom: 24,
  },
  tipHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colours.primary,
  },
  tipText: {
    fontSize: 14,
    color: colours.textPrimary,
    lineHeight: 21,
  },

  // Snapshot list
  sectionTitle: {
    alignSelf: "stretch",
    fontSize: 16,
    fontWeight: "700",
    color: colours.textPrimary,
    marginBottom: 10,
  },
  snapshotList: {
    alignSelf: "stretch",
    gap: 8,
  },
  snapshotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colours.card,
    borderRadius: 12,
    padding: 12,
  },
  snapshotBar: {
    width: 4,
    height: 36,
    borderRadius: 2,
  },
  snapshotText: {
    flex: 1,
  },
  snapshotLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colours.textPrimary,
  },
  snapshotDesc: {
    fontSize: 12,
    color: colours.textSecondary,
    marginTop: 2,
  },
  snapshotScore: {
    fontSize: 20,
    fontWeight: "800",
  },
});
