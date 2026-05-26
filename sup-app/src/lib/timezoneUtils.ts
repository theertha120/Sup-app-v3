/**
 * TIMEZONE UTILITIES
 * Helpers for timezone calculations
 */

export type TimezoneId =
  | "UTC"
  | "EST"
  | "CST"
  | "MST"
  | "PST"
  | "GMT"
  | "IST"
  | "CET"
  | "JST"
  | "AEST"
  | "NZDT";

export const TIMEZONE_OFFSETS: Record<TimezoneId, number> = {
  UTC: 0,
  GMT: 0,
  EST: -300, // UTC-5 = -300 minutes
  CST: -360, // UTC-6 = -360 minutes
  MST: -420, // UTC-7 = -420 minutes
  PST: -480, // UTC-8 = -480 minutes
  CET: 60, // UTC+1 = 60 minutes
  IST: 330, // UTC+5:30 = 330 minutes
  JST: 540, // UTC+9 = 540 minutes
  AEST: 600, // UTC+10 = 600 minutes
  NZDT: 780, // UTC+13 = 780 minutes
};

/**
 * Get device's current timezone offset in minutes
 * Returns offset from UTC (e.g., -300 for EST, 330 for IST)
 */
export function getDeviceTimezoneOffset(): number {
  const now = new Date();
  // getTimezoneOffset returns minutes WEST of UTC (negative for east)
  // We want minutes EAST of UTC (positive for east)
  return -now.getTimezoneOffset();
}

/**
 * Convert UTC time to local time with timezone offset
 * @param utcDate - Date object in UTC
 * @param offsetMinutes - Timezone offset in minutes (e.g., -300 for EST)
 * @returns Date object representing local time
 */
export function applyTimezoneOffset(
  utcDate: Date,
  offsetMinutes: number
): Date {
  return new Date(utcDate.getTime() + offsetMinutes * 60000);
}

/**
 * Get formatted HH:MM in local timezone
 */
export function getLocalTimeString(offsetMinutes: number = 0): string {
  const now = new Date();
  const localDate = applyTimezoneOffset(now, offsetMinutes);
  const hours = String(localDate.getUTCHours()).padStart(2, "0");
  const minutes = String(localDate.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
