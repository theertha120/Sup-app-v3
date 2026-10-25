import { leaderboardQueryKey, LEADERBOARD_PAGE_SIZE, LEADERBOARD_STALE_MS, type LeaderboardPage, type LeaderboardQuery } from "./leaderboardPageService";

export type LeaderboardView = LeaderboardPage & { isLoading: boolean; isRefreshing: boolean; isLoadingMore: boolean; error: string | null; lastUpdatedAt: number | null };
export const EMPTY_LEADERBOARD: LeaderboardView = { entries: [], ownEntry: null, total: 0, friendCount: 0, isLoading: false, isRefreshing: false, isLoadingMore: false, error: null, lastUpdatedAt: null };
type Source = (query: LeaderboardQuery, offset: number, limit: number, force: boolean) => Promise<LeaderboardPage>;

/** Each scope/period loads independently; a failed page never becomes a partial ranking. */
export class LeaderboardStore {
  private views = new Map<string, LeaderboardView>();
  private pending = new Map<string, Promise<void>>();
  private disposed = false;
  constructor(private source: Source, private changed: () => void, private now = Date.now) {}
  activate() { this.disposed = false; }
  dispose() { this.disposed = true; }
  get(query: LeaderboardQuery) { return this.views.get(leaderboardQueryKey(query)) ?? EMPTY_LEADERBOARD; }
  private update(query: LeaderboardQuery, patch: Partial<LeaderboardView>) {
    if (this.disposed) return;
    const key = leaderboardQueryKey(query);
    this.views.set(key, { ...this.get(query), ...patch });
    // At most two days of the four scope/period combinations.
    if (this.views.size > 8) {
      const oldest = [...this.views.keys()].find((candidate) => candidate !== key && !this.pending.has(candidate));
      if (oldest) this.views.delete(oldest);
    }
    this.changed();
  }

  async ensure(query: LeaderboardQuery, count: number, force = false): Promise<void> {
    const key = leaderboardQueryKey(query);
    const running = this.pending.get(key);
    if (running) {
      await running;
      if (!force && !this.get(query).error && this.get(query).lastUpdatedAt !== null) return this.ensure(query, count);
      return;
    }
    if (this.disposed) return;
    const current = this.get(query);
    const loaded = current.lastUpdatedAt !== null;
    const stale = loaded && this.now() - current.lastUpdatedAt! >= LEADERBOARD_STALE_MS;
    if (!force && !stale && loaded && current.entries.length >= Math.min(count, current.total)) return;
    const replace = force || stale || !loaded;
    const offset = replace ? 0 : current.entries.length;
    const limit = Math.max(1, Math.min(LEADERBOARD_PAGE_SIZE, replace ? count : count - offset));
    this.update(query, { isLoading: !loaded, isRefreshing: loaded && replace, isLoadingMore: loaded && !replace, error: null });
    const request = Promise.resolve().then(async () => {
      const page = await this.source(query, offset, limit, replace && loaded);
      if (page.entries.length === 0 && offset < page.total) throw new Error("Incomplete leaderboard page");
      // A changing roster can overlap an offset page. Refresh rather than showing duplicate ranks.
      const existingIds = new Set(current.entries.map((entry) => entry.user.id));
      if (!replace && page.entries.some((entry) => existingIds.has(entry.user.id))) throw new Error("Leaderboard changed; refresh to reload");
      this.update(query, { ...page, entries: replace ? page.entries : [...current.entries, ...page.entries], lastUpdatedAt: this.now() });
    }).catch(() => {
      this.update(query, { error: "couldn’t update the leaderboard — tap refresh to try again." });
    }).finally(() => {
      this.pending.delete(key);
      this.update(query, { isLoading: false, isLoadingMore: false, isRefreshing: false });
    });
    this.pending.set(key, request);
    await request;
  }

  loadMore(query: LeaderboardQuery) {
    const current = this.get(query);
    if (current.lastUpdatedAt !== null && current.entries.length >= current.total) return Promise.resolve();
    return this.ensure(query, current.entries.length + LEADERBOARD_PAGE_SIZE);
  }
}
