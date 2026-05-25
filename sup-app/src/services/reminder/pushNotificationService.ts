import * as Notifications from "expo-notifications";
import { supabase } from "@/src/lib/supabase";
import { CURRENT_USER_ID } from "@/constants/env";
import { getReminderForUser } from "./reminderEngineService";

/**
 * LOCAL NOTIFICATION SERVICE
 * Handles local notifications only (no push tokens)
 * Integrates with reminder engine to send reminders
 */

// Configure notification behavior when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function getCurrentUserId(): Promise<string> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return CURRENT_USER_ID;
    }
    return user.id;
  } catch {
    return CURRENT_USER_ID;
  }
}

/**
 * SETUP NOTIFICATIONS
 * Initialize notification handler
 */
export async function setupNotifications(): Promise<void> {
  try {
    // Request permissions
    const { status } = await Notifications.requestPermissionsAsync();

    if (status !== "granted") {
      console.warn("Notification permissions not granted");
      return;
    }

    console.log("Notifications initialized successfully");
  } catch (error) {
    console.error("Error setting up notifications:", error);
  }
}

/**
 * SEND LOCAL NOTIFICATION (for testing or local delivery)
 */
export async function sendLocalNotification(
  title: string,
  body: string,
  actionLabel?: string
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "default",
        badge: 1,
        data: {
          actionLabel: actionLabel || "View",
        },
      },
      trigger: {
        seconds: 1, // Send immediately
      },
    });
  } catch (error) {
    console.error("Error sending local notification:", error);
  }
}

/**
 * TRIGGER REMINDER
 * Calls the reminder engine and sends notification if reminder is selected
 */
export async function triggerReminder(): Promise<void> {
  try {
    const userId = await getCurrentUserId();

    // Update last interaction timestamp
    await supabase
      .from("user_profile")
      .update({
        last_app_interaction_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .maybeSingle();

    // Get reminder from engine
    const reminder = await getReminderForUser();

    if (reminder) {
      // Send local notification
      await sendLocalNotification(
        reminder.title,
        reminder.body,
        reminder.action_label
      );

      console.log("Reminder sent:", reminder.title);
    } else {
      console.log("No reminder triggered (rules not met)");
    }
  } catch (error) {
    console.error("Error triggering reminder:", error);
  }
}

/**
 * SETUP NOTIFICATION LISTENERS
 * Handles when user taps on a notification
 */
export function setupNotificationListeners(): () => void {
  // Handle notification when user taps on it
  const subscription = Notifications.addNotificationResponseReceivedListener(
    async (response) => {
      const { actionLabel } = response.notification.request.content.data;

      if (actionLabel) {
        console.log("User interacted with notification:", actionLabel);

        // Log interaction in reminder_log
        try {
          const userId = await getCurrentUserId();
          const { data: lastReminder } = await supabase
            .from("reminder_log")
            .select("id")
            .eq("user_id", userId)
            .order("sent_at", { ascending: false })
            .limit(1);

          if (lastReminder && lastReminder[0]) {
            await supabase
              .from("reminder_log")
              .update({
                user_interacted: true,
                interaction_at: new Date().toISOString(),
              })
              .eq("id", lastReminder[0].id);
          }
        } catch (error) {
          console.error("Error logging notification interaction:", error);
        }
      }
    }
  );

  // Return cleanup function
  return () => subscription.remove();
}

/**
 * START REMINDER CHECK INTERVAL
 * Check for reminders periodically (e.g., every 5 minutes)
 */
export function startReminderCheckInterval(
  intervalSeconds: number = 300
): () => void {
  const interval = setInterval(() => {
    triggerReminder();
  }, intervalSeconds * 1000);

  return () => clearInterval(interval);
}
