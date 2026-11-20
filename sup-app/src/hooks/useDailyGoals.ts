// Today's goal offers and picked goals for the signed-in user. Picked goals
// complete themselves: their rules are checked against today's check-ins,
// desk sessions and exercise logs (see goalRules.ts) on every focus of the
// host screen, when the app returns to the foreground, every minute while
// focused, and right after a pick. A new day, or a first s'pot session (which
// adds the sitting section), shows up on the next focus.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/contexts/AuthContext";
import { toLocalDateKey } from "@/src/lib/dateKey";
import { captureError } from "@/src/lib/sentry";
import {
  dailyOffers,
  goalSetFor,
  type DailyGoal,
  type GoalOffer,
} from "@/src/lib/goals/dailyGoals";
import {
  evaluateRule,
  ruleSources,
  type CheckInSettings,
  type GoalDayData,
  type GoalProgress,
} from "@/src/lib/goals/goalRules";
import {
  fetchCheckInSettings,
  fetchCheckInsForDay,
  fetchCompletedSessionsForDay,
  fetchGoalsForDay,
  fetchWorkoutsForDay,
  hasLoggedPostureSession,
  markGoalsCompleted,
  pickGoal,
  unpickGoal,
} from "@/src/services/goals/dailyGoalsService";
import { fetchDailyPosturePair } from "@/src/services/posture/postureSyncService";

const RECHECK_MS = 60_000;

type Source = ReturnType<typeof ruleSources>[number];

/** Fetches only the sources `goals` need; a failed source is left out (its goals keep their last progress). */
async function fetchDayData(userId: string, dateKey: string, goals: DailyGoal[]) {
  const needed = new Set<Source>(goals.flatMap((g) => ruleSources(g.goal_id)));
  const data: GoalDayData = {
    checkIns: [], sessions: [], workouts: [],
    supScore: null, yesterdaySupScore: null, yesterdayDeskMs: null,
  };
  const failed = new Set<Source>();
  const tasks: Promise<void>[] = [];
  const run = (source: Source, work: () => Promise<void>) => {
    if (!needed.has(source)) return;
    tasks.push(work().catch((err) => {
      failed.add(source);
      captureError(err, "daily-goals-data", { source, dateKey });
    }));
  };
  run("checkIns", async () => { data.checkIns = await fetchCheckInsForDay(userId, dateKey); });
  run("sessions", async () => { data.sessions = await fetchCompletedSessionsForDay(userId, dateKey); });
  run("workouts", async () => { data.workouts = await fetchWorkoutsForDay(userId, dateKey); });
  run("daily", async () => {
    const pair = await fetchDailyPosturePair(userId, dateKey);
    data.supScore = pair.today?.supScore ?? null;
    data.yesterdaySupScore = pair.previous?.supScore ?? null;
    data.yesterdayDeskMs = pair.previous?.totalDeskMs ?? null;
  });
  await Promise.all(tasks);
  return { data, failed };
}

export function useDailyGoals() {
  const { userId } = useAuth();
  const [dateKey, setDateKey] = useState(() => toLocalDateKey());
  const [hasHardware, setHasHardware] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<CheckInSettings | null>(null);
  const [goals, setGoals] = useState<DailyGoal[]>([]);
  // Progress for picked, not-yet-completed goals, by daily_goals row id.
  const [progress, setProgress] = useState<Record<string, GoalProgress>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Goal ids / offer ids with a write in flight, so double taps don't double-write.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Bumped on each load and account switch; stale responses are dropped.
  const loadIdRef = useRef(0);
  const goalsRef = useRef<DailyGoal[]>([]);
  goalsRef.current = goals;
  const checkingRef = useRef(false);
  // A check requested while one is running; run once the current one ends.
  const queuedCheckRef = useRef<{ list: DailyGoal[]; day: string } | null>(null);

  useEffect(() => {
    loadIdRef.current++;
    setGoals([]);
    setProgress({});
    setHasHardware(null);
    setSettings(null);
    setPending(new Set());
    setLoading(true);
    setError(null);
  }, [userId]);

  /** Evaluates today's open goals and saves any that are now complete. */
  const checkGoals = useCallback(async (list: DailyGoal[], day: string) => {
    if (!userId) return;
    if (checkingRef.current) { queuedCheckRef.current = { list, day }; return; }
    const open = list.filter((g) => !g.completed_at);
    if (open.length === 0) { setProgress({}); return; }
    checkingRef.current = true;
    const loadId = loadIdRef.current;
    try {
      const { data, failed } = await fetchDayData(userId, day, open);
      if (loadId !== loadIdRef.current) return;
      const next: Record<string, GoalProgress> = {};
      const doneIds: string[] = [];
      for (const goal of open) {
        if (ruleSources(goal.goal_id).some((s) => failed.has(s))) continue;
        const result = evaluateRule(goal.goal_id, data);
        next[goal.id] = result;
        if (result.done) doneIds.push(goal.id);
      }
      setProgress((prev) => ({ ...prev, ...next }));
      if (doneIds.length > 0) {
        const updated = await markGoalsCompleted(userId, doneIds);
        if (loadId !== loadIdRef.current) return;
        const byId = new Map(updated.map((g) => [g.id, g]));
        setGoals((prev) => prev.map((g) => byId.get(g.id) ?? g));
      }
    } catch (err) {
      captureError(err, "daily-goals-check", { dateKey: day });
    } finally {
      checkingRef.current = false;
      const queued = queuedCheckRef.current;
      queuedCheckRef.current = null;
      if (queued && loadId === loadIdRef.current) void checkGoalsRef.current(queued.list, queued.day);
    }
  }, [userId]);
  const checkGoalsRef = useRef(checkGoals);
  checkGoalsRef.current = checkGoals;

  const load = useCallback(async () => {
    if (!userId) return;
    const loadId = ++loadIdRef.current;
    const today = toLocalDateKey();
    setDateKey(today);
    const [hardware, reminderSettings, dayGoals] = await Promise.allSettled([
      hasLoggedPostureSession(userId),
      fetchCheckInSettings(userId),
      fetchGoalsForDay(userId, today),
    ]);
    if (loadId !== loadIdRef.current) return;
    if (hardware.status === "fulfilled") setHasHardware(hardware.value);
    else {
      captureError(hardware.reason, "daily-goals-hardware");
      // Keep what we knew; only fall back to the no-hardware set on first load.
      setHasHardware((prev) => prev ?? false);
    }
    if (reminderSettings.status === "fulfilled") setSettings(reminderSettings.value);
    else {
      captureError(reminderSettings.reason, "daily-goals-settings");
      setSettings((prev) => prev ?? { frequency: null, presets: [] });
    }
    if (dayGoals.status === "fulfilled") {
      setGoals(dayGoals.value);
      setError(null);
      void checkGoals(dayGoals.value, today);
    } else {
      captureError(dayGoals.reason, "daily-goals-load", { dateKey: today });
      setError("couldn't load your goals.");
    }
    setLoading(false);
  }, [userId, checkGoals]);

  // Load on focus; while focused, re-check on foreground and every minute.
  useFocusEffect(useCallback(() => {
    void load();
    const recheck = () => void checkGoals(goalsRef.current, toLocalDateKey());
    const timer = setInterval(recheck, RECHECK_MS);
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") void load(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [load, checkGoals]));

  const set = hasHardware == null ? null : goalSetFor(hasHardware);
  const sections = useMemo(
    () => (userId && set && settings ? dailyOffers(userId, dateKey, set, settings) : []),
    [userId, dateKey, set, settings],
  );

  const withPending = useCallback(async (key: string, work: () => Promise<void>) => {
    setPending((prev) => new Set(prev).add(key));
    try {
      await work();
    } finally {
      setPending((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }, []);

  const pick = useCallback(async (offer: GoalOffer) => {
    if (!userId || pending.has(offer.goalId)) return;
    if (goals.some((g) => g.goal_id === offer.goalId)) return;
    const loadId = loadIdRef.current;
    await withPending(offer.goalId, async () => {
      try {
        const goal = await pickGoal(userId, dateKey, offer);
        if (loadId !== loadIdRef.current) return;
        const next = [...goalsRef.current, goal];
        setGoals(next);
        void checkGoals(next, dateKey); // may already be done
      } catch (err) {
        captureError(err, "daily-goals-pick", { goalId: offer.goalId });
        setError("couldn't add that goal. try again.");
        void load(); // e.g. already picked on another device
      }
    });
  }, [userId, dateKey, goals, pending, withPending, load, checkGoals]);

  const unpick = useCallback(async (goal: DailyGoal) => {
    if (!userId || goal.completed_at || pending.has(goal.id)) return;
    const loadId = loadIdRef.current;
    await withPending(goal.id, async () => {
      try {
        await unpickGoal(userId, goal.id);
        if (loadId === loadIdRef.current) setGoals((prev) => prev.filter((g) => g.id !== goal.id));
      } catch (err) {
        captureError(err, "daily-goals-unpick");
        setError("couldn't remove that goal. try again.");
      }
    });
  }, [userId, pending, withPending]);

  const openGoals = useMemo(() => goals.filter((g) => !g.completed_at), [goals]);
  const completedToday = useMemo(() => goals.filter((g) => g.completed_at), [goals]);
  const hasCheckIns = settings != null && settings.frequency != null && settings.presets.length > 0;

  return {
    dateKey, sections, goals, openGoals, completedToday, progress, hasCheckIns,
    loading, error, pending, pick, unpick, reload: load,
  };
}

export type DailyGoalsState = ReturnType<typeof useDailyGoals>;
