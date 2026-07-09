import { useState, useEffect } from "react";
import { aiProvider } from "../services/ai";
import type { PostureData } from "../services/ai/aiProvider";

const FALLBACK_MESSAGE =
  "your posture coach is not feeling too well today and needs a little break :( please check back in a while...";

export function usePostureInsight(data: PostureData) {
  const [insight, setInsight] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setIsError(false);

    aiProvider
      .getPostureInsight(data)
      .then((text) => {
        if (!cancelled) {
          setInsight(text);
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
  }, []);

  return { insight, isLoading, isError, fallback: FALLBACK_MESSAGE };
}