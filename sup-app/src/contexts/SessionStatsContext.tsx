import React, { createContext, useContext } from "react";
import { useIMUContext } from "./IMUContext";
import { useSessionStatsTracker } from "../hooks/useSessionStats";

const SessionStatsContext = createContext<ReturnType<typeof useSessionStatsTracker> | null>(null);

/** Owns posture totals and the timeline for the lifetime of the shared sensor session. */
export function SessionStatsProvider({ children }: { children: React.ReactNode }) {
  const { posture, bothConnected, isNeutralCalibrated, sessionStartTimeMs } = useIMUContext();
  const isTracking = bothConnected && isNeutralCalibrated && sessionStartTimeMs !== null;
  // Read sensor posture directly: the Desk avatar's display state is only for presentation.
  const stats = useSessionStatsTracker(isTracking ? (posture?.state ?? "upright") : undefined);

  return <SessionStatsContext.Provider value={stats}>{children}</SessionStatsContext.Provider>;
}

/** Reads shared totals without starting a screen-owned tracking interval. */
export function useSessionStats() {
  const stats = useContext(SessionStatsContext);
  if (!stats) throw new Error("useSessionStats must be used inside <SessionStatsProvider>");
  return stats;
}
