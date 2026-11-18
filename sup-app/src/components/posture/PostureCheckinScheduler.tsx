import { useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  cancelPostureCheckinNotifications,
  handlePostureCheckinResponse,
  sendPostureCheckinNotification,
  setupNotifications,
} from "@/src/services/reminder/pushNotificationService";
import { POSTURE_CHECKIN_INTERVAL_SECONDS, POSTURE_CHECKIN_TYPE } from "@/src/services/posture/postureCheckinService";

/** How often the timer checks whether a check-in is due. */
const CHECK_EVERY_MS = 30 * 1000;

/**
 * Renders nothing. While someone is signed in (check-ins are saved per user),
 * runs an in-app timer that sends a "Quick check" notification every
 * POSTURE_CHECKIN_INTERVAL_SECONDS. Being a JS timer, it only runs while the
 * app is open or running in the background — the same as the posture/session
 * alerts — so nothing arrives once the app is closed. Also opens the check-in
 * screen if the app was launched by tapping one.
 */
export default function PostureCheckinScheduler() {
  const { userId } = useAuth();
  const pathname = usePathname();
  const pendingLaunch = useRef<Notifications.NotificationResponse | null>(null);
  const checkedLaunch = useRef(false);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const routingSettled = (p: string) => p !== "/" && !p.startsWith("/onboarding");

  // Clear check-ins earlier builds queued with the OS (they'd still arrive
  // with the app closed), once per launch.
  useEffect(() => { void cancelPostureCheckinNotifications(); }, []);

  useEffect(() => {
    if (!userId) {
      console.log("[notif] posture check-in: signed out → off");
      return;
    }
    console.log(`[notif] posture check-in: signed in → every ${POSTURE_CHECKIN_INTERVAL_SECONDS}s while the app runs`);
    let ready = false;
    void setupNotifications().then(() => { ready = true; });
    // Compare against the last send rather than counting ticks, so a timer
    // that was paused (e.g. iOS suspending the app) still sends just one
    // when it resumes instead of a burst.
    let lastSentAt = Date.now();
    const timer = setInterval(() => {
      if (!ready || Date.now() - lastSentAt < POSTURE_CHECKIN_INTERVAL_SECONDS * 1000) return;
      lastSentAt = Date.now();
      void sendPostureCheckinNotification();
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [userId]);

  // Cold start: the tap listener isn't registered yet when the app launches
  // from a notification, so read the launching response once.
  useEffect(() => {
    if (checkedLaunch.current) return;
    checkedLaunch.current = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response?.notification.request.content.data?.type !== POSTURE_CHECKIN_TYPE) return;
        // Ignore stale responses from an older launch
        if (Date.now() - response.notification.date > 15 * 60 * 1000) return;
        Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
        if (routingSettled(pathnameRef.current)) handlePostureCheckinResponse(response);
        else pendingLaunch.current = response;
      })
      .catch(() => {});
  }, []);

  // Open it only once startup routing (app/index.tsx) has moved off "/",
  // otherwise the startup redirect would replace the check-in screen.
  useEffect(() => {
    if (!pendingLaunch.current || !routingSettled(pathname)) return;
    const response = pendingLaunch.current;
    pendingLaunch.current = null;
    handlePostureCheckinResponse(response);
  }, [pathname]);

  return null;
}
