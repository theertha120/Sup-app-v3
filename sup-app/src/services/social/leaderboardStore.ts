import { LEADERBOARD_PAGE_SIZE, leaderboardKey, type LeaderboardPage, type LeaderboardQuery } from "./leaderboardData";

export type LeaderboardView = LeaderboardPage & {
  pending: boolean; error: string | null; updatedAt: number | null;
};
export const EMPTY_BOARD: LeaderboardView = { entries: [], ownEntry: null, total: 0, friendCount: 0, pending: false, error: null, updatedAt: null };
export type LeaderboardSource = (query: LeaderboardQuery, offset: number, limit: number, force: boolean, signal: AbortSignal) => Promise<LeaderboardPage>;

/** One account owns this cache. Screens share requests and retain good data on failure. */
export class LeaderboardStore {
  private views = new Map<string, LeaderboardView>();
  private requests = new Map<string, Promise<void>>();
  private active = true;
  constructor(private source: LeaderboardSource, private changed: () => void, private now = Date.now, private options: { timeoutMs?: number; reportError?: (error: unknown) => void } = {}) {}
  activate() { this.active = true; }
  dispose() { this.active = false; }
  get(query: LeaderboardQuery) { return this.views.get(leaderboardKey(query)) ?? EMPTY_BOARD; }
  private update(query: LeaderboardQuery, patch: Partial<LeaderboardView>) {
    if (!this.active) return;
    const key = leaderboardKey(query);
    this.views.set(key, { ...this.get(query), ...patch });
    if (this.views.size > 8) {
      const oldest = [...this.views.keys()].find((candidate) => candidate !== key && !this.requests.has(candidate));
      if (oldest) this.views.delete(oldest);
    }
    this.changed();
  }
  async ensure(query: LeaderboardQuery, count: number, force = false): Promise<void> {
    const key = leaderboardKey(query);
    const pending = this.requests.get(key);
    if (pending) {
      await pending;
      if (!force && !this.get(query).error && this.get(query).updatedAt !== null) await this.ensure(query, count);
      return;
    }
    if (!this.active) return;
    const current = this.get(query);
    const replace = force || current.updatedAt === null;
    if (!replace && current.entries.length >= Math.min(count, current.total)) return;
    const offset = replace ? 0 : current.entries.length;
    const limit = Math.max(1, Math.min(LEADERBOARD_PAGE_SIZE, replace ? count : count - offset));
    this.update(query, { pending: true, error: null });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Leaderboard request timed out")); }, this.options.timeoutMs ?? 15_000);
    });
    const operation = Promise.resolve().then(async () => {
      const page = await this.source(query, offset, limit, force, controller.signal);
      if (controller.signal.aborted) return;
      if (!page.entries.length && offset < page.total) throw new Error("Incomplete leaderboard page");
      const existing = new Set(replace ? [] : current.entries.map((entry) => entry.user.id));
      for (const entry of page.entries) {
        if (existing.has(entry.user.id)) throw new Error("Ranking changed; refresh to reload");
        existing.add(entry.user.id);
      }
      this.update(query, { ...page, entries: replace ? page.entries : [...current.entries, ...page.entries], updatedAt: this.now() });
    });
    const request = Promise.race([operation, deadline]).catch((error) => {
      this.update(query, { error: "couldn’t update the leaderboard — tap refresh to try again." });
      try { this.options.reportError?.(error); } catch { /* Reporting must not block recovery. */ }
    }).finally(() => { clearTimeout(timer); this.requests.delete(key); this.update(query, { pending: false }); });
    this.requests.set(key, request);
    await request;
  }
  more(query: LeaderboardQuery) {
    const view = this.get(query);
    return this.ensure(query, view.entries.length + LEADERBOARD_PAGE_SIZE);
  }
}
