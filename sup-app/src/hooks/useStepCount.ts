import { useEffect, useState } from "react";
import { Platform } from "react-native";
import {
  initialize,
  requestPermission,
  readRecords,
  getSdkStatus,
  SdkAvailabilityStatus,
  grantedPermissions,
} from "react-native-health-connect";

export interface StepData {
  todaySteps: number;
  yesterdaySteps: number;
  isLoading: boolean;
  error: string | null;
}

async function fetchStepsForDay(daysAgo: number): Promise<number> {
  const end = new Date();
  end.setDate(end.getDate() - daysAgo);
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setHours(0, 0, 0, 0);

  try {
    const { records } = await readRecords("Steps", {
      timeRangeFilter: {
        operator: "between",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      },
    });
    return records.reduce((sum, record) => sum + (record.count ?? 0), 0);
  } catch {
    return 0;
  }
}

export function useStepCount(): StepData {
  const [todaySteps, setTodaySteps] = useState(0);
  const [yesterdaySteps, setYesterdaySteps] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSteps() {
      if (Platform.OS !== "android") {
        // iOS uses a different flow — skip for now
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Step 1: Check if Health Connect is available on this device
        const status = await getSdkStatus();
        if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
          throw new Error(
            status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
              ? "Health Connect app needs to be updated."
              : "Health Connect is not available on this device."
          );
        }

        // Step 2: Initialize
        const initialized = await initialize();
        if (!initialized) {
          throw new Error("Failed to initialize Health Connect.");
        }

        // Step 3: Check existing permissions first, only request if missing
        const granted = await grantedPermissions();
        const hasSteps = granted.some(
        (p) => p.recordType === "Steps" && p.accessType === "read"
        );

        if (!hasSteps) {
        try {
            await requestPermission([{ accessType: "read", recordType: "Steps" }]);
        } catch (permErr) {
            // Permission dialog failed (Activity not ready) — silently skip
            // Steps will just return 0 this session; retry on next mount
            console.warn("Permission request failed:", permErr);
        }
        }

        // Step 4: Read data (if permission was denied, readRecords returns empty)
        const [today, yesterday] = await Promise.all([
          fetchStepsForDay(0),
          fetchStepsForDay(1),
        ]);

        if (!cancelled) {
          setTodaySteps(today);
          setYesterdaySteps(yesterday);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Failed to load step data.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSteps();

    return () => {
      cancelled = true;
    };
  }, []);

  return { todaySteps, yesterdaySteps, isLoading, error };
}