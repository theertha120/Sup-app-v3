/**
 * dateKey.ts
 *
 * The single source of truth for "which calendar day is it" across the app.
 * Every date key is a YYYY-MM-DD string in the PHONE's own timezone — the
 * same day the user sees on their lock screen. Date's local getters
 * (getFullYear/getMonth/getDate) already use the device timezone, so no
 * timezone lookup is needed here.
 *
 * Don't use toISOString().slice(0, 10) for a calendar day — that gives the
 * UTC date, which is "yesterday" for the first hours of the day east of UTC.
 */

/** YYYY-MM-DD for the given moment (default: now) in the phone's timezone. */
export function toLocalDateKey(d: Date = new Date()): string {
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day   = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses a YYYY-MM-DD key as local midnight of that day. */
export function fromLocalDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Shifts a YYYY-MM-DD key by a whole number of calendar days (negative = back). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const d = fromLocalDateKey(dateKey);
  d.setDate(d.getDate() + days);
  return toLocalDateKey(d);
}

/**
 * The [start, end) instants of a local calendar day — for querying
 * timestamp columns (e.g. posture_sessions.started_at) that belong to it.
 */
export function localDayRange(dateKey: string): { start: Date; end: Date } {
  const start = fromLocalDateKey(dateKey);
  const end   = fromLocalDateKey(addDaysToDateKey(dateKey, 1));
  return { start, end };
}
