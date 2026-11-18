import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/src/lib/supabase";
import { getReminderForUser, getReEngagementReminder } from "./reminderEngineService";
import {
  POSTURE_CHECKIN_INTERVAL_SECONDS,
  POSTURE_CHECKIN_TYPE,
} from "../posture/postureCheckinService";

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
const CHANNEL_SESSION_ALERTS = "session_alerts";

// data.type marking a background alert mirrored from an in-app pop-up
const SESSION_ALERT_TYPE = "session_alert";

// Fixed identifier, so scheduling again replaces the pending re-engagement reminder
const RE_ENGAGEMENT_ID = "re-engagement";
const RE_ENGAGEMENT_TYPE = "re_engagement";

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

  // Posture alerts / session events mirrored from in-app pop-ups while backgrounded
  await Notifications.setNotificationChannelAsync(CHANNEL_SESSION_ALERTS, {
    name: "Posture & Session Alerts",
    description: "Posture alerts and session updates while the app is in the background",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 400, 100, 400],
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

// Shared so every caller waits for the same permission prompt / channel setup
let setupPromise: Promise<void> | null = null;

/**
 * SETUP NOTIFICATIONS
 * Initialize notification handler. Safe to call more than once.
 */
export function setupNotifications(): Promise<void> {
  if (!setupPromise) setupPromise = doSetupNotifications();
  return setupPromise;
}

async function doSetupNotifications(): Promise<void> {
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
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1, // Send immediately
        repeats: false,
      },
    });

    const userId = await getCurrentUserId();
    await updateReminderSentTracking(userId);
  } catch (error) {
    console.error("Error sending local notification:", error);
  }
}

/**
 * SEND BACKGROUND ALERT
 * Mirrors an in-app pop-up (posture alert, session event) as a local
 * notification, but only while the app isn't in the foreground — the in-app
 * pop-up already covers that case. Deliberately no reminder category, no
 * actionLabel and no reminder tracking, so it never touches behaviour_state
 * or reminder_log. No fixed identifier, so each alert is a separate,
 * swipeable notification rather than replacing the previous one. Tapping it
 * opens Desk Mode (see setupNotificationListeners), where the pop-up shows.
 */
export async function sendBackgroundAlert(kind: string, title: string, body: string): Promise<void> {
  if (AppState.currentState === "active") {
    console.log(`[notif] ${kind}: app in foreground, in-app pop-up only`);
    return;
  }
  console.log(`[notif] ${kind}: sending background notification`);
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "default",
        data: { type: SESSION_ALERT_TYPE, kind },
        ...(Platform.OS === "android" && {
          channelId: CHANNEL_SESSION_ALERTS,
          color: "#FF6B6B",
          sticky: false,
          autoDismiss: true,
        }),
      },
      trigger: null, // Deliver immediately
    });
  } catch (error) {
    console.error("Error sending background alert:", error);
  }
}

/**
 * Clears every background alert of one kind still in the tray, once what it
 * warned about is no longer relevant (posture moved, s'pot reconnected).
 */
export async function dismissBackgroundAlerts(kind: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => n.request.content.data?.type === SESSION_ALERT_TYPE && n.request.content.data?.kind === kind)
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
  } catch (error) {
    console.error("Error dismissing background alerts:", error);
  }
}

// ─── Posture check-in ("Quick check") ──────────────────────────────────────

// Every check-in id starts with this. Earlier builds queued "posture-checkin-0…59"
// (and before that "posture-checkin-repeating") with the OS, which delivered them
// even with the app closed; those are cleared on startup.
const POSTURE_CHECKIN_PREFIX = "posture-checkin-";
// The one check-in shown at a time: a new one replaces the previous in the tray.
const POSTURE_CHECKIN_ID = `${POSTURE_CHECKIN_PREFIX}current`;

/**
 * Shows a "Quick check" notification right now. Called by the app's own timer
 * (PostureCheckinScheduler) every POSTURE_CHECKIN_INTERVAL_SECONDS, so — like
 * the posture/session alerts — check-ins only arrive while the app is open or
 * running in the background, never once it has been closed.
 */
export async function sendPostureCheckinNotification(): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      console.log("[notif] posture check-in: no permission, not sent");
      return;
    }
    await Notifications.scheduleNotificationAsync({
      identifier: POSTURE_CHECKIN_ID,
      content: {
        title: "Quick check",
        body: "Catching your posture during the day is how habits change. How are you sitting right now?",
        sound: "default",
        data: { type: POSTURE_CHECKIN_TYPE },
        ...(Platform.OS === "android" && { color: "#FF6B6B", autoDismiss: true }),
      },
      // Deliver immediately. expo-notifications 0.32 reads the Android channel
      // from the trigger, not the content.
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_REMINDERS_HIGH } : null,
    });
    console.log(`[notif] posture check-in sent (next in ${POSTURE_CHECKIN_INTERVAL_SECONDS}s while the app runs)`);
  } catch (error) {
    console.error("Error sending posture check-in:", error);
  }
}

/** Removes any check-ins still queued with the OS (left over from earlier builds). */
export async function cancelPostureCheckinNotifications(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(POSTURE_CHECKIN_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
    );
  } catch (error) {
    console.error("Error cancelling posture check-in:", error);
  }
}

/** Clears check-ins still sitting in the tray (they'd otherwise pile up). */
async function dismissPresentedPostureCheckins(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => n.request.content.data?.type === POSTURE_CHECKIN_TYPE)
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
  } catch (error) {
    console.error("Error dismissing posture check-ins:", error);
  }
}

// Same tap can arrive via the listener and getLastNotificationResponseAsync
let lastHandledCheckinKey: string | null = null;

/** True if the response was a posture check-in (and the screen was opened). */
export function handlePostureCheckinResponse(response: Notifications.NotificationResponse): boolean {
  const { notification } = response;
  if (notification.request.content.data?.type !== POSTURE_CHECKIN_TYPE) return false;

  const key = `${notification.request.identifier}:${notification.date}`;
  if (key === lastHandledCheckinKey) return true;
  lastHandledCheckinKey = key;

  void dismissPresentedPostureCheckins();
  const sent = new Date(notification.date);
  const sentAt = Number.isNaN(sent.getTime()) ? "" : sent.toISOString();
  router.navigate({ pathname: "/(modals)/posture-checkin", params: { sentAt, source: "notification" } });
  return true;
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
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2, // Slight delay so it doesn't fire simultaneously with any dismiss
        repeats: false,
      },
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
 * SCHEDULE RE-ENGAGEMENT REMINDER
 * Call when the user leaves the app (and at startup). Replaces any pending
 * one with a reminder 48h from now, inside active hours — so it fires only if
 * the user really stays away that long. The interval-driven triggerReminder()
 * can't do this: it only runs while the app is open. Signed out, no active
 * hours or no content → the pending one is just cancelled.
 */
export async function scheduleReEngagementReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(RE_ENGAGEMENT_ID);
    const reminder = await getReEngagementReminder();
    if (!reminder) return;
    const { content, fireAt } = reminder;
    await Notifications.scheduleNotificationAsync({
      identifier: RE_ENGAGEMENT_ID,
      content: {
        title: content.title,
        body: content.body,
        sound: "default",
        categoryIdentifier: CATEGORY_REMINDER,
        data: {
          actionLabel: content.action_label || "View",
          type: RE_ENGAGEMENT_TYPE,
          reminderContentId: content.id,
          fireAt: fireAt.toISOString(),
        },
        ...(Platform.OS === "android" && {
          channelId: CHANNEL_REMINDERS,
          color: "#FF6B6B",
          tag: "reminder",
          sticky: false,
          autoDismiss: true,
        }),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
    console.log("Re-engagement reminder scheduled for", fireAt.toISOString());
  } catch (error) {
    console.error("Error scheduling re-engagement reminder:", error);
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

    // Update last interaction timestamp. This runs only while the app is open,
    // so the engine's 48h re-engagement check never fires from here — that
    // case is covered by scheduleReEngagementReminder() instead.
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

      // Background alerts aren't reminders — just open Desk Mode
      if (response.notification.request.content.data?.type === SESSION_ALERT_TYPE) {
        router.navigate("/(tabs)/desk");
        return;
      }

      // Posture check-in isn't a reminder either — open the check-in screen
      if (handlePostureCheckinResponse(response)) return;

      const { actionLabel } = response.notification.request.content.data;

      console.log("User interacted with notification:", actionIdentifier);
      const userId = await getCurrentUserId();
      await handleBehaviourStateUpdate(userId, actionIdentifier);

      // A scheduled re-engagement reminder was never logged when it was
      // scheduled (it may have been replaced), so log it now, as delivered
      // and interacted with — rather than marking an older reminder's row.
      const data = response.notification.request.content.data;
      if (data?.type === RE_ENGAGEMENT_TYPE) {
        if (userId === "guest") return;
        const now = new Date().toISOString();
        const { error } = await supabase.from("reminder_log").insert({
          user_id: userId,
          reminder_content_id: data.reminderContentId,
          reminder_type: RE_ENGAGEMENT_TYPE,
          sent_at: typeof data.fireAt === "string" ? data.fireAt : now,
          created_at: now,
          user_interacted: true,
          interaction_at: now,
          interaction_action: actionIdentifier,
        });
        if (error) console.error("Error logging re-engagement interaction:", error);
        return;
      }

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