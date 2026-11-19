import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useIMUContext } from "@/src/contexts/IMUContext";
import { POSTURE_LABELS } from "@/src/lib/imuParser";
import { formatSessionMins } from "@/src/lib/formatDuration";
import { sessionXp } from "@/src/services/xp/xpRules";
import { startTrackingService } from "@/modules/sup-foreground-service";
import { captureError } from "@/src/lib/sentry";
import type { DeskPostureState } from "./mockDeskPostureData";

/** Coloured dot per posture state, matching the Desk colours (green → red). */
const STATE_DOT: Record<DeskPostureState, string> = {
  upright: "🟢",
  transition: "🟡",
  forward_lean: "🟠",
  tilted_left: "🟠",
  tilted_right: "🟠",
  slouched: "🟠",
  severe: "🔴",
};

/**
 * Shortest gap between two notification updates — only a guard against
 * bursts. A confirmed posture can't change more often than every ~0.4 s
 * (STATE_CONFIRM_MS in imuParser), so posture changes go out immediately.
 */
export const SESSION_LIVE_MIN_GAP_MS = 250;

export interface SessionLiveContent {
  title: string;
  body: string;
}

/**
 * Text for the pinned notification, e.g.
 *   "s'ession in progress · 24min"
 *   "🟢 good alignment · 10 xp so far"
 * or, if a s'pot dropped: "⚠️ a s'pot disconnected — open s'up to reconnect".
 */
export function buildSessionLiveContent(input: {
  durationMs: number;
  state: DeskPostureState | null;
  bothConnected: boolean;
}): SessionLiveContent {
  const minutes = Math.max(0, Math.floor(input.durationMs / 60_000));
  const title = `s'ession in progress · ${formatSessionMins(minutes)}`;
  if (!input.bothConnected) return { title, body: "⚠️ a s'pot disconnected — open s'up to reconnect" };
  const xp = sessionXp({ sit: input.durationMs });
  const posture = input.state ? `${STATE_DOT[input.state]} ${POSTURE_LABELS[input.state]}` : "reading your posture…";
  return { title, body: `${posture} · ${xp} xp so far` };
}

const keyOf = (c: SessionLiveContent) => `${c.title}\n${c.body}`;

/**
 * Renders nothing. While a session runs, keeps the live status showing the
 * current posture, session time and XP so far — like a ride-status notification:
 *   - Android: the foreground service's pinned notification
 *   - iOS: a Live Activity (lock screen + Dynamic Island, iOS 16.2+)
 * Both come from modules/sup-foreground-service, started and stopped by
 * IMUContext; each update calls start() again, which replaces the text in place.
 *
 * Fed by every s'pot packet (IMUContext.registerLiveStatus), not by React
 * state, so it updates within about a second of a posture change and keeps
 * updating in the background (where IMUContext doesn't update `posture`).
 * When the session ends, IMUContext stops the service, removing the notification.
 */
export default function SessionLiveNotification() {
  const { sessionStartTimeMs, posture, bothConnected, registerLiveStatus } = useIMUContext();
  const enabled = Platform.OS === "android" || Platform.OS === "ios";

  // Latest known values: packets update these directly; renders refresh them too.
  const stateRef = useRef<DeskPostureState | null>(posture?.state ?? null);
  const startRef = useRef<number | null>(sessionStartTimeMs);
  const connectedRef = useRef(bothConnected);
  startRef.current = sessionStartTimeMs;
  connectedRef.current = bothConnected;
  if (posture?.state) stateRef.current = posture.state;

  const shownKey = useRef<string | null>(null);
  const lastPostedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Sends the current status if it changed, at most once per SESSION_LIVE_MIN_GAP_MS. */
  const maybePost = useCallback(() => {
    const start = startRef.current;
    if (!enabled || start === null) {
      // Session over: IMUContext stops the service (and its notification).
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      shownKey.current = null;
      return;
    }
    const content = buildSessionLiveContent({
      durationMs: Date.now() - start, state: stateRef.current, bothConnected: connectedRef.current,
    });
    const key = keyOf(content);
    if (key === shownKey.current) return;
    const wait = lastPostedAt.current + SESSION_LIVE_MIN_GAP_MS - Date.now();
    if (wait > 0) {
      // Too soon: try again when the gap is up (the next packet may get there first).
      if (!timer.current) timer.current = setTimeout(() => { timer.current = null; maybePost(); }, wait);
      return;
    }
    shownKey.current = key;
    lastPostedAt.current = Date.now();
    // The session start lets the iOS Live Activity run its own seconds timer.
    try { startTrackingService(content.title, content.body, start); } catch (e) { captureError(e, "tracking-service-update"); }
  }, [enabled]);

  // Every packet: newest confirmed posture, straight from IMUContext's refs.
  useEffect(() => {
    if (!enabled) return;
    registerLiveStatus((update) => {
      stateRef.current = update.state;
      startRef.current = update.sessionStartTimeMs;
      maybePost();
    });
    return () => registerLiveStatus(null);
  }, [enabled, registerLiveStatus, maybePost]);

  // Session start/end, connection changes and foreground posture updates.
  useEffect(() => { maybePost(); }, [sessionStartTimeMs, bothConnected, posture?.state, maybePost]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return null;
}
