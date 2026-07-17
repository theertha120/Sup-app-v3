import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DailyPosturePair } from "./postureSyncService";

const STALE_MS = 60_000; // 1 minute

function cacheKey(userId: string, dateKey: string) {
  return `dailyPair:${userId}:${dateKey}`;
}

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
  } catch {
    return null;
  }
}

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
  } catch {}
}