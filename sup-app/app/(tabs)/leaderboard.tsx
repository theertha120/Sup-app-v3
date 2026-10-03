import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Dimensions,
  Image,
} from "react-native";
import React, { useCallback, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useFonts } from "expo-font";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HeaderBar from "@/src/components/ui/HeaderBar";
import RefreshButton from "@/src/components/ui/RefreshButton";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import { useAuth } from "@/src/contexts/AuthContext";
import { useLeaderboard } from "@/src/contexts/LeaderboardContext";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { colours } from "@/theme/colours";
import { supabase } from "../../src/lib/supabase";
import ProfileModal from "../../src/components/modals/ProfileModal";
import {
  subscribeToProfileUpdates,
  userProfileToUser,
} from "../../src/services/user/profileService";
import type { LeaderboardEntry } from "../../src/services/social/leaderboardPeriodService";
import { displayName } from "@/src/utils/displayName";
import { UserSupsonaAvatar } from "../../src/components/supsona/SupsonaAvatar";

type Scope = "everyone" | "friends";

const { width: SCREEN_W } = Dimensions.get("window");
const PRIMARY_TEXT = "#1D014A";

// Matches the floating tab bar (LiquidGlass): height 72, offset 25 from the
// bottom, plus the device's safe-area inset — see stats.tsx for the same pattern.
const NAV_BAR_HEIGHT = 72;
const NAV_BOTTOM_OFFSET = 25;

// Fixed window for the at-a-glance summary screen. The full, filterable
// leaderboard (Day / Week / Month / All time) lives on /leaderboard-full.
const SUMMARY_PERIOD = "day" as const;

const BADGE_COLORS = {
  gold: "#F5C242",
  silver: "#B9B9C5",
  bronze: "#7C6A3F",
  default: "#3F2159",
  currentUser: "#4C6FFF",
};

export default function LeaderboardScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const { tutorialStep, setTutorialStep } = useTutorial();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { bottom: bottomInset } = useSafeAreaInsets();
  const scrollPaddingBottom = NAV_BAR_HEIGHT + NAV_BOTTOM_OFFSET + bottomInset + 16;

  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const {
    getEntries,
    isLoading,
    isRefreshing,
    lastUpdatedAt,
    friendCount,
    error,
    refresh,
    ensureFreshForToday,
  } = useLeaderboard();
  const [scope, setScope] = useState<Scope>("everyone");

  // A read-only slice of the cache loaded at login. Switching scope costs no
  // network call, and focusing the tab no longer refetches.
  const entries: LeaderboardEntry[] = getEntries(scope, SUMMARY_PERIOD);

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
      // Reloads only if the calendar day rolled over since the last pull.
      ensureFreshForToday();
    }, [fadeAnim, ensureFreshForToday])
  );

  const top3 = entries.slice(0, 3);
  const nextTwo = entries.slice(3, 5);
  const ownIndex = userId ? entries.findIndex((e) => e.user.id === userId) : -1;
  const ownEntry = ownIndex >= 0 ? entries[ownIndex] : undefined;
  const showOwnRankCard = ownIndex >= 5;

  if (!fontsLoaded) return null;

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: scrollPaddingBottom }}
      >
        <HeaderBar />

        {tutorialStep === "community-tip" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../assets/images/mascot.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>
                this is the leaderboard. everyone's ranked by their weekly points, earned from staying consistent with good posture. it's a fun way to see how you're doing against others!
              </Text>
              <Pressable onPress={() => setTutorialStep("community-tip-full")}>
                <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {tutorialStep === "community-tip-full" && (
          <FullLeaderboardTip onNext={() => setTutorialStep("add-friends-tip")} />
        )}

        <RefreshButton
          onPress={refresh}
          isRefreshing={isRefreshing}
          lastUpdatedAt={lastUpdatedAt}
        />
        {/* Scope toggle — everyone vs friends only */}
        <View style={styles.scopeToggle}>
          {(["everyone", "friends"] as Scope[]).map((s) => (
            <Pressable
              key={s}
              style={[styles.scopeButton, scope === s && styles.scopeButtonActive]}
              onPress={() => setScope(s)}
            >
              <Text
                style={[
                  styles.scopeButtonText,
                  scope === s && styles.scopeButtonTextActive,
                ]}
              >
                {s === "everyone" ? "Everyone" : "Friends"}
              </Text>
            </Pressable>
          ))}
        </View>

        {isLoading ? (
          <Text style={styles.loadingText}>Loading leaderboard…</Text>
        ) : error ? (
          <Text style={styles.loadingText}>{error}</Text>
        ) : scope === "friends" && (friendCount ?? 0) === 0 ? (
          <Text style={styles.loadingText}>
            you haven't added any friends yet — add some from the profile menu to see them here.
          </Text>
        ) : entries.length === 0 ? (
          <Text style={styles.loadingText}>No posture data for this week yet.</Text>
        ) : (
          <>
            {/* ── Podium (top 3) ── */}
            <View style={styles.podium}>
              {top3[2] && (
                <PodiumSlot
                  entry={top3[2]}
                  rank={top3[2].rank}
                  size={70}
                  badgeColor={BADGE_COLORS.bronze}
                  style={styles.podiumThird}
                  isCurrentUser={userId === top3[2].user.id}
                />
              )}
              {top3[1] && (
                <PodiumSlot
                  entry={top3[1]}
                  rank={top3[1].rank}
                  size={90}
                  badgeColor={BADGE_COLORS.silver}
                  style={styles.podiumSecond}
                  isCurrentUser={userId === top3[1].user.id}
                />
              )}
              {top3[0] && (
                <PodiumSlot
                  entry={top3[0]}
                  rank={top3[0].rank}
                  size={150}
                  badgeColor={BADGE_COLORS.gold}
                  style={styles.podiumFirst}
                  nameStyle={styles.podiumFirstName}
                  isCurrentUser={userId === top3[0].user.id}
                />
              )}
            </View>

            {/* ── 4th & 5th ── */}
            {nextTwo.length > 0 && (
              <View style={styles.list}>
                {nextTwo.map((entry) => (
                  <LeaderboardChip
                    key={entry.user.id}
                    rank={entry.rank}
                    entry={entry}
                    isCurrentUser={userId ? entry.user.id === userId : false}
                  />
                ))}
              </View>
            )}

            {/* ── your rank ── */}
            {showOwnRankCard && ownEntry && (
              <View style={[styles.list, styles.ownRankList]}>
                <LeaderboardChip rank={ownEntry.rank} entry={ownEntry} isCurrentUser />
              </View>
            )}

            {/* ── See full leaderboard ── */}
            <Pressable
              style={[
                styles.fullLeaderboardButton,
                tutorialStep === "community-tip-full" && styles.fullLeaderboardButtonHighlighted,
              ]}
              onPress={() =>
                router.push({ pathname: "/leaderboard-full", params: { period: SUMMARY_PERIOD } })
              }
            >
              <Text style={styles.fullLeaderboardButtonText}>see full leaderboard</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Animated.View>
  );
}

// Shown at the top of the screen; the button it refers to is highlighted at the
// same time, further down the page.
const FULL_LEADERBOARD_TIP =
  "tap 'see full leaderboard' at the bottom of this page to see everyone and where you're placed.";

function FullLeaderboardTip({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.tutorialTip}>
      <Image
        source={require("../../assets/images/mascot.png")}
        style={styles.tutorialTipMascot}
        resizeMode="contain"
      />
      <View style={styles.tutorialTipTextWrap}>
        <Text style={styles.tutorialTipText}>{FULL_LEADERBOARD_TIP}</Text>
        <Pressable onPress={onNext}>
          <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface PodiumSlotProps {
  entry: LeaderboardEntry;
  rank: number;
  size: number;
  badgeColor: string;
  style?: any;
  nameStyle?: any;
  isCurrentUser: boolean;
}

function PodiumSlot({ entry, rank, size, badgeColor, style, nameStyle, isCurrentUser }: PodiumSlotProps) {
  return (
    <View style={[styles.podiumSlot, style]}>
      <View style={{ width: size, height: size }}>
        <UserSupsonaAvatar
          avatar={entry.user.avatar}
          name={displayName(entry.user)}
          size={size}
          defaultAvatarBackgroundColor="#D9D9D9"
        />
        <View style={[styles.podiumBadge, { backgroundColor: badgeColor }]}>
          <Text style={styles.podiumBadgeText}>{rank}</Text>
        </View>
      </View>
      <Text
        style={[styles.podiumName, nameStyle, isCurrentUser && styles.podiumNameCurrentUser]}
        numberOfLines={1}
      >
        {isCurrentUser ? "You" : displayName(entry.user)}
      </Text>
    </View>
  );
}

interface LeaderboardChipProps {
  rank: number;
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
}

function LeaderboardChip({ rank, entry, isCurrentUser }: LeaderboardChipProps) {
  const badgeColor = isCurrentUser ? BADGE_COLORS.currentUser : BADGE_COLORS.default;
  return (
    <View style={styles.chip}>
      <View style={styles.chipAvatarWrap}>
        <UserSupsonaAvatar
          avatar={entry.user.avatar}
          name={displayName(entry.user)}
          size={40}
          defaultAvatarBackgroundColor="#D9D9D9"
        />
        <View style={[styles.chipBadge, { backgroundColor: badgeColor }]}>
          <Text style={styles.chipBadgeText}>{rank}</Text>
        </View>
      </View>
      <Text style={[styles.chipName, isCurrentUser && styles.chipNameCurrentUser]}>
        {isCurrentUser ? "You" : displayName(entry.user)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: PRIMARY_TEXT,
    opacity: 0.6,
    textAlign: "center",
    marginTop: 40,
  },
  scopeToggle: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginBottom: 14,
    backgroundColor: "rgba(63, 36, 131, 0.08)",
    borderRadius: 18,
    padding: 4,
  },
  scopeButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: "center",
  },
  scopeButtonActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  scopeButtonText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 12,
    color: PRIMARY_TEXT,
    opacity: 0.6,
  },
  scopeButtonTextActive: {
    fontFamily: "Agrandir-GrandHeavy",
    opacity: 1,
  },

  /* Tutorial tip */
  tutorialTip: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 14,
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

  /* Podium */
  podium: {
    height: 260,
    marginBottom: 28,
  },
  podiumSlot: {
    position: "absolute",
    alignItems: "center",
  },
  podiumThird: {
    top: 20,
    left: "6%",
  },
  podiumSecond: {
    top: 0,
    right: "6%",
  },
  podiumFirst: {
    top: 50,
    left: "50%",
    marginLeft: -75, // half of size (150)
  },
  podiumBadge: {
    position: "absolute",
    top: -4,
    left: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  podiumBadgeText: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 12,
    color: "#FFFFFF",
  },
  podiumName: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 13,
    color: PRIMARY_TEXT,
    marginTop: 8,
    maxWidth: 100,
    textAlign: "center",
  },
  podiumFirstName: {
    fontSize: 16,
    marginTop: 12,
    maxWidth: 160,
  },
  podiumNameCurrentUser: {
    color: BADGE_COLORS.currentUser,
  },

  /* Rank chips (4th, 5th, your rank) */
  list: {
    marginHorizontal: 24,
    gap: 14,
  },
  ownRankList: {
    marginTop: 22,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    height: 56,
    marginLeft: 16,
    paddingLeft: 34,
    paddingRight: 20,
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  chipAvatarWrap: {
    position: "absolute",
    left: -16,
    top: "50%",
    marginTop: -20,
    width: 40,
    height: 40,
  },
  chipBadge: {
    position: "absolute",
    top: -6,
    left: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  chipBadgeText: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 11,
    color: "#FFFFFF",
  },
  chipName: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 14,
    color: PRIMARY_TEXT,
  },
  chipNameCurrentUser: {
    color: BADGE_COLORS.currentUser,
  },

  /* CTA */
  fullLeaderboardButton: {
    alignSelf: "center",
    marginTop: 28,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  fullLeaderboardButtonHighlighted: {
    borderWidth: 3,
    borderColor: "#5222AE",
    backgroundColor: "#FFFFFF",
    shadowColor: "#5222AE",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  fullLeaderboardButtonText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: PRIMARY_TEXT,
  },
});