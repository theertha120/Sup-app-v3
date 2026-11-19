import { useEffect } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { syncAllXp } from "@/src/services/xp/xpService";

/**
 * Renders nothing. Once per sign-in, recalculates XP for every day from the
 * saved sessions, check-ins and workouts and fixes any day (and the profile's
 * total / level) that's out of date — this backfills XP for history from
 * before XP existed and repairs writes that failed while offline (docs/xp.md).
 */
export default function XpSync() {
  const { userId } = useAuth();
  useEffect(() => {
    if (userId) void syncAllXp(userId);
  }, [userId]);
  return null;
}
