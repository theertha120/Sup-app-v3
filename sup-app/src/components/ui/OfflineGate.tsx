/**
 * OfflineGate.tsx
 *
 * Shows a blocking "no connection" popup over every screen while the device is
 * offline. "try again" re-checks the network; once it's back, the screens are
 * remounted (and shared data refreshed) so everything that failed to load
 * offline is fetched again — the closest thing to an app reload without
 * expo-updates. Providers above this (auth, BLE/IMU) are not remounted, so a
 * live sensor session survives.
 */

import React, { useEffect, useState } from "react";
import * as Network from "expo-network";
import { BrandAlert } from "@/src/components/ui/BrandAlert";
import { useLeaderboard } from "@/src/contexts/LeaderboardContext";
import { usePostureHistory } from "@/src/contexts/PostureHistoryContext";

// Only an explicit `false` counts as offline — Android reports
// isInternetReachable as undefined until it has finished checking.
function isOffline(state: Network.NetworkState) {
  return state.isConnected === false || state.isInternetReachable === false;
}

export default function OfflineGate({ children }: { children: React.ReactNode }) {
  const network = Network.useNetworkState();
  const { refresh: refreshLeaderboard } = useLeaderboard();
  const { refresh: refreshHistory } = usePostureHistory();
  const [visible, setVisible] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Open on going offline; stays open until "try again" succeeds, so data
  // that failed while offline is always reloaded.
  useEffect(() => {
    if (isOffline(network)) setVisible(true);
  }, [network]);

  const handleTryAgain = async () => {
    const state = await Network.getNetworkStateAsync().catch(() => network);
    if (isOffline(state)) {
      setStillOffline(true);
      return;
    }
    setStillOffline(false);
    setVisible(false);
    setReloadKey((k) => k + 1);
    refreshLeaderboard();
    refreshHistory();
  };

  return (
    <>
      <React.Fragment key={reloadKey}>{children}</React.Fragment>
      <BrandAlert
        visible={visible}
        dismissable={false}
        title="can't connect to the internet"
        message={
          stillOffline
            ? "still no connection. please check that airplane mode is off and you're on wi-fi or mobile data, then try again."
            : "we're having trouble reaching the network. if airplane mode is on, please turn it off, then tap try again."
        }
        buttons={[{ text: "try again", onPress: handleTryAgain }]}
        // BrandAlert closes before running onPress; visibility is controlled
        // by handleTryAgain instead, so a failed retry keeps the popup open.
        onRequestClose={() => {}}
      />
    </>
  );
}
