type Options = {
  check: () => void;
  invalidate: () => void;
  isActive: () => boolean;
  connect: (changed: () => void) => () => void;
  onResume: (callback: () => void) => () => void;
  pollMs: number;
  debounceMs?: number;
};

/** Refresh only a focused, foreground view. Realtime is optional; polling recovers missed events. */
export function startCommunityFreshness({ check, invalidate, isActive, connect, onResume, pollMs, debounceMs = 350 }: Options) {
  let dirty = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (!isActive()) return;
    if (dirty) { dirty = false; invalidate(); }
    else check();
  };
  const stopRealtime = connect(() => {
    dirty = true;
    clearTimeout(debounce);
    if (isActive()) debounce = setTimeout(run, debounceMs);
  });
  const stopResume = onResume(run);
  const poll = setInterval(run, pollMs);
  run();
  return () => { clearTimeout(debounce); clearInterval(poll); stopResume(); stopRealtime(); };
}
