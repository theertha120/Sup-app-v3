import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { StatsHistoryStore, type StatsWindow } from "../services/stats/statsHistoryStore";
import { fetchEarliestStatsDate, fetchStatsWindow } from "../services/stats/statsHistoryService";

function useHistoryValue() {
  const { userId, isAuthenticated } = useAuth();
  const [, render] = useState(0);
  // A new account gets a separate cache; old requests can never write into it.
  const store = useMemo(() => new StatsHistoryStore({
    fetchWindow: (start, end) => userId && isAuthenticated ? fetchStatsWindow(userId, start, end) : Promise.resolve([]),
    fetchEarliest: () => userId && isAuthenticated ? fetchEarliestStatsDate(userId) : Promise.resolve(null),
  }, () => render((n) => n + 1)), [userId, isAuthenticated]);

  const ensureWindow = useCallback((window: StatsWindow) => {
    if (!userId || !isAuthenticated) return Promise.resolve();
    void store.ensureEarliest();
    return store.ensureWindow(window);
  }, [store, userId, isAuthenticated]);
  const observe = useCallback((id: string, windows: StatsWindow[]) => store.observe(id, windows), [store]);
  const refresh = useCallback(() => store.refresh(), [store]);
  const ensureFresh = useCallback(() => store.refresh(false), [store]);

  useEffect(() => { store.activate(); return () => store.dispose(); }, [store]);
  return { ...store.state, ensureWindow, observe, refresh, ensureFresh };
}

const PostureHistoryContext = createContext<ReturnType<typeof useHistoryValue> | undefined>(undefined);

/** Stats loads bounded chart windows on demand, rather than history at login. */
export function PostureHistoryProvider({ children }: { children: ReactNode }) {
  const value = useHistoryValue();
  return <PostureHistoryContext.Provider value={value}>{children}</PostureHistoryContext.Provider>;
}

export function usePostureHistory() {
  const context = useContext(PostureHistoryContext);
  if (!context) throw new Error("usePostureHistory must be used within a PostureHistoryProvider");
  return context;
}
