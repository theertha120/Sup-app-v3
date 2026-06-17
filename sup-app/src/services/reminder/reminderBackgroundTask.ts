import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { triggerReminder } from "./pushNotificationService"; // adjust path as needed
import { bgLog } from "./backgroundLogger"; // optional: for additional logging to file

export const REMINDER_BACKGROUND_TASK = "reminder-background-task";
const LAST_WAKE_KEY = "bg_task_last_wake";

// Define the task at module level — TaskManager requirement
TaskManager.defineTask(REMINDER_BACKGROUND_TASK, async () => {
  await bgLog("[BackgroundTask] ===== TASK WOKEN BY OS =====");
  await bgLog("[BackgroundTask] Task fired at: " + new Date().toISOString());

  // --- DIAGNOSTIC: Persist wake time so foreground can confirm OS fired this ---
  try {
    await AsyncStorage.setItem(LAST_WAKE_KEY, now);
    await bgLog("[BackgroundTask] Persisted wake timestamp to AsyncStorage OK.");
  } catch (storageError) {
    await bgLog("[BackgroundTask] Could not persist wake timestamp:", storageError);
  }

  // --- DIAGNOSTIC: Confirm we are NOT on the main JS thread foreground loop ---
  await bgLog("[BackgroundTask] JS environment check — this log appearing means the task executor is running.");

  try {
    await bgLog("[BackgroundTask] Calling triggerReminder()...");
    if (typeof triggerReminder !== "function") {
        await bgLog("[BackgroundTask] triggerReminder is not a function! Check your imports and ensure reminderEngineService is properly imported in pushNotificationService.");
        return BackgroundTask.BackgroundTaskResult.Failed;
    }
    const reminderResult = await triggerReminder();
    await bgLog("[BackgroundTask] triggerReminder() completed.", reminderResult);
    await bgLog("[BackgroundTask] Returning NewData to OS.");
    return BackgroundTask.BackgroundTaskResult.Success;  // changed: NewData → Success
  } catch (error) {
    await bgLog("[BackgroundTask] triggerReminder() threw an error:", error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Call this when the app returns to foreground to check whether the
 * background task was actually woken by the OS while the app was closed.
 */
// THIS IS WHERE IT FAILS — the log shows the task is firing and the wake time is persisted, but the OS never actually wakes the task.
export async function logLastBackgroundWake(): Promise<void> {
  try {
    const lastWake = await AsyncStorage.getItem(LAST_WAKE_KEY);
    if (lastWake) {
      await bgLog("[BackgroundTask] ✅ OS DID wake the background task. Last wake:", lastWake);
      const elapsed = Date.now() - new Date(lastWake).getTime();
      await bgLog(`[BackgroundTask] That was ${Math.round(elapsed / 1000)}s ago.`);
    } else {
      await bgLog("[BackgroundTask] ❌ OS has NOT woken the background task yet (no persisted timestamp).");
      await bgLog("[BackgroundTask] Possible reasons:");
      await bgLog("  1. Not enough time has passed (iOS throttles to ~2–15 min minimum, ignores minimumInterval in dev).");
      await bgLog("  2. iOS Low Power Mode is ON — background tasks are suspended.");
      await bgLog("  3. The app was force-quit by the user (swipe-close) — iOS won't wake force-quit apps.");
      await bgLog("  4. Background App Refresh is OFF for this app in iOS Settings.");
      await bgLog("  5. You are on a simulator — background tasks do not fire on iOS Simulator.");
      await bgLog("  6. Android: Battery optimization is ON for this app — go to Settings → Apps → Battery → Unrestricted.");
    }
  } catch (e) {
    await bgLog("[BackgroundTask] Could not read last wake timestamp:", e);
  }
}

/**
 * Registers the background task and logs full diagnostic info.
 */
export async function registerReminderBackgroundTask(): Promise<void> {
  await bgLog("[BackgroundTask] registerReminderBackgroundTask() called.");

  try {
    // Step 1: Check if the task definition exists (i.e. the import ran correctly)
    const isDefined = TaskManager.isTaskDefined(REMINDER_BACKGROUND_TASK);
    await bgLog(`[BackgroundTask] Is task defined (import ran correctly): ${isDefined}`);
    if (!isDefined) {
      await bgLog(
        "[BackgroundTask] TASK IS NOT DEFINED — the import of reminderBackgroundTask.ts " +
        "did not run before the app rendered. Make sure it is imported at the very top of " +
        "_layout.tsx before any other imports."
      );
      return;
    }

    // Step 2: Check if already registered with the OS
    const isRegistered = await TaskManager.isTaskRegisteredAsync(REMINDER_BACKGROUND_TASK);
    await bgLog(`[BackgroundTask] Is task already registered with OS: ${isRegistered}`);

    if (isRegistered) {
        // FOR TESTING ONLY
        await BackgroundTask.unregisterTaskAsync(REMINDER_BACKGROUND_TASK);
    }
    // ORIGINAL:
    //   console.log("[BackgroundTask] Task already registered — skipping re-registration.");

    //   // Log current background task status so we can see what the OS thinks
    //   const status = await BackgroundTask.getStatusAsync();
    //   console.log(`[BackgroundTask] Current BackgroundTask OS status: ${backgroundTaskStatusLabel(status)}`);
    //   return;
    // }

    // Step 3: Check if the OS allows background tasks before registering
    const status = await BackgroundTask.getStatusAsync();
    await bgLog(`[BackgroundTask] BackgroundTask OS status before registration: ${backgroundTaskStatusLabel(status)}`);

    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      await bgLog(
        "[BackgroundTask] RESTRICTED — background tasks are unavailable on this device. " +
        "On iOS: Settings → General → Background App Refresh must be ON for this app. " +
        "On Android: Battery optimisation must be disabled for this app. " +
        "On web: background tasks are always restricted."
      );
      return;
    }

    // Step 4: Register the task
    await bgLog("[BackgroundTask] Registering task with OS now...");
    await BackgroundTask.registerTaskAsync(REMINDER_BACKGROUND_TASK, {
      minimumInterval: 60 * 1, // 1 minute — OS may fire less frequently than this FOR TESTING ONLY
      // minimumInterval: 60 * 15, // 15 minutes — OS may fire less frequently than this (default for expo-background-task)
    });
    // Note: stopOnTerminate and startOnBoot are no longer options in expo-background-task
    // — the library handles this automatically on both iOS and Android.

    // Step 5: Confirm registration succeeded
    const isNowRegistered = await TaskManager.isTaskRegisteredAsync(REMINDER_BACKGROUND_TASK);
    await bgLog(`[BackgroundTask] Registration complete. Confirmed registered: ${isNowRegistered}`);

    if (!isNowRegistered) {
      await bgLog(
        "[BackgroundTask] Registration call succeeded but task is still not registered — " +
        "this is unexpected. Try rebuilding the dev client."
      );
    }

  } catch (error) {
    await bgLog("[BackgroundTask] Exception during registerReminderBackgroundTask():", error);
  }
}

/**
 * Unregisters the background task.
 * Call this on logout or when user disables notifications.
 */
export async function unregisterReminderBackgroundTask(): Promise<void> {
  await bgLog("[BackgroundTask] unregisterReminderBackgroundTask() called.");
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(REMINDER_BACKGROUND_TASK);
    await bgLog(`[BackgroundTask] Is registered before unregister: ${isRegistered}`);

    if (isRegistered) {
      await BackgroundTask.unregisterTaskAsync(REMINDER_BACKGROUND_TASK);
      await bgLog("[BackgroundTask] Task successfully unregistered.");
    } else {
      await bgLog("[BackgroundTask] Task was not registered — nothing to unregister.");
    }
  } catch (error) {
    await bgLog("[BackgroundTask] Failed to unregister background task:", error);
  }
}

/**
 * Helper to convert BackgroundTaskStatus enum to a readable string for logging.
 */
function backgroundTaskStatusLabel(status: BackgroundTask.BackgroundTaskStatus | null): string {
  switch (status) {
    case BackgroundTask.BackgroundTaskStatus.Available:
      return "Available.OS will run background tasks";
    case BackgroundTask.BackgroundTaskStatus.Restricted:
      return "Restricted. Background tasks unavailable (check Background App Refresh on iOS, battery optimisation on Android)";
    default:
      return `Unknown (raw value: ${status})`;
  }
}