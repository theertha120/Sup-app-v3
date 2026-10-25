// Session time label shared by the daily and stats screens: "45min", "1h 5min".
export function formatSessionMins(totalMins: number): string {
  const mins = Math.round(totalMins);
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return h > 0 ? `${h}h ${r}min` : `${r}min`;
}
