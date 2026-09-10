/**
 * useSessionStats.ts
 *
 * Tracks time spent in each posture state across:
 *   session  — since s'pots connected this session
 *   today    — midnight to now
 *   week     — last 7 days rolling, with per-day breakdown for bar chart
 *
 * Persists daily totals to AsyncStorage so data survives app restarts.
 */

import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DeskPostureState } from "../components/desk/mockDeskPostureData";
import { useAuth } from "../contexts/AuthContext";
import { useIMUContext } from "../contexts/IMUContext";


// ── Types ─────────────────────────────────────────────────────────────────────

export type StateTimeMap = Partial<Record<DeskPostureState, number>>; // ms per state

/** One day's data for the bar chart */
export interface DayData {
  /** Short day label e.g. "Mon", "Tue" */
  label: string;
  /** YYYY-MM-DD */
  dateKey: string;
  /** Time per posture state (ms) */
  states: StateTimeMap;
  /** Total desk time this day (ms) */
  totalMs: number;
  /** Whether this is today */
  isToday: boolean;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STATS_KEY_PREFIX = "sup_posture_stats_";
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateToKey(d: Date): string {
  return STATS_KEY_PREFIX + d.toISOString().slice(0, 10);
}

function todayKey(): string {
  return dateToKey(new Date());
}

/** Returns last 7 days oldest→newest with labels */
function last7Days(): { key: string; label: string; dateKey: string; isToday: boolean }[] {
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    result.push({
      key:     dateToKey(d),
      label:   DAY_LABELS[d.getDay()],
      dateKey: d.toISOString().slice(0, 10),
      isToday: i === 0,
    });
  }
  return result;
}

function addToMap(map: StateTimeMap, state: DeskPostureState, ms: number): StateTimeMap {
  return { ...map, [state]: (map[state] ?? 0) + ms };
}

function mergeMaps(...maps: StateTimeMap[]): StateTimeMap {
  const result: StateTimeMap = {};
  for (const map of maps) {
    for (const [k, v] of Object.entries(map)) {
      const key = k as DeskPostureState;
      result[key] = (result[key] ?? 0) + (v ?? 0);
    }
  }
  return result;
}

function totalMs(map: StateTimeMap): number {
  return Object.values(map).reduce((s, v) => s + (v ?? 0), 0);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const TICK_MS = 5_000;

export function useSessionStats(currentState: DeskPostureState | undefined) {
  const { userId } = useAuth();
  const { setSessionStateTotals, sessionStartTimeMs } = useIMUContext();
  const [sessionStats, setSessionStats] = useState<StateTimeMap>({});
  const [todayStats,   setTodayStats]   = useState<StateTimeMap>({});
  const [weekDays,     setWeekDays]     = useState<DayData[]>([]);
  const [weekStats,    setWeekStats]    = useState<StateTimeMap>({});

  const persistedTodayRef  = useRef<StateTimeMap>({});
  const persistedWeekRef   = useRef<Record<string, StateTimeMap>>({}); // dateKey → StateTimeMap
  const lastTickRef        = useRef<number>(Date.now());
  const currentStateRef    = useRef<DeskPostureState | undefined>(currentState);
  const sessionRef         = useRef<StateTimeMap>({});
  const userIdRef          = useRef<string | null>(userId);
  const prevSessionStartRef = useRef<number | null>(sessionStartTimeMs);

  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { currentStateRef.current = currentState; }, [currentState]);

  // ── Load persisted data on mount ──────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        const days   = last7Days();
        const raws   = await Promise.all(days.map((d) => AsyncStorage.getItem(d.key)));
        const dayMap: Record<string, StateTimeMap> = {};

        days.forEach((d, i) => {
          dayMap[d.dateKey] = raws[i] ? JSON.parse(raws[i]!) : {};
        });

        persistedWeekRef.current = dayMap;

        // Today's persisted base
        const todayDK = new Date().toISOString().slice(0, 10);
        persistedTodayRef.current = dayMap[todayDK] ?? {};
        setTodayStats(persistedTodayRef.current);

        // Build week days array
        const built: DayData[] = days.map((d) => ({
          label:   d.label,
          dateKey: d.dateKey,
          states:  dayMap[d.dateKey] ?? {},
          totalMs: totalMs(dayMap[d.dateKey] ?? {}),
          isToday: d.isToday,
        }));
        setWeekDays(built);
        setWeekStats(mergeMaps(...Object.values(dayMap)));
      } catch (e) {
        console.warn("[useSessionStats] Failed to load:", e);
      }
    };
    load();
  }, []);

  // ── Tick interval ─────────────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const state = currentStateRef.current;
      if (!state) return;

      const now     = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;

      // Session
      sessionRef.current = addToMap(sessionRef.current, state, elapsed);
      const sessionTotalBefore = totalMs(sessionRef.current) - elapsed;
      const sessionTotalAfter = totalMs(sessionRef.current);
      if (sessionTotalBefore === 0 && sessionTotalAfter > 0) {
        console.log("[useSessionStats] session stats accumulation started — first tick", { state, elapsed, sessionTotalAfter });
      }
      setSessionStats({ ...sessionRef.current });

      // Today live = persisted base + session
      const todayLive = mergeMaps(persistedTodayRef.current, sessionRef.current);
      setTodayStats(todayLive);

      // Persist today
      const todayDK = new Date().toISOString().slice(0, 10);
      AsyncStorage.setItem(
        STATS_KEY_PREFIX + todayDK,
        JSON.stringify(todayLive)
      ).catch(() => {});

      // Keep IMUContext's state totals ref in sync so endSession can write them
      setSessionStateTotals(sessionRef.current);

      // Update weekDays — just patch today's entry
      setWeekDays((prev) =>
        prev.map((d) =>
          d.isToday
            ? { ...d, states: todayLive, totalMs: totalMs(todayLive) }
            : d
        )
      );

      // Week total
      setWeekStats((prev) => mergeMaps(prev, { [state]: elapsed } as StateTimeMap));
    }, TICK_MS);

    return () => clearInterval(interval);
  }, []);

  // Commit + reset the session accumulator only when the session identity
  // actually changes — i.e. a session ended (sessionStartTimeMs → null) or a
  // brand-new one began (→ a different timestamp). A temporary s'pot
  // disconnect the user reconnects through keeps the SAME sessionStartTimeMs,
  // so the per-state totals carry straight through as one continuous session.
  useEffect(() => {
    if (sessionStartTimeMs === prevSessionStartRef.current) return;

    // Only fold if there was a real session before this change.
    if (prevSessionStartRef.current !== null) {
      const todayFinal = mergeMaps(persistedTodayRef.current, sessionRef.current);
      const todayDK = new Date().toISOString().slice(0, 10);
      AsyncStorage.setItem(STATS_KEY_PREFIX + todayDK, JSON.stringify(todayFinal)).catch(() => {});
      persistedTodayRef.current = todayFinal;
      sessionRef.current = {};
      setSessionStats({});
    }

    prevSessionStartRef.current = sessionStartTimeMs;
  }, [sessionStartTimeMs]);

  return {
    sessionStats,
    todayStats,
    weekDays,
    weekStats,
    sessionTotalMs: totalMs(sessionStats),
    todayTotalMs:   totalMs(todayStats),
    weekTotalMs:    totalMs(weekStats),
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 60_000) return "< 1m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatPercent(ms: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((ms / total) * 100)}%`;
}