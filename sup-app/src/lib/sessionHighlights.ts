// End-of-session summary stats, computed on-device before s'kipper is called:
// highlights from the session's posture timeline (times in the device's local
// clock) and a metric-by-metric comparison with the previous session.

export interface PostureSegment {
  state: string;
  startMs: number;
  endMs: number;
}

export interface SessionHighlight {
  label: string;
  text: string;
}

export interface SessionComparisonMetric {
  label: string;
  current: string;
  previous: string;
  change: string;          // e.g. "+8%", "-3%", "no change"
  improved: boolean | null; // null when unchanged
}

type StateTotals = Partial<Record<string, number>>;

// A run of posture isn't broken by a deviation shorter than this.
const BLIP_MS = 30_000;
const MIN_REPORTABLE_MS = 60_000;
// "Where it slipped": first 5-min block whose good-alignment share falls
// 20+ points below the session's average up to that point.
const SLIP_BUCKET_MS = 5 * 60_000;
const SLIP_DROP_PTS = 20;

const BAD_STATES = new Set(["forward_lean", "slouched", "severe", "tilted_left", "tilted_right"]);
const SLOUCH_STATES = new Set(["slouched", "severe"]);

interface Run { cat: string; startMs: number; endMs: number }

/** Collapses the timeline into category runs, absorbing blips shorter than BLIP_MS. */
function toRuns(segments: PostureSegment[], categorize: (state: string) => string): Run[] {
  const out: Run[] = [];
  for (const s of segments) {
    const cat = categorize(s.state);
    const last = out[out.length - 1];
    if (last && last.cat === cat) last.endMs = s.endMs;
    else out.push({ cat, startMs: s.startMs, endMs: s.endMs });
  }
  const smoothed: Run[] = [];
  for (const r of out) {
    const last = smoothed[smoothed.length - 1];
    if (last && (last.cat === r.cat || r.endMs - r.startMs < BLIP_MS)) last.endMs = r.endMs;
    else smoothed.push({ ...r });
  }
  return smoothed;
}

function longest(runs: Run[], cat: string): Run | null {
  return runs
    .filter((r) => r.cat === cat)
    .reduce<Run | null>((best, r) => (!best || r.endMs - r.startMs > best.endMs - best.startMs ? r : best), null);
}

function goodShare(segments: PostureSegment[], fromMs: number, toMs: number): number {
  let good = 0;
  let total = 0;
  for (const s of segments) {
    const overlap = Math.min(s.endMs, toMs) - Math.max(s.startMs, fromMs);
    if (overlap <= 0) continue;
    total += overlap;
    if (s.state === "upright") good += overlap;
  }
  return total > 0 ? (good / total) * 100 : 0;
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtMin(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60_000))} min`;
}

export function computeSessionHighlights(segments: PostureSegment[]): SessionHighlight[] {
  if (!segments.length) return [];
  const highlights: SessionHighlight[] = [];

  const postureRuns = toRuns(segments, (s) =>
    s === "upright" ? "good" : BAD_STATES.has(s) ? "bad" : "neutral"
  );

  const streak = longest(postureRuns, "good");
  if (streak && streak.endMs - streak.startMs >= MIN_REPORTABLE_MS) {
    highlights.push({
      label: "Best streak",
      text: `${fmtMin(streak.endMs - streak.startMs)} upright, ${fmtClock(streak.startMs)}-${fmtClock(streak.endMs)}`,
    });
  }

  const slouch = longest(toRuns(segments, (s) => (SLOUCH_STATES.has(s) ? "slouch" : "other")), "slouch");
  highlights.push({
    label: "Longest slouch",
    text: slouch && slouch.endMs - slouch.startMs >= MIN_REPORTABLE_MS
      ? `${fmtMin(slouch.endMs - slouch.startMs)}, starting ${fmtClock(slouch.startMs)}`
      : "None over a minute",
  });

  const sessionStart = segments[0].startMs;
  const bucketCount = Math.floor((segments[segments.length - 1].endMs - sessionStart) / SLIP_BUCKET_MS);
  if (bucketCount >= 2) {
    const shares = Array.from({ length: bucketCount }, (_, i) =>
      goodShare(segments, sessionStart + i * SLIP_BUCKET_MS, sessionStart + (i + 1) * SLIP_BUCKET_MS)
    );
    let slipMin: number | null = null;
    for (let i = 1; i < shares.length; i++) {
      const before = shares.slice(0, i).reduce((a, b) => a + b, 0) / i;
      const dropped = (j: number) => j >= shares.length || shares[j] <= before - SLIP_DROP_PTS;
      if (before >= 50 && dropped(i) && dropped(i + 1)) {
        slipMin = (i * SLIP_BUCKET_MS) / 60_000;
        break;
      }
    }
    highlights.push({
      label: "Where it slipped",
      text: slipMin !== null ? `Posture dropped after ${slipMin} min` : "It didn't, posture held steady",
    });
  }

  // A correction is a return to good alignment after a sustained bad stretch.
  let corrections = 0;
  let hadBad = false;
  let lastCat: string | null = null;
  for (const r of postureRuns) {
    if (r.cat === "neutral") continue;
    if (r.cat === "bad") hadBad = true;
    if (r.cat === "good" && lastCat === "bad") corrections++;
    lastCat = r.cat;
  }
  highlights.push({
    label: "Corrections",
    text: corrections > 0
      ? `You fixed your posture ${corrections} time${corrections === 1 ? "" : "s"}`
      : hadBad ? "None yet, try resetting as soon as you notice a slouch" : "None needed",
  });

  return highlights;
}

function sharePct(totals: StateTotals, states: string[]): number {
  const total = Object.values(totals).reduce<number>((s, v) => s + (v ?? 0), 0);
  const part = states.reduce((s, k) => s + (totals[k] ?? 0), 0);
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function signed(n: number): string {
  return n === 0 ? "no change" : `${n > 0 ? "+" : ""}${n}%`;
}

const SHARE_METRICS: { label: string; states: string[]; higherIsBetter: boolean }[] = [
  { label: "Good alignment", states: ["upright"],                     higherIsBetter: true },
  { label: "Forward lean",   states: ["forward_lean"],                higherIsBetter: false },
  { label: "Slouching",      states: ["slouched", "severe"],          higherIsBetter: false },
  { label: "Tilting",        states: ["tilted_left", "tilted_right"], higherIsBetter: false },
];

/**
 * Current vs previous session. Session length shows % change; posture shares
 * show the difference in share of session time (percentage points).
 */
export function compareSessions(
  current: { durationMs: number; stateTotals: StateTotals },
  previous: { durationMs: number; stateTotals: StateTotals },
): SessionComparisonMetric[] {
  const lengthChange = previous.durationMs > 0
    ? Math.round(((current.durationMs - previous.durationMs) / previous.durationMs) * 100)
    : 0;

  return [
    {
      label: "Session length",
      current: fmtMin(current.durationMs),
      previous: fmtMin(previous.durationMs),
      change: signed(lengthChange),
      improved: lengthChange === 0 ? null : lengthChange > 0,
    },
    ...SHARE_METRICS.map((m) => {
      const cur = sharePct(current.stateTotals, m.states);
      const prev = sharePct(previous.stateTotals, m.states);
      const diff = cur - prev;
      return {
        label: m.label,
        current: `${cur}%`,
        previous: `${prev}%`,
        change: signed(diff),
        improved: diff === 0 ? null : (diff > 0) === m.higherIsBetter,
      };
    }),
  ];
}
