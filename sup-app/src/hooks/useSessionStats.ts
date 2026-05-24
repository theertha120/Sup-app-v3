/**
 * useSessionStats.ts
 *
 * Tracks time spent in each posture state across three windows:
 *   session — since the s'pots connected this sitting session
 *   today   — midnight to now (survives tab navigation, resets at midnight)
 *   week    — last 7 days rolling
 *
 * Persists daily totals to AsyncStorage so "today" and "week" survive
 * app restarts within the same day. Session always starts fresh on connect.
 *
 * Usage:
 *   const { sessionStats, todayStats, weekStats } = useSessionStats(posture?.state);
 */

import { useEffect, useRef, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DeskPostureState } from "../components/desk/mockDeskPostureData";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StateTimeMap = Partial<Record<DeskPostureState, number>>; // ms per state

export interface SessionStats {
  /** Time in each state this session (ms) */
  session: StateTimeMap;
  /** Time in each state today (ms) — includes session */
  today:   StateTimeMap;
  /** Time in each state over the last 7 days (ms) */
  week:    StateTimeMap;
  /** Total tracked time this session (ms) */
  sessionTotalMs: number;
  /** Total tracked time today (ms) */
  todayTotalMs: number;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STATS_KEY_PREFIX = "sup_posture_stats_";

function todayKey(): string {
  return STATS_KEY_PREFIX + new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function last7Keys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(STATS_KEY_PREFIX + d.toISOString().slice(0, 10));
  }
  return keys;
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

const TICK_MS = 5_000; // update stats every 5 seconds

export function useSessionStats(currentState: DeskPostureState | undefined) {
  const [sessionStats, setSessionStats] = useState<StateTimeMap>({});
  const [todayStats,   setTodayStats]   = useState<StateTimeMap>({});
  const [weekStats,    setWeekStats]    = useState<StateTimeMap>({});

  // Persisted today totals loaded from AsyncStorage (excluding current session)
  const persistedTodayRef = useRef<StateTimeMap>({});
  const lastTickRef       = useRef<number>(Date.now());
  const currentStateRef   = useRef<DeskPostureState | undefined>(currentState);
  const sessionRef        = useRef<StateTimeMap>({});

  // Keep currentStateRef in sync
  useEffect(() => {
    currentStateRef.current = currentState;
  }, [currentState]);

  // ── Load persisted today + week on mount ──────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        // Today's persisted total (from previous sessions today)
        const todayRaw = await AsyncStorage.getItem(todayKey());
        const persisted: StateTimeMap = todayRaw ? JSON.parse(todayRaw) : {};
        persistedTodayRef.current = persisted;
        setTodayStats(persisted);

        // Week — merge last 7 days
        const keys = last7Keys();
        const raws = await Promise.all(keys.map((k) => AsyncStorage.getItem(k)));
        const maps = raws.map((r) => (r ? JSON.parse(r) : {})) as StateTimeMap[];
        setWeekStats(mergeMaps(...maps));
      } catch (e) {
        console.warn("[useSessionStats] Failed to load stats:", e);
      }
    };
    load();
  }, []);

  // ── Tick interval — accumulate time ──────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const state = currentStateRef.current;
      if (!state) return;

      const now     = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;

      // Accumulate session
      sessionRef.current = addToMap(sessionRef.current, state, elapsed);
      setSessionStats({ ...sessionRef.current });

      // Accumulate today (persisted base + session)
      const todayLive = mergeMaps(persistedTodayRef.current, sessionRef.current);
      setTodayStats(todayLive);

      // Persist today periodically
      AsyncStorage.setItem(todayKey(), JSON.stringify(todayLive))
        .catch(() => {});

      // Week = persisted week base + today's live total
      // (Simplified: recalculate from today only — full week recalc happens on mount)
      setWeekStats((prev) => {
        const todayOnly = sessionRef.current; // just session contribution
        return mergeMaps(prev, todayOnly);
      });
    }, TICK_MS);

    return () => clearInterval(interval);
  }, []);

  // Reset session on disconnect (state becomes undefined)
  useEffect(() => {
    if (currentState === undefined) {
      // Persist what we have before resetting
      const todayFinal = mergeMaps(persistedTodayRef.current, sessionRef.current);
      AsyncStorage.setItem(todayKey(), JSON.stringify(todayFinal)).catch(() => {});
      persistedTodayRef.current = todayFinal;
      sessionRef.current = {};
      setSessionStats({});
    }
  }, [currentState === undefined]);

  const sessionTotalMs = totalMs(sessionStats);
  const todayTotalMs   = totalMs(todayStats);

  return {
    sessionStats,
    todayStats,
    weekStats,
    sessionTotalMs,
    todayTotalMs,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Format ms as "Xh Ym" or "Ym" or "< 1m" */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return "< 1m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Format ms as a percentage of total */
export function formatPercent(ms: number, totalMs: number): string {
  if (totalMs === 0) return "0%";
  return `${Math.round((ms / totalMs) * 100)}%`;
}