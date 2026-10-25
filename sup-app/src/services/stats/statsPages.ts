import type { PosturePageRow, StateTotals } from "../posture/postureSyncService";
import { toLocalDateKey } from "../../lib/dateKey";

export type StatsRange = "week" | "month" | "year";

export function statsPageWindow(range: StatsRange, index: number, now: Date) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const end = range === "week"
    ? new Date(year, month, now.getDate() - index * 7)
    : range === "month" ? new Date(year, month - index + 1, 0) : new Date(year - index, 11, 31);
  const start = range === "week"
    ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)
    : range === "month" ? new Date(year, month - index, 1) : new Date(year - index, 0, 1);
  return { start: toLocalDateKey(start), end: toLocalDateKey(end) };
}

export function statsPageCount(earliest: string | null, range: StatsRange, now: Date) {
  if (!earliest) return 1;
  const [year, month, day] = earliest.split("-").map(Number);
  if (range === "week") {
    // Count calendar days, independent of daylight-saving clock changes.
    const days = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(year, month - 1, day)) / 86400000;
    return Math.max(1, Math.floor(days / 7) + 1);
  }
  if (range === "month") return Math.max(1, (now.getFullYear() - year) * 12 + now.getMonth() - month + 2);
  return Math.max(1, now.getFullYear() - year + 1);
}

export interface PageData {
  isLoading?: boolean;
  labels:      string[];
  scores:      number[];
  sessionMins: number[];
  hasData:     boolean[];
  stateTotals: Record<string, number>;
  startDate:   string;
  endDate:     string;
  pointDates:  string[];
}

function fmt(d: Date) {
  const M = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  return `${d.getDate()} ${M[d.getMonth()]}`;
}

function fmtFull(d: Date) {
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

// Phone-local YYYY-MM-DD — must match how posture_daily.date is written.
const toDateKey = (d: Date): string => toLocalDateKey(d);

type FullStateTotals = Required<Omit<StateTotals, "transition">>;

function emptyStateTotals(): FullStateTotals {
  return {
    upright: 0,
    forward_lean: 0,
    slouched: 0,
    severe: 0,
    tilted_left: 0,
    tilted_right: 0,
  };
}

function accumulateStateTotals(target: FullStateTotals, row: PosturePageRow | undefined) {
  if (!row) return;
  const totals = row.stateTotals;
  if (!totals) return;
  for (const key of Object.keys(target) as (keyof FullStateTotals)[]) {
    target[key] += totals[key] ?? 0; // transition, if present on totals, is never iterated
  }
}

function avgOf(values: number[]): number {
  const valid = values.filter((v) => !isNaN(v));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, v) => sum + v, 0) / valid.length);
}

function sessionMinsOf(row: PosturePageRow | undefined): number {
  if (!row) return 0;
  if (row.totalDeskMs != null) return row.totalDeskMs / 60000;
  return row.totalMinutes ?? 0;
}

// Aggregate only the requested page; callers share its result between charts.
export function buildStatsPage(history: PosturePageRow[], range: StatsRange, p: number, now: Date): PageData {

  // Rows arrive sorted by date, so a filtered slice keeps that order — matching
  // what the old per-page query returned.
  const sliceRows = (startKey: string, endKey: string) =>
    history.filter((r) => r.date >= startKey && r.date <= endKey);
  const rowByDate = new Map(history.map((r) => [r.date, r]));

  const stateTotals: FullStateTotals = emptyStateTotals();
  if (range === "week") {
    // Calendar-day steps (setDate) rather than fixed 24h ms steps, so a
    // daylight-saving change can't shift a bar onto the wrong day.
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - p * 7);
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);

    const days = Array.from({ length: 7 }, (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const dayKeys = days.map(toDateKey);
    const dayRows = dayKeys.map((k) => rowByDate.get(k));

    dayRows.forEach((r) => accumulateStateTotals(stateTotals, r));

    return {
      labels:      days.map((d) => ["sun","mon","tue","wed","thu","fri","sat"][d.getDay()]),
      scores:      dayRows.map((r) => r?.supScore ?? 0),
      sessionMins: dayRows.map((r) => sessionMinsOf(r)),
      hasData:     dayRows.map((r) => r !== undefined),
      stateTotals,
      startDate:   fmt(start),
      endDate:     fmt(end),
      pointDates:  days.map((d) => fmtFull(d)),
    };

  } else if (range === "month") {
    const ref   = new Date(now.getFullYear(), now.getMonth() - p, 1);
    const year  = ref.getFullYear();
    const month = ref.getMonth();
    const start = new Date(year, month, 1);
    const end   = new Date(year, month + 1, 0);
    const startKey = toDateKey(start);
    const endKey   = toDateKey(end);

    const rows = sliceRows(startKey, endKey);
    rows.forEach((r) => accumulateStateTotals(stateTotals, r));

    // 4 weekly buckets: 1-7, 8-14, 15-21, 22-end
    const weekBounds = [
      [1, 7], [8, 14], [15, 21], [22, end.getDate()],
    ];
    const weekly = weekBounds.map(([dStart, dEnd]) => {
      const bucketRows = rows.filter((r) => {
        const day = new Date(`${r.date}T00:00:00.000Z`).getUTCDate();
        return day >= dStart && day <= dEnd;
      });
      return {
        score:       avgOf(bucketRows.map((r) => r.supScore ?? NaN)),
        sessionMins: bucketRows.reduce((sum, r) => sum + sessionMinsOf(r), 0),
        hasData:     bucketRows.length > 0,
      };
    });

    const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return {
      labels:      ["wk 1","wk 2","wk 3","wk 4"],
      scores:      weekly.map((w) => w.score),
      sessionMins: weekly.map((w) => w.sessionMins),
      hasData:     weekly.map((w) => w.hasData),
      stateTotals,
      startDate:   fmt(start),
      endDate:     fmt(end),
      pointDates:  [
        `1–7 ${M[month]} ${year}`,
        `8–14 ${M[month]} ${year}`,
        `15–21 ${M[month]} ${year}`,
        `22–${end.getDate()} ${M[month]} ${year}`,
      ],
    };

  } else {
    const yr = now.getFullYear() - p;
    const start = new Date(yr, 0, 1);
    const end   = new Date(yr, 11, 31);
    const startKey = toDateKey(start);
    const endKey   = toDateKey(end);

    const rows = sliceRows(startKey, endKey);
    rows.forEach((r) => accumulateStateTotals(stateTotals, r));

    const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const monthly = Array.from({ length: 12 }, (_, m) => {
      const bucketRows = rows.filter((r) => {
        const month = new Date(`${r.date}T00:00:00.000Z`).getUTCMonth();
        return month === m;
      });
      return {
        score:       avgOf(bucketRows.map((r) => r.supScore ?? NaN)),
        sessionMins: bucketRows.reduce((sum, r) => sum + sessionMinsOf(r), 0),
        hasData:     bucketRows.length > 0,
      };
    });

    return {
      labels:      ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"],
      scores:      monthly.map((m) => m.score),
      sessionMins: monthly.map((m) => m.sessionMins),
      hasData:     monthly.map((m) => m.hasData),
      stateTotals,
      startDate:   `1 jan ${yr}`,
      endDate:     `31 dec ${yr}`,
      pointDates:  M.map((m) => `${m} ${yr}`),
    };
  }
}

