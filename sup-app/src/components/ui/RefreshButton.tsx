import PressFeedback from "@/src/components/ui/PressFeedback";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY_TEXT = "#1D014A";

function formatAge(lastUpdatedAt: number | null): string {
  if (!lastUpdatedAt) return "not loaded yet";
  const seconds = Math.floor((Date.now() - lastUpdatedAt) / 1000);
  if (seconds < 60) return "updated just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours}h ago`;
  return `updated ${Math.floor(hours / 24)}d ago`;
}

interface RefreshButtonProps {
  onPress: () => void;
  isRefreshing: boolean;
  lastUpdatedAt: number | null;
  /** Hide the "updated Xm ago" caption when space is tight. */
  showTimestamp?: boolean;
}

/**
 * Manual refresh control. Data that used to be re-pulled on every screen focus
 * is now loaded once and refreshed only when the user asks, so this button is
 * the sole path to a fresh pull.
 */
export default function RefreshButton({
  onPress,
  isRefreshing,
  lastUpdatedAt,
  showTimestamp = true,
}: RefreshButtonProps) {
  return (
    <View style={styles.wrap}>
      {showTimestamp && <Text style={styles.timestamp}>{formatAge(lastUpdatedAt)}</Text>}
      <PressFeedback
        onPress={onPress}
        disabled={isRefreshing}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Refresh leaderboard"
        style={styles.button}
      >
        {isRefreshing ? (
          <ActivityIndicator size="small" color={PRIMARY_TEXT} />
        ) : (
          <Ionicons name="refresh" size={16} color={PRIMARY_TEXT} />
        )}
        <Text style={styles.label}>{isRefreshing ? "refreshing…" : "refresh"}</Text>
      </PressFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginHorizontal: 24,
    marginBottom: 12,
  },
  timestamp: {
    fontFamily: "Agrandir-Regular",
    fontSize: 11,
    color: PRIMARY_TEXT,
    opacity: 0.5,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.65)",
    minWidth: 104,
    justifyContent: "center",
  },
  label: {
    fontFamily: "Agrandir-Regular",
    fontSize: 12,
    color: PRIMARY_TEXT,
  },
});
