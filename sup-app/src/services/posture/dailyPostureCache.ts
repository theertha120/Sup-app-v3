import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DailyPosturePair } from "./postureSyncService";
import { captureError } from "@/src/lib/sentry";

// AsyncStorage cache for the daily screen's today + yesterday pair, so it can
// paint instantly on focus while a fresh fetch runs.

const STALE_MS = 60_000; // 1 minute

// One entry per user per local day.
function cacheKey(userId: string, dateKey: string) {
  return `dailyPair:${userId}:${dateKey}`;
}

// The cached pair, or null if missing, older than STALE_MS, or unreadable.
export async function getCachedDailyPair(
  userId: string,
  dateKey: string
): Promise<DailyPosturePair | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId, dateKey));
    if (!raw) return null;
    const { data, cachedAt } = JSON.parse(raw);
    if (Date.now() - cachedAt > STALE_MS) return null; // expired, force fresh fetch
    return data as DailyPosturePair;
  } catch (e) {
    // Corrupt entry or storage failure — fall through to a fresh fetch.
    captureError(e, "daily-cache-read");
    return null;
  }
}

// Stores the pair with a timestamp; failures are logged, never thrown.
export async function setCachedDailyPair(
  userId: string,
  dateKey: string,
  pair: DailyPosturePair
) {
  try {
    await AsyncStorage.setItem(
      cacheKey(userId, dateKey),
      JSON.stringify({ data: pair, cachedAt: Date.now() })
    );
  } catch (e) {
    captureError(e, "daily-cache-write");
  }
}