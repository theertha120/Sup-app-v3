import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "./AuthContext";
import { toLocalDateKey } from "../lib/dateKey";
import { createLeaderboardSource } from "../services/social/leaderboardPageService";
import { EMPTY_BOARD, LeaderboardStore } from "../services/social/leaderboardStore";
import { LEADERBOARD_PAGE_SIZE, type LeaderboardScope } from "../services/social/leaderboardData";
import type { LeaderboardPeriod } from "../services/social/leaderboardPeriodService";
export type { LeaderboardScope } from "../services/social/leaderboardData";

function useAccountBoard() {
  const { userId, isAuthenticated } = useAuth();
  const [, render] = useState(0);
  const store = useMemo(() => userId && isAuthenticated
    ? new LeaderboardStore(createLeaderboardSource(userId), () => render((n) => n + 1)) : null, [userId, isAuthenticated]);
  useEffect(() => { store?.activate(); return () => store?.dispose(); }, [store]);
  return { store };
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
  const { store } = account;
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
  return { ...view, refresh, loadMore,
    isLoading: !!store && view.updatedAt === null && !view.error,
    isRefreshing: view.pending && view.updatedAt !== null,
    lastUpdatedAt: view.updatedAt };
}
