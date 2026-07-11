import { useState, useEffect } from "react";
import { aiProvider } from "../services/ai";
import type { PostureData, PromptType } from "../services/ai/aiProvider";

interface UsePostureInsightParams extends PostureData {
  promptType: PromptType;
  isDataReady?: boolean;
}

const FALLBACK_MESSAGE =
  "your posture coach is not feeling too well today and needs a little break :( please check back in a while...";

export function usePostureInsight({ promptType, isDataReady, ...data }: UsePostureInsightParams) {
  const [response, setResponse] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (!isDataReady) return;

    let cancelled = false;

    setIsLoading(true);
    setIsError(false);

    aiProvider
      .getPostureInsight(data, promptType)
      .then((text) => {
        if (!cancelled) {
          setResponse(text);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsError(true);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isDataReady]);

  return { response, isLoading, isError, fallback: FALLBACK_MESSAGE };
}