/**
 * Timezone helper utilities
 */
export function getDeviceTimezoneOffset(): number {
  // JS getTimezoneOffset returns minutes difference UTC - local (positive for zones west of UTC)
  // We want offset in minutes where positive = east of UTC, negative = west
  return -new Date().getTimezoneOffset();
}

export function applyTimezoneOffset(utcDate: Date | string, offsetMinutes: number): Date {
  const d = typeof utcDate === "string" ? new Date(utcDate) : new Date(utcDate.getTime());
  return new Date(d.getTime() + offsetMinutes * 60000);
}

export function getLocalTimeString(offsetMinutes: number): string {
  const local = applyTimezoneOffset(new Date(), offsetMinutes);
  const hours = String(local.getUTCHours()).padStart(2, "0");
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
