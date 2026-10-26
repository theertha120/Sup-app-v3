/**
 * TIMEZONE UTILITIES
 * Helpers for timezone calculations
 */

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
