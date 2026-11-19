import { AppRegistry, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Keeps a posture session visible (and, on Android, alive) in the background.
 *
 * - Android: a foreground service with a pinned notification
 *   (android/.../PostureTrackingService.kt). It keeps the process, BLE stream
 *   and JS timers alive once the app is backgrounded.
 * - iOS: a Live Activity on the lock screen and in the Dynamic Island
 *   (ios/SupForegroundServiceModule.swift, drawn by targets/sup-live-activity).
 *   iOS keeps the session running through the bluetooth-central background mode;
 *   the Live Activity only shows its status. Needs iOS 16.2+.
 *
 * No-op on any build made before this native module existed.
 */
interface SupForegroundServiceNative {
  // Android takes (title, body); iOS also takes the session start for its live timer.
  start(title: string, body: string, startedAtMs?: number | null): void;
  stop(): void;
}

const native =
  Platform.OS === "android" || Platform.OS === "ios"
    ? requireOptionalNativeModule<SupForegroundServiceNative>("SupForegroundService")
    : null;

// Android: the native side holds this task open while the service runs so
// React Native keeps firing JS timers in the background, and ends it natively
// on stop(). The promise never resolves on its own.
if (native && Platform.OS === "android") {
  AppRegistry.registerHeadlessTask("SupTrackingKeepAlive", () => () => new Promise<void>(() => {}));
}

/**
 * Shows (or updates in place) the live status: the Android foreground service
 * notification, or the iOS Live Activity. `startedAtMs` is the session start,
 * used by iOS for a timer that counts up by itself; Android ignores it.
 */
export function startTrackingService(title: string, body: string, startedAtMs: number | null = null): void {
  if (Platform.OS === "ios") native?.start(title, body, startedAtMs);
  else native?.start(title, body);
}

/** Stops the Android service (removing its notification) / ends the iOS Live Activity. */
export function stopTrackingService(): void {
  native?.stop();
}
