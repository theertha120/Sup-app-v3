// Today's goal offers and picked goals for the signed-in user. Reloads on every
// focus of the host screen so a new day (or a first s'pot session, which adds
// the sitting section) shows up without a restart.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  fetchGoalsForDay,
  hasLoggedPostureSession,
  pickGoal,
  setGoalCompleted,
  unpickGoal,
} from "@/src/services/goals/dailyGoalsService";

export function useDailyGoals() {
  const { userId } = useAuth();
  const [dateKey, setDateKey] = useState(() => toLocalDateKey());
  const [hasHardware, setHasHardware] = useState<boolean | null>(null);
  const [goals, setGoals] = useState<DailyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Goal ids / offer ids with a write in flight, so double taps don't double-write.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Bumped on each load and account switch; stale responses are dropped.
  const loadIdRef = useRef(0);

  useEffect(() => {
    loadIdRef.current++;
    setGoals([]);
    setHasHardware(null);
    setPending(new Set());
    setLoading(true);
    setError(null);
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    const loadId = ++loadIdRef.current;
    const today = toLocalDateKey();
    setDateKey(today);
    const [hardware, dayGoals] = await Promise.allSettled([
      hasLoggedPostureSession(userId),
      fetchGoalsForDay(userId, today),
    ]);
    if (loadId !== loadIdRef.current) return;
    if (hardware.status === "fulfilled") setHasHardware(hardware.value);
    else {
      captureError(hardware.reason, "daily-goals-hardware");
      // Keep what we knew; only fall back to the no-hardware set on first load.
      setHasHardware((prev) => prev ?? false);
    }
    if (dayGoals.status === "fulfilled") {
      setGoals(dayGoals.value);
      setError(null);
    } else {
      captureError(dayGoals.reason, "daily-goals-load", { dateKey: today });
      setError("couldn't load your goals.");
    }
    setLoading(false);
  }, [userId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const set = hasHardware == null ? null : goalSetFor(hasHardware);
  const sections = useMemo(
    () => (userId && set ? dailyOffers(userId, dateKey, set) : []),
    [userId, dateKey, set],
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
        if (loadId === loadIdRef.current) setGoals((prev) => [...prev, goal]);
      } catch (err) {
        captureError(err, "daily-goals-pick", { goalId: offer.goalId });
        setError("couldn't add that goal. try again.");
        void load(); // e.g. already picked on another device
      }
    });
  }, [userId, dateKey, goals, pending, withPending, load]);

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

  const toggleComplete = useCallback(async (goal: DailyGoal) => {
    if (!userId || pending.has(goal.id)) return;
    const loadId = loadIdRef.current;
    await withPending(goal.id, async () => {
      try {
        const updated = await setGoalCompleted(userId, goal.id, !goal.completed_at);
        if (loadId === loadIdRef.current) setGoals((prev) => prev.map((g) => (g.id === goal.id ? updated : g)));
      } catch (err) {
        captureError(err, "daily-goals-complete");
        setError("couldn't update that goal. try again.");
      }
    });
  }, [userId, pending, withPending]);

  const completedToday = useMemo(() => goals.filter((g) => g.completed_at), [goals]);

  return { dateKey, sections, goals, completedToday, loading, error, pending, pick, unpick, toggleComplete, reload: load };
}

export type DailyGoalsState = ReturnType<typeof useDailyGoals>;
