type Options = {
  check: () => void;
  isActive: () => boolean;
  watch: () => () => void;
  subscribe: (callback: (state: string) => void) => () => void;
  intervalMs: number;
  schedule?: typeof setInterval;
  cancel?: typeof clearInterval;
};

/** Lifetime is the focused Stats screen, including its realtime subscription. */
export function watchStatsFreshness({ check, isActive, watch, subscribe, intervalMs, schedule = setInterval, cancel = clearInterval }: Options) {
  const checkIfActive = () => { if (isActive()) check(); };
  const stopWatching = watch();
  const unsubscribe = subscribe((state) => { if (state === "active") checkIfActive(); });
  const timer = schedule(checkIfActive, intervalMs);
  checkIfActive();
  return () => { cancel(timer); unsubscribe(); stopWatching(); };
}
