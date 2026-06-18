import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "@/src/lib/supabase";
import { getReminderForUser } from "./reminderEngineService";

/**
 * LOCAL NOTIFICATION SERVICE
 * Handles local notifications only (no push tokens)
 * Integrates with reminder engine to send reminders
 */

const ACTION_DONE = "DONE";
const ACTION_DISMISS = "DISMISS";
const ACTION_TOO_ANNOYING = "TOO_ANNOYING";
// const ACTION_BAD_TIMING = "BAD_TIMING";
const CATEGORY_REMINDER = "REMINDER_ACTIONS";

// Android channel IDs
const CHANNEL_REMINDERS = "reminders";
const CHANNEL_REMINDERS_HIGH = "reminders_high";

// Configure notification behavior when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;

  // Default reminder channel (normal importance)
  await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, {
    name: "Reminders",
    description: "Periodic reminders to keep you on track",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF6B6B",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
    enableLights: true,
    enableVibrate: true,
    showBadge: false,
  });

  // High importance channel (for urgent reminders, heads-up notification)
  await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS_HIGH, {
    name: "Urgent Reminders",
    description: "High priority reminders that appear as heads-up notifications",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 500, 200, 500],
    lightColor: "#FF6B6B",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
    enableLights: true,
    enableVibrate: true,
    showBadge: false,
  });

  console.log("Android notification channels registered");
}

async function getCurrentUserId(): Promise<string> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return "guest";
    }
    return user.id;
  } catch {
    return "guest";
  }
}

async function registerNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(CATEGORY_REMINDER, [
    {
      identifier: ACTION_DONE,
      buttonTitle: "Yuh",
      options: { isDestructive: false, isAuthenticationRequired: false, opensAppToForeground: true },
    },
    {
      identifier: ACTION_DISMISS,
      buttonTitle: "Nuh",
      options: { isDestructive: false, isAuthenticationRequired: false, opensAppToForeground: false },
    },
    {
      identifier: ACTION_TOO_ANNOYING,
      buttonTitle: "Ugh",
      options: { isDestructive: true, isAuthenticationRequired: false, opensAppToForeground: false },
    },
    // {
    //   identifier: ACTION_BAD_TIMING,
    //   buttonTitle: "Bad Timing",
    //   options: { isDestructive: false, isAuthenticationRequired: false, opensAppToForeground: false },
    // },
  ]);
}

/**
 * SETUP NOTIFICATIONS
 * Initialize notification handler
 */
export async function setupNotifications(): Promise<void> {
  try {
    // Request permissions
    const { status, canAskAgain } =
      await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      });

    if (status !== "granted") {
      console.warn(
        canAskAgain
          ? "Notification permissions not granted — will ask again later"
          : "Notification permissions permanently denied — user must enable in Settings"
      );
      return;
    }

    await setupAndroidChannels();

    await registerNotificationCategories();
    console.log("Notifications initialized successfully");
  } catch (error) {
    console.error("Error setting up notifications:", error);
  }
}

async function updateReminderSentTracking(userId: string): Promise<void> {
  try {
    const { data: state, error: fetchError } = await supabase
      .from("behaviour_state")
      .select("reminders_sent_today")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching behaviour_state for tracking:", fetchError);
      return;
    }

    const current = Number(state?.reminders_sent_today ?? 0);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("behaviour_state")
      .upsert(
        {
          id: userId,
          reminders_sent_today: current + 1,
          last_reminder_time: now,
        },
        { onConflict: "id" }
      );

    if (error) console.error("Supabase upsert error (reminder tracking):", error);
    else console.log(`Reminder tracking updated: sent_today=${current + 1}, last_reminder_time=${now}`);
  } catch (error) {
    console.error("Error updating reminder tracking:", error);
  }
}

/**
 * SEND LOCAL NOTIFICATION (for testing or local delivery)
 */
export async function sendLocalNotification(
  title: string,
  body: string,
  actionLabel?: string,
  urgent: boolean = false // Pass true to use high-importance Android channel
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "default",
        badge: 1,
        categoryIdentifier: CATEGORY_REMINDER,
        data: {
          actionLabel: actionLabel || "View",
        },
        // Android-specific fields
        ...(Platform.OS === "android" && {
          channelId: urgent ? CHANNEL_REMINDERS_HIGH : CHANNEL_REMINDERS,
          color: "#FF6B6B",
          tag: "reminder",
          sticky: false,
          autoDismiss: true,
        }),
      },
      trigger: { seconds: 1 } as any,
    });

    const userId = await getCurrentUserId();
    await updateReminderSentTracking(userId);
  } catch (error) {
    console.error("Error sending local notification:", error);
  }
}

async function maybeSendAnnoyingThresholdNotification(annoyingCount: number): Promise<void> {
  if (annoyingCount < 3) return;
 
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "We hear you! 😅",
        body: `You have 'Ugh'-ed at us ${annoyingCount} too many times… would you like to edit your Coaching preferences in Settings.`,
        sound: "default",
        badge: 1,
        // No category — this is an informational nudge, not an actionable reminder
        ...(Platform.OS === "android" && {
          channelId: CHANNEL_REMINDERS,
          color: "#FF6B6B",
          tag: "annoying_threshold",
          sticky: false,
          autoDismiss: true,
        }),
      },
      trigger: { seconds: 2 } as any,
    });
    console.log("Annoying threshold notification scheduled");
  } catch (error) {
    console.error("Error scheduling annoying threshold notification:", error);
  }
}


async function handleBehaviourStateUpdate(
  userId: string,
  actionIdentifier: string
): Promise<void> {
  try {
    // Fetch current behaviour_state row for the user
    const { data: state, error: fetchError } = await supabase
      .from("behaviour_state")
      .select(
        "ignored_count, annoying_count, reminders_completed_today, next_reminder_time, current_streak"
      )
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching behaviour_state:", fetchError);
      return;
    }

    switch (actionIdentifier) {
      case ACTION_DONE: {
        const current = Number(state?.reminders_completed_today ?? 0);
        const currentStreak = Number(state?.current_streak ?? 0);
        const { error } = await supabase
          .from("behaviour_state")
          .upsert({ id: userId, reminders_completed_today: current + 1, current_streak: currentStreak + 1 },
            { onConflict: "id" }
          );
        if (error) {
          console.error("Error updating behaviour_state:", error);
        }
        console.log("Behaviour updated: Done");
        break;
      }

      case ACTION_DISMISS: {
        const current = Number(state?.ignored_count ?? 0);
        const { error } = await supabase
          .from("behaviour_state")
          .upsert({ id: userId, ignored_count: current + 1 },
            { onConflict: "id" }
          );
        if (error) {
          console.error("Error updating behaviour_state:", error);
        }
        console.log("Behaviour updated: Dismissed");
        break;
      }

      case ACTION_TOO_ANNOYING: {
        const current = Number(state?.annoying_count ?? 0);
        // const currentStreak = Number(state?.current_streak ?? 0);
        const { error } = await supabase
          .from("behaviour_state")
          .upsert({ id: userId, annoying_count: current + 1},
            { onConflict: "id" }
          );
        if (error) {
          console.error("Error updating behaviour_state:", error);
        }
        console.log("Behaviour updated: Too Annoying");
        await maybeSendAnnoyingThresholdNotification(current + 1);
        break;
      }

      // case ACTION_BAD_TIMING: {
      //   const current = Number(state?.ignored_count ?? 0);
      //   await supabase
      //     .from("behaviour_state")
      //     .update({ ignored_count: current + 1 })
      //     .eq("id", userId);
      //   console.log("Behaviour updated: Bad Timing");
      //   break;
      // }

      case Notifications.DEFAULT_ACTION_IDENTIFIER: {
        console.log("Notification tapped (no action button selected)");
        break;
      }

      default:
        console.log("Unknown action identifier:", actionIdentifier);
    }
  } catch (error) {
    console.error("Error updating behaviour_state:", error);
  }
}

/**
 * TRIGGER REMINDER
 * Calls the reminder engine and sends notification if reminder is selected
 */
export async function triggerReminder(): Promise<void> {
  console.log("Triggering reminder check...");
  try {
    const userId = await getCurrentUserId();
    console.log(userId);

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
        reminder.action_label,
        (reminder as { urgent?: boolean }).urgent ?? false
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
      const actionIdentifier = response.actionIdentifier;
      const notificationId = response.notification.request.identifier;
      await Notifications.dismissNotificationAsync(notificationId);

      const { actionLabel } = response.notification.request.content.data;

      console.log("User interacted with notification:", actionIdentifier);
      const userId = await getCurrentUserId();
      await handleBehaviourStateUpdate(userId, actionIdentifier);

      if (actionLabel) {
        console.log("User interacted with notification:", actionLabel);

        // Log interaction in reminder_log
        try {
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
                interaction_action: actionIdentifier,
              })
              .eq("id", lastReminder[0].id);
          }
        } catch (error) {
          console.error("Error logging notification interaction:", error);
        }
      }
    }
  );

  const foregroundSubscription =
    Notifications.addNotificationReceivedListener((notification) => {
      console.log(
        "Notification received in foreground:",
        notification.request.content.title
      );
      // You can handle foreground display logic here if needed
    });

  // Return cleanup function
  return () => {
    subscription.remove();
    foregroundSubscription.remove();
  };
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