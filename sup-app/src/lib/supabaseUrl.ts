// createClient needs the project URL, not the dashboard's REST endpoint.
export function normalizeSupabaseUrl(value: string): string {
  return value.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}
