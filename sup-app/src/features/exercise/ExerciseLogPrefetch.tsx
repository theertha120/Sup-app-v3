import { useEffect } from 'react';
import { useAuth } from '@/src/contexts/AuthContext';
import { clearExerciseLogCache, prefetchExerciseLog } from '@/src/services/exercise/exerciseLogCache';

/**
 * Renders nothing. Loads the Exercise page's workouts and posture check-ins in
 * the background as soon as someone is signed in, so the page opens with them
 * already there (like the Community leaderboard). Clears them on sign-out.
 */
export default function ExerciseLogPrefetch() {
  const { userId } = useAuth();
  useEffect(() => {
    if (userId) prefetchExerciseLog(userId);
    else clearExerciseLogCache();
  }, [userId]);
  return null;
}
