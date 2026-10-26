import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "./AuthContext";
import { captureError } from "../lib/sentry";
import { toLocalDateKey } from "../lib/dateKey";
import { createLeaderboardSource } from "../services/social/leaderboardPageService";
import { EMPTY_BOARD, LeaderboardStore } from "../services/social/leaderboardStore";
import { LEADERBOARD_PAGE_SIZE, type LeaderboardScope } from "../services/social/leaderboardData";
import { getLocalSupsona, subscribeToProfileUpdates } from "../services/user/profileService";
import type { LeaderboardEntry, LeaderboardPeriod } from "../services/social/leaderboardPeriodService";
export type { LeaderboardScope } from "../services/social/leaderboardData";

function useAccountBoard() {
  const { userId, isAuthenticated } = useAuth();
  const [, render] = useState(0);
  const [avatar, setAvatar] = useState<{ userId: string; value: string | undefined; override: boolean } | null>(null);
  const store = useMemo(() => userId && isAuthenticated
    ? new LeaderboardStore(createLeaderboardSource(userId), () => render((n) => n + 1), Date.now, { reportError: (error) => captureError(error, "community-leaderboard") }) : null, [userId, isAuthenticated]);
  useEffect(() => { store?.activate(); return () => store?.dispose(); }, [store]);
  useEffect(() => {
    if (!userId || !isAuthenticated) return;
    let active = true;
    let profileChanged = false;
    // Stored cosmetics never block the leaderboard request.
    void getLocalSupsona(userId).then((value) => {
      if (active && !profileChanged) setAvatar({ userId, value: value ?? undefined, override: value != null });
    });
    const unsubscribe = subscribeToProfileUpdates((profile) => {
      if (profile.id !== userId) return;
      profileChanged = true;
      setAvatar({ userId, value: profile.avatar ?? undefined, override: true });
    });
    return () => { active = false; unsubscribe(); };
  }, [userId, isAuthenticated]);
  return { store, avatar: avatar?.userId === userId ? avatar : null };
}
const LeaderboardContext = createContext<ReturnType<typeof useAccountBoard> | undefined>(undefined);

/** Login creates a cache, but visible screens decide which period to fetch. */
export function LeaderboardProvider({ children }: { children: ReactNode }) {
  const value = useAccountBoard();
  return <LeaderboardContext.Provider value={value}>{children}</LeaderboardContext.Provider>;
}

export function useLeaderboard(scope: LeaderboardScope, period: LeaderboardPeriod, size = LEADERBOARD_PAGE_SIZE) {
  const account = useContext(LeaderboardContext);
  if (!account) throw new Error("useLeaderboard must be used within a LeaderboardProvider");
  const { store, avatar } = account;
  const [dateKey, setDateKey] = useState(toLocalDateKey());
  useFocusEffect(useCallback(() => {
    const today = toLocalDateKey();
    setDateKey(today);
    void store?.ensure({ scope, period, dateKey: today }, size);
  }, [store, scope, period, size]));
  const query = useMemo(() => ({ scope, period, dateKey }), [scope, period, dateKey]);
  const view = store?.get(query) ?? EMPTY_BOARD;
  const refresh = useCallback(() => store?.ensure(query, size, true) ?? Promise.resolve(), [store, query, size]);
  const loadMore = useCallback(() => store?.more(query) ?? Promise.resolve(), [store, query]);
  const decorate = useCallback((entry: LeaderboardEntry | null) => entry && avatar?.override && entry.user.id === avatar.userId
    ? { ...entry, user: { ...entry.user, avatar: avatar.value } } : entry, [avatar]);
  const entries = useMemo(() => view.entries.map((entry) => decorate(entry)!), [view.entries, decorate]);
  return { ...view, entries, ownEntry: decorate(view.ownEntry), refresh, loadMore,
    isLoading: !!store && view.updatedAt === null && !view.error,
    isRefreshing: view.pending && view.updatedAt !== null,
    lastUpdatedAt: view.updatedAt };
}
