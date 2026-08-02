import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { claudeProvider } from "../services/ai/claudeProvider";
import { fetchLast7DaysPosture } from "../services/posture/postureSyncService";
import { upsertDailyAiSummary } from "../services/ai/dailyAiSummaryService";
import { supabase } from "@/src/lib/supabase";
import { PostureData } from "../services/ai/aiProvider";

export const DAILY_SUMMARY_TASK = "DAILY_SUMMARY_TASK";

TaskManager.defineTask(DAILY_SUMMARY_TASK, async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return BackgroundFetch.BackgroundFetchResult.NoData;

    const today = new Date().toISOString().slice(0, 10);
    const rows = await fetchLast7DaysPosture(user.id, today);
    if (!rows.length) return BackgroundFetch.BackgroundFetchResult.NoData;
    
    const postureData: PostureData[] = rows.map((row, index) => {
        const date = new Date(today);
        date.setDate(date.getDate() - (rows.length - 1 - index));

        return {
            date,
            uprightMinutesDaily:     Math.round((row.stateTotals?.upright       ?? 0) / 60000),
            slouchedMinutesDaily:    Math.round((row.stateTotals?.slouched       ?? 0) / 60000),
            severeMinutesDaily:      Math.round((row.stateTotals?.severe         ?? 0) / 60000),
            forwardLeanMinutesDaily: Math.round((row.stateTotals?.forward_lean   ?? 0) / 60000),
            tiltedLeftMinutesDaily:  Math.round((row.stateTotals?.tilted_left    ?? 0) / 60000),
            tiltedRightMinutesDaily: Math.round((row.stateTotals?.tilted_right   ?? 0) / 60000),
            supScoreDaily:           row.supScore ?? 0,
            totalTrackedMinutesDaily: Math.round((row.totalDeskMs ?? 0) / 60000),
        };
    });

    const { insight, concisedSummary } = await claudeProvider.getScheduledDailyInsight(postureData, "home");

    await upsertDailyAiSummary(user.id, today, concisedSummary, insight);

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.error("[dailySummaryTask] failed", e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerDailySummaryTask() {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    console.warn("[dailySummaryTask] background fetch not available");
    return;
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(DAILY_SUMMARY_TASK);
  if (!isRegistered) {
    await BackgroundFetch.registerTaskAsync(DAILY_SUMMARY_TASK, {
      minimumInterval: 60 * 60 * 8, // every 8 hours minimum — OS decides exact timing
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
}