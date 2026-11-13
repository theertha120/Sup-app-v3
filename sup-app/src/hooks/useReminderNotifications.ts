import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import {
  setupNotifications,
  setupNotificationListeners,
  startReminderCheckInterval,
  triggerReminder,
  scheduleReEngagementReminder,
} from "../services/reminder/pushNotificationService";

/**
 * REMINDER NOTIFICATION HOOK
 * Initialize local notifications and start reminder engine
 * Call this once in your main app component
 */
export function useReminderNotifications() {
  const cleanupRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    const initializeNotifications = async () => {
      try {
        // Setup notification handler
        await setupNotifications();

        // Setup notification response listener
        const unsubscribeListener = setupNotificationListeners();
        cleanupRef.current.push(unsubscribeListener);

        // Start periodic reminder checks (every 5 minutes)
        const unsubscribeInterval = startReminderCheckInterval(30); // FOR TESTING ONLY
        // const unsubscribeInterval = startReminderCheckInterval(300); // ORIGINAL INTERVAL
        cleanupRef.current.push(unsubscribeInterval);

        // Re-engagement: (re)schedule 48h ahead now and every time the user
        // leaves the app, so it only fires after a real 48h absence.
        scheduleReEngagementReminder();
        const appStateSub = AppState.addEventListener("change", (next) => {
          if (next === "background") scheduleReEngagementReminder();
        });
        cleanupRef.current.push(() => appStateSub.remove());

        console.log("Reminder notifications initialized");
      } catch (error) {
        console.error("Failed to initialize reminder notifications:", error);
      }
    };

    initializeNotifications();

    // Cleanup on unmount
    return () => {
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
      await triggerReminder();
    },
  };
}
