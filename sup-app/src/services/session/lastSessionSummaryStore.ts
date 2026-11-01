/**
 * lastSessionSummaryStore.ts
 *
 * Persists the Desk screen's end-of-session summary (replay timeline, header,
 * highlights, comparison, s'kipper message) per user in AsyncStorage, so the
 * latest session's summary survives app restarts until a new session starts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  PostureSegment, SessionComparisonMetric, SessionHighlight,
} from "../../lib/sessionHighlights";
import { captureError } from "../../lib/sentry";

export interface StoredSessionSummary {
  version: 1;
  startMs: number;
  endMs: number;
  score: number | null;
  timeline: PostureSegment[];
  highlights: SessionHighlight[];
  comparison: SessionComparisonMetric[] | null;
  /** null if the app closed before s'kipper replied */
  message: string | null;
  color: "green" | "yellow" | "red";
}

const KEY_PREFIX = "sup_last_session_summary_";

function isStoredSummary(v: any): v is StoredSessionSummary {
  return v && v.version === 1
    && typeof v.startMs === "number" && typeof v.endMs === "number"
    && Array.isArray(v.timeline) && Array.isArray(v.highlights);
}

export async function loadLastSessionSummary(userId: string): Promise<StoredSessionSummary | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isStoredSummary(parsed) ? parsed : null;
  } catch (e) {
    captureError(e, "last-session-summary-load");
    return null;
  }
}

export function saveLastSessionSummary(userId: string, summary: StoredSessionSummary): void {
  AsyncStorage.setItem(KEY_PREFIX + userId, JSON.stringify(summary))
    .catch((e) => captureError(e, "last-session-summary-save"));
}

export function clearLastSessionSummary(userId: string): void {
  AsyncStorage.removeItem(KEY_PREFIX + userId)
    .catch((e) => captureError(e, "last-session-summary-clear"));
}
