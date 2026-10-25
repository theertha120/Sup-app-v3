import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "./AuthContext";
import { toLocalDateKey } from "../lib/dateKey";
import { getLocalSupsona, subscribeToProfileUpdates } from "../services/user/profileService";
import { createLeaderboardSource, LEADERBOARD_PAGE_SIZE, LEADERBOARD_STALE_MS, type LeaderboardScope } from "../services/social/leaderboardPageService";
import { EMPTY_LEADERBOARD, LeaderboardStore } from "../services/social/leaderboardStore";
import type { LeaderboardEntry, LeaderboardPeriod } from "../services/social/leaderboardPeriodService";
export type { LeaderboardScope } from "../services/social/leaderboardPageService";

function useLeaderboardValue() {
  const { userId, isAuthenticated } = useAuth();
  const [, render] = useState(0);
  const [localAvatar, setLocalAvatar] = useState<{ userId: string; avatar: string | null } | null>(null);
  const store = useMemo(() => userId && isAuthenticated
    ? new LeaderboardStore(createLeaderboardSource(userId), () => render((n) => n + 1)) : null, [userId, isAuthenticated]);
  useEffect(() => { store?.activate(); return () => store?.dispose(); }, [store]);
  useEffect(() => {
    if (!userId || !isAuthenticated) return;
    let active = true;
    // Cosmetic local data never delays the ranking request.
    void getLocalSupsona(userId).then((avatar) => { if (active) setLocalAvatar({ userId, avatar }); });
    const unsubscribe = subscribeToProfileUpdates((profile) => {
      if (profile.id === userId) setLocalAvatar({ userId, avatar: profile.avatar ?? null });
    });
    return () => { active = false; unsubscribe(); };
  }, [userId, isAuthenticated]);
  return { store, userId, localAvatar: localAvatar?.userId === userId ? localAvatar.avatar : null };
}
const LeaderboardContext = createContext<ReturnType<typeof useLeaderboardValue> | undefined>(undefined);

/** No leaderboard network work at sign-in; each visible view requests its own page. */
export function LeaderboardProvider({ children }: { children: ReactNode }) {
  const value = useLeaderboardValue();
  return <LeaderboardContext.Provider value={value}>{children}</LeaderboardContext.Provider>;
}

export function useLeaderboard(scope: LeaderboardScope, period: LeaderboardPeriod, size = LEADERBOARD_PAGE_SIZE) {
  const context = useContext(LeaderboardContext);
  if (!context) throw new Error("useLeaderboard must be used within a LeaderboardProvider");
  const { store, userId, localAvatar } = context;
  const [dateKey, setDateKey] = useState(toLocalDateKey());
  useFocusEffect(useCallback(() => {
    const check = () => {
      if (AppState.currentState && AppState.currentState !== "active") return;
      const today = toLocalDateKey();
      setDateKey(today);
      void store?.ensure({ scope, period, dateKey: today }, size);
    };
    check();
    const timer = setInterval(check, LEADERBOARD_STALE_MS);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") check(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [store, scope, period, size]));
  const query = useMemo(() => ({ scope, period, dateKey }), [scope, period, dateKey]);
  const view = store?.get(query) ?? EMPTY_LEADERBOARD;
  const refresh = useCallback(() => store?.ensure(query, size, true) ?? Promise.resolve(), [store, query, size]);
  const loadMore = useCallback(() => store?.loadMore(query) ?? Promise.resolve(), [store, query]);
  const withAvatar = useCallback((entry: LeaderboardEntry | null) => entry && entry.user.id === userId && localAvatar != null
    ? { ...entry, user: { ...entry.user, avatar: localAvatar } } : entry, [userId, localAvatar]);
  const entries = useMemo(() => view.entries.map((entry) => withAvatar(entry)!), [view.entries, withAvatar]);
  return { ...view, entries, ownEntry: withAvatar(view.ownEntry), refresh, loadMore,
    isLoading: !!store && (view.isLoading || (view.lastUpdatedAt === null && !view.error)) };
}
