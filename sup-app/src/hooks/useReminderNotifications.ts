import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import {
  setupNotifications,
  setupNotificationListeners,
  // startReminderCheckInterval,
  triggerReminder,
} from "../services/reminder/pushNotificationService";
import { registerReminderBackgroundTask, unregisterReminderBackgroundTask, logLastBackgroundWake } from "../services/reminder/reminderBackgroundTask";

/**
 * REMINDER NOTIFICATION HOOK
 * Initialize local notifications and start reminder engine
 * Call this once in your main app component
 */
export function useReminderNotifications() {
  const cleanupRef = useRef<(() => void)[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {

    function startForegroundInterval() {
      if (intervalRef.current) {
        console.log("[Notifications] Foreground interval already running.");
        return; // already running
      }
      console.log("[Notifications] Starting foreground interval.");
      intervalRef.current = setInterval(() => {
        triggerReminder()
          .then(() => console.log("[Notifications] Foreground triggerReminder() resolved."))
          .catch((e) => console.error("[Notifications] Foreground triggerReminder() threw:", e));
      }, 30 * 1000); // FOR TESTING ONLY
      // }, 300 * 1000); // ORIGINAL INTERVAL
    }

    function stopForegroundInterval() {
      if (intervalRef.current) {
        console.log("[Notifications] Stopping foreground interval.");
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else {
        console.log("[Notifications] Foreground interval not running, no need to stop.");
      }
    }

    const initializeNotifications = async () => {
      try {
        // Setup notification handler
        await setupNotifications();

        // Setup notification response listener
        const unsubscribeListener = setupNotificationListeners();
        cleanupRef.current.push(unsubscribeListener);

        // Register background task for reminders (handles background + closed state)
        await registerReminderBackgroundTask();
        // cleanupRef.current.push(() => {
        //   unregisterReminderBackgroundTask();
        // });

        // Start foreground interval for active reminders (optional, can be removed if relying solely on background task)
        startForegroundInterval();

        // when app goes to background, stop foreground interval to save resources
        const appStateSubscription = AppState.addEventListener("change", (nextAppState: AppStateStatus) => {
          const prev = appStateRef.current;
          appStateRef.current = nextAppState;
          console.log(`[Notifications] AppState changed: "${prev}" → "${nextAppState}"`);

          if (nextAppState === "active") {
            console.log("[Notifications] App became active — starting foreground interval.");
            // Check if background task fired while we were away
            logLastBackgroundWake().catch((e) =>
              console.warn("[Notifications] logLastBackgroundWake() error:", e)
            );
            startForegroundInterval();
          } else if (nextAppState === "background") {
            console.log("[Notifications] App moved to background — stopping foreground interval.");
            console.log("[Notifications] Background task should take over from here.");
            console.log("[Notifications] On iOS: the OS decides when/if to wake the background task.");
            console.log("[Notifications] On Android: ensure battery optimization is disabled for this app.");
            stopForegroundInterval();
          } else if (nextAppState === "inactive") {
            // iOS-only transitional state (e.g. Control Centre open, incoming call)
            console.log("[Notifications] App state is 'inactive' (iOS transitional — e.g. swipe gesture, incoming call).");
          }
        });

        cleanupRef.current.push(() => appStateSubscription.remove());
        console.log("Reminder notifications initialized");
      } catch (error) {
        console.error("Failed to initialize reminder notifications:", error);
      }
    };

    initializeNotifications();

    // Cleanup on unmount
    return () => {
      console.log("[Notifications] Cleaning up reminder notifications.");
      stopForegroundInterval();
      cleanupRef.current.forEach((cleanup) => cleanup());
      cleanupRef.current = [];
    };
  }, []);
}

/**
 * MANUAL TRIGGER HOOK
 * Use this to manually trigger a reminder check
 * Useful for testing or user-initiated checks
 */
export function useManualReminderTrigger() {
  return {
    triggerReminder: async () => {
      console.log("[ManualTrigger] Manually triggering reminder check...");
      await triggerReminder();
    },
  };
}