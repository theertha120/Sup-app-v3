import type { PosturePageRow } from "../posture/postureSyncService";

export const STATS_STALE_MS = 60_000;
export type StatsWindow = { start: string; end: string };
type CachedWindow = StatsWindow & { rows: PosturePageRow[]; loadedAt: number };
export type StatsHistoryState = {
  windows: Record<string, CachedWindow>;
  earliest: string | null;
  pending: number;
  error: string | null;
  lastUpdatedAt: number | null;
};
type Source = {
  fetchWindow: (start: string, end: string) => Promise<PosturePageRow[]>;
  fetchEarliest: () => Promise<string | null>;
};
export const statsWindowKey = ({ start, end }: StatsWindow) => `${start}:${end}`;

/** Account-local cache. Failed requests never replace successful chart data. */
export class StatsHistoryStore {
  state: StatsHistoryState = { windows: {}, earliest: null, pending: 0, error: null, lastUpdatedAt: null };
  private requests = new Map<string, Promise<void>>();
  private recent = new Map<string, StatsWindow>();
  private observers = new Map<string, StatsWindow[]>();
  private earliestLoadedAt: number | null = null;
  private disposed = false;

  constructor(private source: Source, private changed: (state: StatsHistoryState) => void, private now = Date.now) {}

  activate() { this.disposed = false; }
  dispose() { this.disposed = true; }

  private update(patch: Partial<StatsHistoryState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }

  private run(key: string, work: () => Promise<void>): Promise<void> {
    const existing = this.requests.get(key);
    if (existing) return existing;
    if (this.disposed) return Promise.resolve();
    this.update({ pending: this.state.pending + 1 });
    const request = Promise.resolve().then(work).catch(() => {
      this.update({ error: "couldn’t update your stats — tap refresh to try again." });
    }).finally(() => {
      this.requests.delete(key);
      this.update({ pending: this.state.pending - 1 });
    });
    this.requests.set(key, request);
    return request;
  }

  ensureEarliest(force = false): Promise<void> {
    if (!force && this.earliestLoadedAt !== null && this.now() - this.earliestLoadedAt < STATS_STALE_MS) return Promise.resolve();
    return this.run("earliest", async () => {
      const earliest = await this.source.fetchEarliest();
      this.earliestLoadedAt = this.now();
      this.update({ earliest });
    });
  }

  ensureWindow(window: StatsWindow, force = false): Promise<void> {
    const key = statsWindowKey(window);
    this.recent.delete(key);
    this.recent.set(key, window);
    // Three independently swiped cards plus their comparison/adjacent pages.
    while (this.recent.size > 12) this.recent.delete(this.recent.keys().next().value!);
    const cached = this.state.windows[key];
    if (!force && cached && this.now() - cached.loadedAt < STATS_STALE_MS) return Promise.resolve();
    return this.run(key, async () => {
      const rows = await this.source.fetchWindow(window.start, window.end);
      const loadedAt = this.now();
      const windows = { ...this.state.windows, [key]: { ...window, rows, loadedAt } };
      // Bound memory as someone browses years of history. Keep recently viewed
      // windows so returning to a neighbouring page remains immediate.
      const oldKeys = Object.keys(windows).filter((candidate) => !this.recent.has(candidate));
      while (Object.keys(windows).length > 24 && oldKeys.length) delete windows[oldKeys.shift()!];
      this.update({ windows, lastUpdatedAt: loadedAt });
    });
  }

  observe(id: string, windows: StatsWindow[]) {
    this.observers.set(id, windows);
    return () => { this.observers.delete(id); };
  }

  async refresh(force = true) {
    this.update({ error: null });
    const active = this.observers.size
      ? Array.from(this.observers.values()).flat()
      : Array.from(this.recent.values());
    await Promise.all([this.ensureEarliest(force), ...active.map((window) => this.ensureWindow(window, force))]);
  }
}
