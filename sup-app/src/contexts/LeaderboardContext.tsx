import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@/constants/env";
import { useAuth } from "./AuthContext";
import { fetchLeaderboardByStreak } from "@/src/services/social/leaderboardService";
import { getFriendsForUser } from "@/src/services/social/friendService";
import {
  fetchPostureRowsForLeaderboard,
  rankLeaderboard,
  toDateKey,
  WIDEST_LEADERBOARD_PERIOD,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type LeaderboardRowsByUser,
} from "@/src/services/social/leaderboardPeriodService";

export type LeaderboardScope = "everyone" | "friends";

/**
 * One fetched snapshot of everything the leaderboard screens render. Held as a
 * single object so a refresh swaps it atomically — the UI never sees a roster
 * from one pull paired with rows from another.
 */
interface LeaderboardSnapshot {
  roster: User[];
  rowsByUser: LeaderboardRowsByUser;
  friendIds: string[];
  /** Local date the snapshot was anchored on, so we can spot a day rollover. */
  dateKey: string;
  loadedAt: number;
}

interface LeaderboardContextType {
  /** True only while the first load is in flight and there is nothing to show. */
  isLoading: boolean;
  /** True while a manual refresh runs over data that is already on screen. */
  isRefreshing: boolean;
  error: string | null;
  /** Epoch ms of the last successful load, or null if none yet. */
  lastUpdatedAt: number | null;
  /** Accepted friends of the signed-in user, or null before the first load. */
  friendCount: number | null;
  /** Ranked entries for a view. Reads the cache — never hits the network. */
  getEntries: (scope: LeaderboardScope, period: LeaderboardPeriod) => LeaderboardEntry[];
  /** Pull fresh data. Wire this to a refresh button. */
  refresh: () => Promise<void>;
  /**
   * Reloads only if the local calendar day has rolled over since the last load,
   * which would otherwise leave the "day" board showing yesterday. Cheap to call
   * on focus: at most one extra fetch per day.
   */
  ensureFreshForToday: () => void;
}

const LeaderboardContext = createContext<LeaderboardContextType | undefined>(undefined);

export function LeaderboardProvider({ children }: { children: ReactNode }) {
  const { userId, isAuthenticated } = useAuth();

  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against overlapping pulls (e.g. a refresh tap mid-load) and against
  // a resolved fetch writing state after sign-out.
  const inFlightRef = useRef(false);
  // Mirrors `snapshot` so the callbacks below can read it without taking it as
  // a dependency: a changing callback identity would re-fire a consumer
  // useFocusEffect and replay its entry animation on every refresh.
  const snapshotRef = useRef<LeaderboardSnapshot | null>(null);
  const activeUserRef = useRef<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      const requestUserId = userId;
      if (!requestUserId || inFlightRef.current) return;

      inFlightRef.current = true;
      activeUserRef.current = requestUserId;
      if (mode === "initial") setIsLoading(true);
      else setIsRefreshing(true);
      setError(null);

      try {
        // Roster and friend list are independent — fetch them together.
        const [roster, friendIds] = await Promise.all([
          fetchLeaderboardByStreak(),
          getFriendsForUser(requestUserId),
        ]);

        // One batched query for the widest window; every period is a slice of it.
        const rowsByUser = await fetchPostureRowsForLeaderboard(
          roster,
          WIDEST_LEADERBOARD_PERIOD
        );

        // Dropped if the user signed out or switched while this was in flight.
        if (activeUserRef.current !== requestUserId) return;

        const next: LeaderboardSnapshot = {
          roster,
          rowsByUser,
          friendIds,
          dateKey: toDateKey(new Date()),
          loadedAt: Date.now(),
        };
        snapshotRef.current = next;
        setSnapshot(next);
      } catch (err) {
        console.error("[LeaderboardContext] Failed to load leaderboard", err);
        if (activeUserRef.current === requestUserId) {
          setError("couldn’t load the leaderboard — tap refresh to try again.");
        }
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [userId]
  );

  // Load once on login; drop everything on logout so the next user starts clean.
  useEffect(() => {
    if (!isAuthenticated || !userId) {
      activeUserRef.current = null;
      snapshotRef.current = null;
      setSnapshot(null);
      setError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    if (activeUserRef.current === userId) return; // already loaded for this user
    load("initial");
  }, [isAuthenticated, userId, load]);

  const refresh = useCallback(async () => {
    await load(snapshotRef.current ? "refresh" : "initial");
  }, [load]);

  const ensureFreshForToday = useCallback(() => {
    const current = snapshotRef.current;
    if (!current) return;
    if (current.dateKey === toDateKey(new Date())) return;
    load("refresh");
  }, [load]);

  // Every scope/period combination, ranked up front from the cached rows. Pure
  // and cheap, so switching tabs on screen costs nothing.
  const entriesByView = useMemo(() => {
    const views: Record<string, LeaderboardEntry[]> = {};
    if (!snapshot) return views;

    const friendRoster = (() => {
      const allowed = new Set<string>([...snapshot.friendIds, ...(userId ? [userId] : [])]);
      return snapshot.roster.filter((u) => allowed.has(u.id));
    })();

    const scopes: [LeaderboardScope, User[]][] = [
      ["everyone", snapshot.roster],
      ["friends", friendRoster],
    ];
    const periods: LeaderboardPeriod[] = ["day", "week"];

    for (const [scope, roster] of scopes) {
      for (const period of periods) {
        views[`${scope}:${period}`] = rankLeaderboard(roster, snapshot.rowsByUser, period);
      }
    }
    return views;
  }, [snapshot, userId]);

  const getEntries = useCallback(
    (scope: LeaderboardScope, period: LeaderboardPeriod) =>
      entriesByView[`${scope}:${period}`] ?? [],
    [entriesByView]
  );

  const value = useMemo<LeaderboardContextType>(
    () => ({
      isLoading: isLoading && !snapshot,
      isRefreshing,
      error,
      lastUpdatedAt: snapshot?.loadedAt ?? null,
      friendCount: snapshot ? snapshot.friendIds.length : null,
      getEntries,
      refresh,
      ensureFreshForToday,
    }),
    [isLoading, isRefreshing, error, snapshot, getEntries, refresh, ensureFreshForToday]
  );

  return <LeaderboardContext.Provider value={value}>{children}</LeaderboardContext.Provider>;
}

export function useLeaderboard() {
  const context = useContext(LeaderboardContext);
  if (context === undefined) {
    throw new Error("useLeaderboard must be used within a LeaderboardProvider");
  }
  return context;
}
