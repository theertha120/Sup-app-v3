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

import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DeskPostureState } from "../components/desk/mockDeskPostureData";
import { PostureSegment } from "../lib/sessionHighlights";
import { useIMUContext } from "../contexts/IMUContext";
import { toLocalDateKey } from "../lib/dateKey";
import { captureError, createThrottledErrorReporter } from "../lib/sentry";


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
// The running session's own per-state totals, saved alongside today's totals
// on every tick. If the app is terminated and relaunched mid-session and
// IMUContext resumes that session (same start time), these seed the session
// accumulator again — and are taken back out of today's saved totals, which
// already include them, so nothing is counted twice.
const LIVE_SESSION_KEY = "sup_posture_session_live_v1";
const LIVE_TIMELINE_MAX = 500; // most recent segments kept for highlights

interface LiveSessionRecord {
  sessionStartMs: number;
  dateKey: string;
  totals: StateTimeMap;
  timeline: PostureSegment[];
}
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateToKey(d: Date): string {
  return STATS_KEY_PREFIX + toLocalDateKey(d);
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
      dateKey: toLocalDateKey(d),
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

function subtractMap(from: StateTimeMap, sub: StateTimeMap): StateTimeMap {
  const result: StateTimeMap = { ...from };
  for (const [k, v] of Object.entries(sub)) {
    const key = k as DeskPostureState;
    result[key] = Math.max(0, (result[key] ?? 0) - (v ?? 0));
  }
  return result;
}

function totalMs(map: StateTimeMap): number {
  return Object.values(map).reduce((s, v) => s + (v ?? 0), 0);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const TICK_MS = 5_000;
// Timeline is sampled faster than the totals so the end-of-session replay is near-live.
const TIMELINE_TICK_MS = 1_000;
const reportPeriodicSaveError = createThrottledErrorReporter();

// Mounted once by SessionStatsProvider, never by individual screens.
export function useSessionStatsTracker(currentState: DeskPostureState | undefined) {
  const { setSessionStateTotals, sessionStartTimeMs, registerStatsTick } = useIMUContext();
  const [sessionStats, setSessionStats] = useState<StateTimeMap>({});
  const [todayStats,   setTodayStats]   = useState<StateTimeMap>({});
  const [weekDays,     setWeekDays]     = useState<DayData[]>([]);
  const [weekStats,    setWeekStats]    = useState<StateTimeMap>({});

  const persistedTodayRef  = useRef<StateTimeMap>({});
  const lastTickRef        = useRef<number>(Date.now());
  const currentStateRef    = useRef<DeskPostureState | undefined>(currentState);
  const sessionRef         = useRef<StateTimeMap>({});
  // Run-length posture timeline for the current session (end-of-session highlights)
  const sessionTimelineRef = useRef<PostureSegment[]>([]);
  const prevSessionStartRef = useRef<number | null>(sessionStartTimeMs);
  const lastTimelineTickRef = useRef<number | null>(null);
  // Saved stats aren't written until they've been read back — a tick before
  // that would overwrite today's saved totals with an empty base.
  const loadedRef          = useRef(false);
  const liveRecordRef      = useRef<LiveSessionRecord | null>(null);

  useEffect(() => { currentStateRef.current = currentState; }, [currentState]);

  // Once both the saved stats are loaded and the session start is known:
  // if this is the same session a previous app process was recording,
  // carry its per-state totals on; if it's a different one, the saved
  // record is stale (its time already lives in today's totals).
  const applyLiveRecord = useCallback(() => {
    const live  = liveRecordRef.current;
    const start = prevSessionStartRef.current;
    if (!loadedRef.current || !live || start === null) return;
    liveRecordRef.current = null;
    if (live.sessionStartMs !== start) {
      AsyncStorage.removeItem(LIVE_SESSION_KEY).catch(() => {});
      return;
    }
    sessionRef.current         = { ...live.totals };
    sessionTimelineRef.current = live.timeline ?? [];
    if (live.dateKey === toLocalDateKey()) {
      persistedTodayRef.current = subtractMap(persistedTodayRef.current, live.totals);
    }
    lastTickRef.current = Date.now();
    setSessionStats({ ...sessionRef.current });
    setSessionStateTotals(sessionRef.current);
  }, [setSessionStateTotals]);

  // ── Load persisted data on mount ──────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        try {
          const rawLive = await AsyncStorage.getItem(LIVE_SESSION_KEY);
          liveRecordRef.current = rawLive ? JSON.parse(rawLive) : null;
        } catch {
          liveRecordRef.current = null;
        }
        const days   = last7Days();
        const raws   = await Promise.all(days.map((d) => AsyncStorage.getItem(d.key)));
        const dayMap: Record<string, StateTimeMap> = {};

        days.forEach((d, i) => {
          dayMap[d.dateKey] = raws[i] ? JSON.parse(raws[i]!) : {};
        });

        // Today's persisted base
        const todayDK = toLocalDateKey();
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
        captureError(e, "desk-stats-load");
      }
      loadedRef.current = true;
      applyLiveRecord();
    };
    load();
  }, [applyLiveRecord]);

  // ── Tick interval ─────────────────────────────────────────────────────────

  useEffect(() => {
    const tick = () => {
      const state = currentStateRef.current;
      // Keep the clock moving while idle, or the first tick of the next
      // session folds all the idle time into its first posture state.
      if (!state) { lastTickRef.current = Date.now(); return; }

      const now     = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;

      // Session
      sessionRef.current = addToMap(sessionRef.current, state, elapsed);
      const sessionTotalAfter = totalMs(sessionRef.current);
      const sessionTotalBefore = sessionTotalAfter - elapsed;
      if (sessionTotalBefore === 0 && sessionTotalAfter > 0) {
        console.log("[useSessionStats] session stats accumulation started — first tick", { state, elapsed, sessionTotalAfter });
      }
      setSessionStats({ ...sessionRef.current });

      // Today live = persisted base + session
      const todayLive = mergeMaps(persistedTodayRef.current, sessionRef.current);
      setTodayStats(todayLive);

      // Persist today, plus the session's own totals (see LIVE_SESSION_KEY) —
      // in one write so the two can never disagree.
      // (v3: the timeline is filled by the 1s timeline sampler below, not by
      // this tick, so it's only read here for the saved live-session record.)
      const timeline = sessionTimelineRef.current;
      const todayDK = toLocalDateKey();
      if (loadedRef.current) {
        const entries: [string, string][] = [[STATS_KEY_PREFIX + todayDK, JSON.stringify(todayLive)]];
        const start = prevSessionStartRef.current;
        if (start !== null) {
          const live: LiveSessionRecord = {
            sessionStartMs: start,
            dateKey: todayDK,
            totals: sessionRef.current,
            timeline: timeline.slice(-LIVE_TIMELINE_MAX),
          };
          entries.push([LIVE_SESSION_KEY, JSON.stringify(live)]);
        }
        AsyncStorage.multiSet(entries).catch((error) => reportPeriodicSaveError(error, "desk-stats-save"));
      }

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
    };

    const interval = setInterval(tick, TICK_MS);

    // JS timers stall in the background once the screen is off, so IMUContext
    // also calls this on every s'pot packet. It carries the packet's posture
    // state (React state may lag while backgrounded) and only ticks once the
    // interval is overdue, so it's a no-op while the interval is healthy.
    registerStatsTick((state) => {
      if (currentStateRef.current !== undefined) currentStateRef.current = state;
      if (Date.now() - lastTickRef.current >= TICK_MS) tick();
    });

    return () => {
      clearInterval(interval);
      registerStatsTick(null);
    };
  }, [registerStatsTick]);

  // ── Timeline sampler ──────────────────────────────────────────────────────
  // Ref-only (no re-render, no storage). Untracked time is left as a gap.

  useEffect(() => {
    const interval = setInterval(() => {
      const state = currentStateRef.current;
      const now   = Date.now();
      const prev  = lastTimelineTickRef.current;
      if (!state) { lastTimelineTickRef.current = null; return; }
      lastTimelineTickRef.current = now;
      if (prev === null) return;

      const timeline = sessionTimelineRef.current;
      const lastSeg = timeline[timeline.length - 1];
      if (lastSeg && lastSeg.state === state && lastSeg.endMs === prev) lastSeg.endMs = now;
      else timeline.push({ state, startMs: prev, endMs: now });
    }, TIMELINE_TICK_MS);

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
      const todayDK = toLocalDateKey();
      AsyncStorage.setItem(STATS_KEY_PREFIX + todayDK, JSON.stringify(todayFinal))
        .catch((error) => captureError(error, "desk-stats-final-save"));
      persistedTodayRef.current = todayFinal;
      sessionRef.current = {};
      sessionTimelineRef.current = [];
      setSessionStats({});
      AsyncStorage.removeItem(LIVE_SESSION_KEY).catch(() => {});
    }

    prevSessionStartRef.current = sessionStartTimeMs;
    applyLiveRecord();
  }, [sessionStartTimeMs, applyLiveRecord]);

  const getSessionTimeline = useCallback(
    () => sessionTimelineRef.current.map((s) => ({ ...s })),
    []
  );

  return {
    sessionStats,
    getSessionTimeline,
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
