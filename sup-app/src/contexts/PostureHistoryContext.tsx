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
import { useAuth } from "./AuthContext";
import {
  fetchAllPostureRows,
  type PosturePageRow,
} from "@/src/services/posture/postureSyncService";

function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface PostureHistorySnapshot {
  /** The signed-in user's posture_daily rows, oldest first. */
  rows: PosturePageRow[];
  /** Local date the snapshot was taken on, so we can spot a day rollover. */
  dateKey: string;
  loadedAt: number;
}

interface PostureHistoryContextType {
  /** The signed-in user's full daily history, oldest first. */
  rows: PosturePageRow[];
  /** True only while the first load is in flight and there is nothing to show. */
  isLoading: boolean;
  /** True while a manual refresh runs over data that is already on screen. */
  isRefreshing: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  /** Pull fresh data. Wire this to a refresh button. */
  refresh: () => Promise<void>;
  /**
   * Reloads only if the local calendar day has rolled over since the last load.
   * Cheap to call on focus: at most one extra fetch per day.
   */
  ensureFreshForToday: () => void;
}

const PostureHistoryContext = createContext<PostureHistoryContextType | undefined>(undefined);

const EMPTY_ROWS: PosturePageRow[] = [];

/**
 * Holds the signed-in user's whole posture history, fetched once per login.
 * Screens that chart it (stats) slice this in memory instead of querying per
 * page, so changing range or swiping between pages costs no network call.
 */
export function PostureHistoryProvider({ children }: { children: ReactNode }) {
  const { userId, isAuthenticated } = useAuth();

  const [snapshot, setSnapshot] = useState<PostureHistorySnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  // Mirrors `snapshot` so the callbacks below can read it without taking it as
  // a dependency: a changing callback identity would re-fire a consumer
  // useFocusEffect and replay its entry animation on every refresh.
  const snapshotRef = useRef<PostureHistorySnapshot | null>(null);
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
        const rows = await fetchAllPostureRows(requestUserId);

        // Dropped if the user signed out or switched while this was in flight.
        if (activeUserRef.current !== requestUserId) return;

        const next: PostureHistorySnapshot = {
          rows,
          dateKey: localDateKey(new Date()),
          loadedAt: Date.now(),
        };
        snapshotRef.current = next;
        setSnapshot(next);
      } catch (err) {
        console.error("[PostureHistoryContext] Failed to load posture history", err);
        if (activeUserRef.current === requestUserId) {
          setError("couldn’t load your stats — tap refresh to try again.");
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
    if (current.dateKey === localDateKey(new Date())) return;
    load("refresh");
  }, [load]);

  const value = useMemo<PostureHistoryContextType>(
    () => ({
      rows: snapshot?.rows ?? EMPTY_ROWS,
      isLoading: isLoading && !snapshot,
      isRefreshing,
      error,
      lastUpdatedAt: snapshot?.loadedAt ?? null,
      refresh,
      ensureFreshForToday,
    }),
    [snapshot, isLoading, isRefreshing, error, refresh, ensureFreshForToday]
  );

  return (
    <PostureHistoryContext.Provider value={value}>{children}</PostureHistoryContext.Provider>
  );
}

export function usePostureHistory() {
  const context = useContext(PostureHistoryContext);
  if (context === undefined) {
    throw new Error("usePostureHistory must be used within a PostureHistoryProvider");
  }
  return context;
}
