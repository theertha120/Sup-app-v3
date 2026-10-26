import PressFeedback from "@/src/components/ui/PressFeedback";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Animated,
} from "react-native";
import React, { useCallback, useRef, useState, useEffect } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import HeaderBar from "../src/components/ui/HeaderBar";
import RefreshButton from "../src/components/ui/RefreshButton";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import { useAuth } from "../src/contexts/AuthContext";
import { useLeaderboard } from "../src/contexts/LeaderboardContext";
import type {
  LeaderboardEntry,
  LeaderboardPeriod,
} from "../src/services/social/leaderboardPeriodService";
import { displayName } from "../src/utils/displayName";
import { UserSupsonaAvatar } from "../src/components/supsona/SupsonaAvatar";

const PRIMARY_TEXT = "#1D014A";

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
];

type Scope = "everyone" | "friends";

export default function FullLeaderboardScreen() {
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ period?: LeaderboardPeriod }>();
  const initialPeriod: LeaderboardPeriod =
    params.period && PERIODS.some((p) => p.key === params.period)
      ? (params.period as LeaderboardPeriod)
      : "week";

  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);
  const [scope, setScope] = useState<Scope>("everyone");
  const listRef = useRef<FlatList<LeaderboardEntry>>(null);
  useEffect(() => { listRef.current?.scrollToOffset({ offset: 0, animated: false }); }, [scope, period]);

  const {
    entries,
    pending,
    loadingMore,
    total,
    loadMore,
    isLoading,
    isRefreshing,
    lastUpdatedAt,
    friendCount,
    error,
    refresh,
  } = useLeaderboard(scope, period);

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, [fadeAnim])
  );

  const renderItem = useCallback(({ item }: { item: LeaderboardEntry }) =>
    <LeaderboardRow rank={item.rank} entry={item} isCurrentUser={item.user.id === userId} />, [userId]);
  const showFriends = scope !== "friends" || friendCount > 0;
  const emptyMessage = isLoading ? "Loading leaderboard…" : error
    ?? (!showFriends ? "you haven't added any friends yet — add some from the profile menu to see them here." : "No posture data for this period yet.");
  if (!fontsLoaded) return null;

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <FlatList
        ref={listRef}
        style={styles.container}
        data={showFriends ? entries : []}
        keyExtractor={(entry) => entry.user.id}
        renderItem={renderItem}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        onEndReached={() => { if (!pending && !error && entries.length < total) void loadMore(); }}
        onEndReachedThreshold={0.5}
        refreshing={isRefreshing}
        onRefresh={refresh}
        ListHeaderComponent={<>
        <HeaderBar />

        <View style={styles.sectionRow}>
          <PressFeedback feedback="scale" onPress={() => router.back()} style={styles.backArrow} hitSlop={8}>
            <Ionicons name="arrow-back" size={20} color={PRIMARY_TEXT} />
          </PressFeedback>
          <Text style={styles.sectionLabel}>Full Leaderboard</Text>
        </View>

        <RefreshButton
          onPress={refresh}
          isRefreshing={isRefreshing}
          lastUpdatedAt={lastUpdatedAt}
        />
        {/* Scope toggle — everyone vs friends only */}
        <View style={styles.periodToggle}>
          {(["everyone", "friends"] as Scope[]).map((s) => (
            <PressFeedback
              key={s}
              style={[styles.periodButton, scope === s && styles.periodButtonActive]}
              onPress={() => setScope(s)}
            >
              <Text
                style={[
                  styles.periodButtonText,
                  scope === s && styles.periodButtonTextActive,
                ]}
              >
                {s === "everyone" ? "Everyone" : "Friends"}
              </Text>
            </PressFeedback>
          ))}
        </View>

        {/* Period toggle */}
        <View style={styles.periodToggle}>
          {PERIODS.map((p) => (
            <PressFeedback
              key={p.key}
              style={[styles.periodButton, period === p.key && styles.periodButtonActive]}
              onPress={() => setPeriod(p.key)}
            >
              <Text
                style={[
                  styles.periodButtonText,
                  period === p.key && styles.periodButtonTextActive,
                ]}
              >
                {p.label}
              </Text>
            </PressFeedback>
          ))}
        </View>

          {error && entries.length > 0 && <Text style={styles.loadingText}>{error}</Text>}
        </>}
        ListEmptyComponent={<Text style={styles.loadingText}>{emptyMessage}</Text>}
        ListFooterComponent={<View style={{ paddingBottom: 32 }}>
          {loadingMore && <Text style={styles.loadingText}>Loading more…</Text>}
          {error && entries.length > 0 && entries.length < total && <PressFeedback onPress={loadMore}>
            <Text style={styles.loadingText}>retry loading more</Text>
          </PressFeedback>}
        </View>}
      />
    </Animated.View>
  );
}

interface LeaderboardRowProps {
  rank: number;
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
}

const LeaderboardRow = React.memo(function LeaderboardRow({ rank, entry, isCurrentUser }: LeaderboardRowProps) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <View style={[styles.row, isCurrentUser && styles.currentUserRow]}>
      <View style={styles.rankContainer}>
        {medal ? (
          <Text style={styles.medal}>{medal}</Text>
        ) : (
          <Text style={[styles.rank, isCurrentUser && styles.currentUserText]}>{rank}</Text>
        )}
      </View>

      <UserSupsonaAvatar
        avatar={entry.user.avatar}
        name={displayName(entry.user)}
        size={40}
        defaultAvatarBackgroundColor="white"
      />

      <View style={styles.info}>
        <Text style={[styles.name, isCurrentUser && styles.currentUserText]}>
          {displayName(entry.user)}
          {isCurrentUser && " (You)"}
        </Text>
        <Text style={[styles.stats, isCurrentUser && styles.currentUserStats]}>
        s&apos;up score: {entry.avgSupScore.toFixed(1)}
        </Text>
      </View>
    </View>
  );
});

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

  periodToggle: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginBottom: 18,
    backgroundColor: "rgba(63, 36, 131, 0.08)",
    borderRadius: 18,
    padding: 4,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: "center",
  },
  periodButtonActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  periodButtonText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 12,
    color: PRIMARY_TEXT,
    opacity: 0.6,
  },
  periodButtonTextActive: {
    fontFamily: "Agrandir-GrandHeavy",
    opacity: 1,
  },

  loadingText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.6,
    textAlign: "center",
    marginTop: 40,
  },

  row: {
    marginHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    gap: 12,
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  currentUserRow: {
    backgroundColor: "#AB99FA",
  },
  rankContainer: {
    width: 30,
    alignItems: "center",
  },
  rank: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 15,
    color: PRIMARY_TEXT,
    opacity: 0.6,
  },
  medal: {
    fontSize: 18,
  },
  currentUserText: {
    color: "#FFFFFF",
    opacity: 1,
  },
  currentUserStats: {
    color: "#FFFFFF",
    opacity: 0.85,
  },
  info: {
    flex: 1,
  },
  name: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: PRIMARY_TEXT,
    marginBottom: 2,
  },
  stats: {
    fontFamily: "Agrandir-Regular",
    fontSize: 12,
    color: PRIMARY_TEXT,
    opacity: 0.6,
  },
});