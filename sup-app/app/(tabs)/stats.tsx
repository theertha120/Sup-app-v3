import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Dimensions,
  PanResponder,
  Modal,
} from "react-native";
import { BlurView } from "expo-blur";
import Svg, { Polyline, Circle, Text as SvgText } from "react-native-svg";
import { useFonts } from "expo-font";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BackgroundBlobs from "./backgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";

// ─── Constants ───────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get("window");
const PRIMARY_TEXT = "#1D014A";
const CARD_W = SCREEN_W - 40;

const NAV_BAR_HEIGHT = 72;
const NAV_BOTTOM_OFFSET = 25;

const SEGMENT_COLORS: Record<string, string> = {
  upright:      "#6DC96D",
  forward_lean: "#FFD600",
  slouched:     "#F5A623",
  severe:       "#EC555E",
  tilted_left:  "#F5A623",
  tilted_right: "#F5A623",
};

const SEGMENT_LABELS: Record<string, string> = {
  upright:      "Upright",
  forward_lean: "Forward Lean",
  slouched:     "Slouched",
  severe:       "Severe",
  tilted_left:  "Tilted Left",
  tilted_right: "Tilted Right",
};

// Static hourly posture quality. 0 = no session that hour.
const HOURLY_POSTURE: Record<string, number> = {
  "00:00": 0,  "01:00": 0,  "02:00": 0,  "03:00": 0,
  "04:00": 0,  "05:00": 0,  "06:00": 0,  "07:00": 48,
  "08:00": 72, "09:00": 81, "10:00": 79, "11:00": 85,
  "12:00": 60, "13:00": 55, "14:00": 50, "15:00": 44,
  "16:00": 38, "17:00": 42, "18:00": 30, "19:00": 0,
  "20:00": 0,  "21:00": 0,  "22:00": 0,  "23:00": 0,
};

type Range = "week" | "month" | "year";

// ─── Popup types ──────────────────────────────────────────────────────────────
// x/y are ABSOLUTE SCREEN coordinates (from `measureInWindow`), not coordinates
// local to a chart — the popup is rendered in a top-level Modal (see
// `StatsScreen`), so it needs the same coordinate space the Modal renders in.

interface PopupInfo {
  x: number;
  y: number;
  value: number;
  unit: string;
  dateRange: string;
  avgLabel: string;
}

// Which chart/card currently owns the (single, screen-wide) open popup, and
// which item within it (bar index, cell index, or breakdown segment key) is
// highlighted. Only one popup can be open at a time across the whole screen.
interface ActivePopup {
  chartId: string;
  index: number | string;
  info: PopupInfo;
}

// ─── Data generation ──────────────────────────────────────────────────────────

function seed(i: number, base: number, spread: number, offset = 0) {
  return Math.max(20, Math.min(98, Math.round(base + Math.sin(i * 1.3 + offset) * spread)));
}

export interface PageData {
  labels:      string[];
  scores:      number[];
  sessionMins: number[];
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

// ─── Page count — replace body with real Supabase query ───────────────────────
// Returns how many historical pages exist for this range. No cap — the user
// can swipe all the way back to the first ever recorded session.
function getAvailablePageCount(range: Range): number {
  // TODO: replace with real query:
  //   const { data } = await supabase
  //     .from('sessions')
  //     .select('created_at')
  //     .order('created_at', { ascending: true })
  //     .limit(1)
  //   const dataStart = new Date(data[0].created_at)
  const now       = new Date(2026, 7, 2);
  const dataStart = new Date(2026, 0, 1); // Jan 1 2026 — adjust to real earliest record

  if (range === "week") {
    const msPerWeek = 7 * 86_400_000;
    // No cap — pages go back to dataStart
    return Math.max(1, Math.ceil((now.getTime() - dataStart.getTime()) / msPerWeek));
  } else if (range === "month") {
    const monthDiff =
      (now.getFullYear() - dataStart.getFullYear()) * 12 +
      (now.getMonth() - dataStart.getMonth());
    return Math.max(1, monthDiff + 1);
  } else {
    const yearDiff = now.getFullYear() - dataStart.getFullYear();
    return Math.max(1, yearDiff + 1);
  }
}

function generatePages(range: Range): PageData[] {
  const now    = new Date(2026, 7, 2);
  const MS_DAY = 86_400_000;
  const PAGES  = getAvailablePageCount(range);

  return Array.from({ length: PAGES }, (_, p) => {
    const stateTotalsBase = {
      upright:      Math.max(30, 58 - p * 4),
      forward_lean: 13 + p,
      slouched:     12 + p * 2,
      severe:       7  + p,
      tilted_left:  5,
      tilted_right: 5,
    };

    if (range === "week") {
      const end   = new Date(now.getTime() - p * 7 * MS_DAY);
      const start = new Date(end.getTime() - 6 * MS_DAY);
      const days  = Array.from({ length: 7 }, (_, i) =>
        fmtFull(new Date(start.getTime() + i * MS_DAY))
      );
      return {
        labels:      ["mon","tue","wed","thu","fri","sat","sun"],
        scores:      Array.from({ length: 7 },  (_, i) => seed(i + p * 7,  70, 18, p)),
        sessionMins: Array.from({ length: 7 },  (_, i) => seed(i + p * 7, 130, 65, p)),
        stateTotals: stateTotalsBase,
        startDate:   fmt(start),
        endDate:     fmt(end),
        pointDates:  days,
      };
    } else if (range === "month") {
      const ref   = new Date(now);
      ref.setMonth(ref.getMonth() - p);
      const year  = ref.getFullYear();
      const month = ref.getMonth();
      const start = new Date(year, month, 1);
      const end   = new Date(year, month + 1, 0);
      const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return {
        labels:      ["wk 1","wk 2","wk 3","wk 4"],
        scores:      Array.from({ length: 4 },  (_, i) => seed(i + p * 4,  72, 12, p)),
        sessionMins: Array.from({ length: 4 },  (_, i) => seed(i + p * 4, 150, 50, p)),
        stateTotals: stateTotalsBase,
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
      const M  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return {
        labels:      ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"],
        scores:      Array.from({ length: 12 }, (_, i) => seed(i + p * 12, 70, 14, p)),
        sessionMins: Array.from({ length: 12 }, (_, i) => seed(i + p * 12, 140, 55, p)),
        stateTotals: stateTotalsBase,
        startDate:   `1 jan ${yr}`,
        endDate:     `31 dec ${yr}`,
        pointDates:  M.map((m) => `${m} ${yr}`),
      };
    }
  });
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 75) return "#6DC96D";
  if (s >= 55) return "#FFD600";
  if (s >= 40) return "#F5A623";
  return "#EC555E";
}

function heatColor(score: number) {
  if (score === 0)   return "rgba(63,36,131,0.07)";
  if (score >= 75)   return "#6DC96D";
  if (score >= 55)   return "#C3E87C";
  if (score >= 40)   return "#FFD600";
  if (score >= 25)   return "#F5A623";
  return "#EC555E";
}

// ─── Data point popup ─────────────────────────────────────────────────────────
// The popup bubble is rendered exactly once, at the StatsScreen level, inside
// a react-native `Modal`. A Modal renders in its own native layer above the
// *entire* app UI (including the floating nav bar and everything in the
// ScrollView), so a single full-screen backdrop Pressable behind the bubble
// dismisses it no matter what's tapped — another card, the range selector,
// the header, or the nav bar — while the bubble's own Pressable stops
// propagation so tapping the bubble itself doesn't dismiss it.
//
// Charts report the bubble's anchor point in ABSOLUTE SCREEN coordinates
// (via `measureInWindow` on the pressed bar/cell/segment) rather than
// chart-local coordinates, since the Modal's coordinate space starts at the
// screen origin, not the scrolled card's origin.

const POPUP_H = 76;
const POPUP_W = 152;
const LINE_H  = 24;

const popupStyles = StyleSheet.create({
  bubble: {
    position: "absolute",
    width: POPUP_W,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.13,
    shadowRadius: 12,
    elevation: 10,
    gap: 2,
  },
  dateText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 10,
    color: "rgba(29,1,74,0.45)",
  },
  valueText: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 20,
    color: PRIMARY_TEXT,
    lineHeight: 24,
  },
  unitText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: "rgba(29,1,74,0.55)",
  },
  avgText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 10,
    color: "rgba(29,1,74,0.4)",
  },
  // Straight white vertical connector
  line: {
    position: "absolute",
    bottom: -LINE_H,
    width: 1.5,
    height: LINE_H,
    backgroundColor: "#FFFFFF",
  },
});

// ─── LiquidGlass range selector ──────────────────────────────────────────────

function RangeSelector({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const RANGES: Range[] = ["week", "month", "year"];
  const TAB_W   = (SCREEN_W - 40 - 8) / 3;
  const bubbleX = useRef(new Animated.Value(0)).current;

  const handlePress = (r: Range) => {
    const idx = RANGES.indexOf(r);
    Animated.spring(bubbleX, {
      toValue: idx * TAB_W + (TAB_W / 2 - 30),
      damping: 15, stiffness: 140, useNativeDriver: true,
    }).start();
    onChange(r);
  };

  return (
    <View style={rangeStyles.wrapper}>
      <BlurView intensity={100} tint="light" style={rangeStyles.container}>
        <View style={rangeStyles.shine} />
        <View style={rangeStyles.shineBottom} />
        <Animated.View style={[rangeStyles.activeBubble, { transform: [{ translateX: bubbleX }] }]} />
        {RANGES.map((r) => (
          <Pressable key={r} style={rangeStyles.tab} onPress={() => handlePress(r)}>
            <Text style={[rangeStyles.label, r === range && rangeStyles.labelActive]}>{r}</Text>
          </Pressable>
        ))}
      </BlurView>
    </View>
  );
}

const rangeStyles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 20, marginBottom: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 6,
  },
  container: {
    height: 52, borderRadius: 26, overflow: "hidden",
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.65)",
  },
  shine: {
    position: "absolute", top: 0, left: 0, right: 0, height: 22,
    backgroundColor: "rgba(255,255,255,0.35)",
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
  },
  shineBottom: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  activeBubble: {
    position: "absolute", width: 60, height: 40, borderRadius: 20, top: 6,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#fff", shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
  },
  tab: { flex: 1, height: "100%", justifyContent: "center", alignItems: "center" },
  label: { fontFamily: "Agrandir-GrandHeavy", fontSize: 14, color: PRIMARY_TEXT, opacity: 0.5 },
  labelActive: { opacity: 1 },
});

// ─── Swipeable card ───────────────────────────────────────────────────────────
// No upper cap on pages — the user can swipe all the way to the first ever
// recorded period. Dots are replaced with a simple "X / N" counter when there
// are many pages to avoid a dot overflow.

function SwipeCard({
  pages,
  renderPage,
  resetKey,
  onPageChange,
}: {
  pages:      PageData[];
  renderPage: (page: PageData, prevPage: PageData | null) => React.ReactNode;
  resetKey:   string;
  /** Called whenever the visible page changes — used to dismiss any open popup, since it'd be anchored to now-stale data/position. */
  onPageChange?: () => void;
}) {
  const [pageIdx, setPageIdx] = useState(0);
  const prevResetKey = useRef(resetKey);
  if (prevResetKey.current !== resetKey) {
    prevResetKey.current = resetKey;
    Promise.resolve().then(() => setPageIdx(0));
  }

  // Bug fix: `PanResponder.create(...)` is only ever evaluated once, on the
  // first render, because it's wrapped in `useRef(...)`.current — React
  // re-runs the *expression* on every render but ignores the result after
  // mount. That means `onPanResponderRelease` closed over whatever `pages`
  // array existed at mount time forever. If the screen first mounted on
  // "week" (many pages) and the user later switched to "month" (fewer
  // pages), swipes still clamped against the stale week-length page count,
  // so pageIdx could climb past the *current* pages.length (e.g. to 9, 10…
  // for an 8-page month). `pages[pageIdx]` for those out-of-range indices is
  // undefined, so `currentPage` fell back to `pages[0]` via `??` below —
  // matching the exact symptom: counter reads "9 / 8", "10 / 8", but the
  // card shows page 1's data. Mirroring `pages` into a ref that's updated on
  // every render lets the stable PanResponder always clamp against the
  // *current* page count.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder:  (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        const maxIdx = pagesRef.current.length - 1;
        if (g.dx < -40) setPageIdx((p) => Math.min(p + 1, maxIdx));
        else if (g.dx > 40) setPageIdx((p) => Math.max(p - 1, 0));
      },
    })
  ).current;

  useEffect(() => {
    onPageChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdx]);

  const currentPage = pages[pageIdx] ?? pages[0];
  const prevPage    = pages[pageIdx + 1] ?? null;
  // Extra guard against the one-render gap between a resetKey change and the
  // deferred setPageIdx(0) above actually landing (e.g. switching from a
  // long range straight to a short one) — keeps the counter's numerator from
  // ever reading ahead of the *current* pages array too.
  const displayIdx  = Math.min(pageIdx, pages.length - 1);

  return (
    <View>
      <Text style={swipeStyles.dateRange}>
        {currentPage.startDate} – {currentPage.endDate}
      </Text>
      <Animated.View {...panResponder.panHandlers}>
        {renderPage(currentPage, prevPage)}
      </Animated.View>

      {pages.length > 1 && (
        <>
          <Text style={swipeStyles.counter}>
            {displayIdx + 1} / {pages.length}
          </Text>
          <Text style={swipeStyles.hint}>swipe left for older data</Text>
        </>
      )}
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  dateRange: {
    fontFamily: "Agrandir-Regular", fontSize: 10,
    color: "rgba(29,1,74,0.38)", marginBottom: 4,
  },
  counter: {
    textAlign: "center", fontSize: 10, marginTop: 10,
    color: "rgba(29,1,74,0.45)", fontFamily: "Agrandir-Regular",
  },
  hint: {
    textAlign: "center", fontSize: 10, color: "rgba(29,1,74,0.32)",
    marginTop: 4, fontFamily: "Agrandir-Regular",
  },
});

// ─── Shared helpers ───────────────────────────────────────────────────────────

function avg(arr: number[]) {
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function avgLabel(range: Range): string {
  if (range === "week")  return "Daily avg";
  if (range === "month") return "Weekly avg";
  return "Monthly avg";
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function fmtMins(m: number) {
  const h = Math.floor(m / 60); const r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
}
function fmtMinsLong(m: number) {
  const h = Math.floor(m / 60); const r = m % 60;
  return h > 0 ? `${h}h ${r} min` : `${r} min`;
}

function BarChart({
  data, prevData, range, type, activeIndex, onOpenPopup, onClosePopup,
}: {
  data: PageData;
  prevData: PageData | null;
  range: Range;
  type: string;
  /** Index of the bar this chart's popup is currently open for, or null. Owned by StatsScreen. */
  activeIndex: number | null;
  onOpenPopup: (index: number, info: PopupInfo) => void;
  onClosePopup: () => void;
}) {
  const maxBarH = 72;
  const barRefs = useRef<(View | null)[]>([]);

  const values = type === "session" ? data.sessionMins : data.scores;
  const maxV   = Math.max(...values, 1);
  const n      = values.length;
  const curAvgMins = Math.round(values.reduce((a, b) => a + b, 0) / n);

  let prevAvgMins: number | null = null;
  if (prevData) {
    const prevValues = type === "session" ? prevData.sessionMins : prevData.scores;
    prevAvgMins = Math.round(prevValues.reduce((a, b) => a + b, 0) / prevValues.length);
  }

  const chartW   = CARD_W - 36;
  const diffMins = prevAvgMins !== null ? curAvgMins - prevAvgMins : null;

  const handleBarPress = (i: number) => {
    if (activeIndex === i) { onClosePopup(); return; }
    barRefs.current[i]?.measureInWindow((x, y, width) => {
      onOpenPopup(i, {
        x: x + width / 2,
        y,
        value: values[i], unit: "min",
        dateRange: data.pointDates[i] ?? data.labels[i],
        avgLabel:  avgLabel(range),
      });
    });
  };

  return (
    <View>
      <View style={barStyles.statRow}>
        <Text style={barStyles.statText}>avg {fmtMinsLong(curAvgMins)}</Text>
        {diffMins !== null && (
          <Text style={[barStyles.statText, { color: diffMins >= 0 ? "#6DC96D" : "#EC555E" }]}>
            {"  "}{diffMins >= 0 ? "↑" : "↓"} {fmtMins(Math.abs(diffMins))}
          </Text>
        )}
      </View>

      <View style={[barStyles.container, { width: chartW }]}>
        {values.map((v, i) => {
          const barH     = Math.max(3, Math.round((v / maxV) * maxBarH));
          const isActive = activeIndex === i;
          return (
            <Pressable
              key={i}
              ref={(el) => { barRefs.current[i] = el; }}
              style={barStyles.col}
              onPress={() => handleBarPress(i)}
            >
              <View style={[
                barStyles.bar,
                { height: barH, backgroundColor: isActive ? scoreColor(v) : "#6DC96D", opacity: isActive ? 1 : 0.85 },
              ]} />
              <Text style={barStyles.label}>{data.labels[i]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const barStyles = StyleSheet.create({
  statRow:   { flexDirection: "row", justifyContent: "flex-end", alignItems: "baseline", marginBottom: 4 },
  statText:  { fontFamily: "Agrandir-Regular", fontSize: 11, color: "rgba(29,1,74,0.55)" },
  container: { flexDirection: "row", alignItems: "flex-end", height: 88, gap: 3 },
  col:       { flex: 1, alignItems: "center", gap: 3 },
  bar:       { width: "100%", borderRadius: 3, backgroundColor: "#6DC96D" },
  label:     { fontSize: 8, color: "rgba(29,1,74,0.5)", fontWeight: "600" },
});

// ─── Posture heatmap ──────────────────────────────────────────────────────────

function PostureHeatmap({
  hourlyData, range, activeIndex, onOpenPopup, onClosePopup,
}: {
  hourlyData: Record<string, number>;
  range: Range;
  activeIndex: number | null;
  onOpenPopup: (index: number, info: PopupInfo) => void;
  onClosePopup: () => void;
}) {
  const hours = Object.keys(hourlyData);
  const vals  = Object.values(hourlyData);
  const active   = vals.filter((v) => v > 0);
  const allZero  = active.length === 0;
  const worstVal = allZero ? 0 : Math.min(...active);
  const worstHr  = allZero ? "" : hours[vals.indexOf(worstVal)];
  const insight  = allZero
    ? "no posture data recorded — start a session to see patterns."
    : `your posture holds well in the morning, then dips around ${worstHr} through the afternoon.`;

  const labelHours = ["9am","11am","1pm","3pm","5pm","7pm"];
  const chartW     = CARD_W - 36;
  const cellRefs   = useRef<(View | null)[]>([]);

  const handleCellPress = (i: number) => {
    if (vals[i] === 0) return; // no data for this hour
    if (activeIndex === i) { onClosePopup(); return; }
    cellRefs.current[i]?.measureInWindow((x, y, width) => {
      onOpenPopup(i, {
        x: x + width / 2,
        y,
        value: vals[i], unit: "score",
        dateRange: hours[i],
        avgLabel: avgLabel(range),
      });
    });
  };

  return (
    <View>
      <View style={[heatStyles.row, { width: chartW }]}>
        {hours.map((h, i) => (
          <Pressable
            key={h}
            ref={(el) => { cellRefs.current[i] = el; }}
            style={[heatStyles.cell, { backgroundColor: heatColor(vals[i]) }]}
            onPress={() => handleCellPress(i)}
          />
        ))}
      </View>
      <View style={heatStyles.labelsRow}>
        {labelHours.map((l) => <Text key={l} style={heatStyles.label}>{l}</Text>)}
      </View>
      <Text style={heatStyles.insight}>{insight}</Text>
    </View>
  );
}

const heatStyles = StyleSheet.create({
  row:       { flexDirection: "row", gap: 2 },
  cell:      { flex: 1, height: 26, borderRadius: 4 },
  labelsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  label:     { fontSize: 9, color: "rgba(29,1,74,0.45)", fontWeight: "600" },
  insight:   { fontFamily: "Agrandir-Regular", fontSize: 11, color: PRIMARY_TEXT, lineHeight: 17, marginTop: 8, opacity: 0.8 },
});

// ─── Posture breakdown ────────────────────────────────────────────────────────

function PostureBreakdown({
  stateTotals, range, activeKey, onOpenPopup, onClosePopup,
}: {
  stateTotals: Record<string, number>;
  range: Range;
  activeKey: string | null;
  onOpenPopup: (key: string, info: PopupInfo) => void;
  onClosePopup: () => void;
}) {
  const keys  = Object.keys(stateTotals);
  const total = keys.reduce((s, k) => s + stateTotals[k], 0) || 1;
  const pcts  = Object.fromEntries(keys.map((k) => [k, (stateTotals[k] / total) * 100]));
  for (const k of keys) if (isNaN(pcts[k])) pcts[k] = 0;

  const chartW  = CARD_W - 36;
  const segRefs = useRef<Record<string, View | null>>({});
  const rowRefs = useRef<Record<string, View | null>>({});

  const openFrom = (k: string, refs: React.RefObject<Record<string, View | null>>) => {
    if (pcts[k] === 0) return;
    if (activeKey === k) { onClosePopup(); return; }
    refs.current[k]?.measureInWindow((x, y, width) => {
      onOpenPopup(k, {
        x: x + width / 2,
        y,
        value: Math.round(pcts[k] * 10) / 10, unit: "%",
        dateRange: SEGMENT_LABELS[k],
        avgLabel: avgLabel(range),
      });
    });
  };

  return (
    <View>
      <View style={[bdStyles.track, { width: chartW }]}>
        {keys.map((k) =>
          pcts[k] > 0 ? (
            <Pressable
              key={k}
              ref={(el) => { segRefs.current[k] = el; }}
              style={[bdStyles.seg, { flex: pcts[k], backgroundColor: SEGMENT_COLORS[k] }]}
              onPress={() => openFrom(k, segRefs)}
            />
          ) : null
        )}
      </View>
      <View style={[bdStyles.list, { marginTop: 10 }]}>
        {keys.map((k, i) => (
          <Pressable
            key={k}
            ref={(el) => { rowRefs.current[k] = el; }}
            style={[bdStyles.row, i === keys.length - 1 && { borderBottomWidth: 0 }]}
            onPress={() => openFrom(k, rowRefs)}
          >
            <View style={bdStyles.labelRow}>
              <View style={[bdStyles.dot, { backgroundColor: SEGMENT_COLORS[k] }]} />
              <Text style={bdStyles.lbl}>{SEGMENT_LABELS[k]}</Text>
            </View>
            <Text style={bdStyles.val}>{pcts[k].toFixed(1)}%</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const bdStyles = StyleSheet.create({
  track:    { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden" },
  seg:      { height: "100%" },
  list:     { backgroundColor: "rgba(63,36,131,0.06)", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  row:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "rgba(63,36,131,0.08)" },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot:      { width: 7, height: 7, borderRadius: 4 },
  lbl:      { fontFamily: "Agrandir-Regular", fontSize: 12, color: PRIMARY_TEXT, opacity: 0.75 },
  val:      { fontFamily: "Agrandir-GrandHeavy", fontSize: 12, color: PRIMARY_TEXT },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const [range, setRange]             = useState<Range>("week");
  const [resetKey, setResetKey]       = useState("week");
  const [activePopup, setActivePopup] = useState<ActivePopup | null>(null);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const scrollPaddingBottom     = NAV_BAR_HEIGHT + NAV_BOTTOM_OFFSET + bottomInset + 16;
  const pages                   = generatePages(range);

  const closePopup = () => setActivePopup(null);
  const openPopup  = (chartId: string, index: number | string, info: PopupInfo) =>
    setActivePopup({ chartId, index, info });

  const handleRangeChange = (r: Range) => {
    setRange(r);
    setResetKey(r);
    closePopup(); // data is changing — any open popup would be pointing at stale info
  };

  const [fontsLoaded] = useFonts({
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  if (!fontsLoaded) return null;

  // Bubble placement, clamped to the screen (not just the card) since it's
  // now rendered in a full-screen Modal.
  let bubbleTop = 0, bubbleLeft = 0, lineLeft = 0;
  if (activePopup) {
    const { x, y } = activePopup.info;
    const rawLeft  = x - POPUP_W / 2;
    bubbleLeft = Math.max(16, Math.min(rawLeft, SCREEN_W - POPUP_W - 16));
    bubbleTop  = Math.max(50, y - POPUP_H - LINE_H);
    lineLeft   = x - bubbleLeft - 0.5;
  }

  return (
    <View style={{ flex: 1, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={closePopup}
        contentContainerStyle={{
          paddingVertical: 8,
          paddingBottom: scrollPaddingBottom,
        }}
      >
        <HeaderBar />
        <RangeSelector range={range} onChange={handleRangeChange} />

        {/* ── S'CORE TREND ── */}
        <View style={[styles.card, styles.shadow]}>
          <SwipeCard pages={pages} resetKey={resetKey} onPageChange={closePopup} renderPage={(p, prev) => (
            <>
              <Text style={styles.cardTitle}>s'core trend</Text>
              <BarChart
                data={p} prevData={prev} range={range} type="score"
                activeIndex={activePopup?.chartId === "score" ? (activePopup.index as number) : null}
                onOpenPopup={(i, info) => openPopup("score", i, info)}
                onClosePopup={closePopup}
              />
            </>
          )} />
        </View>

        {/* ── S'ESSION TIME ── */}
        <View style={[styles.card, styles.shadow]}>
          <SwipeCard pages={pages} resetKey={resetKey} onPageChange={closePopup} renderPage={(p, prev) => (
            <>
              <Text style={styles.cardTitle}>s'ession time</Text>
              <BarChart
                data={p} prevData={prev} range={range} type="session"
                activeIndex={activePopup?.chartId === "session" ? (activePopup.index as number) : null}
                onOpenPopup={(i, info) => openPopup("session", i, info)}
                onClosePopup={closePopup}
              />
            </>
          )} />
        </View>

        {/* ── WHEN YOUR POSTURE SLIPS ── */}
        <View style={[styles.card, styles.shadow]}>
          <SwipeCard pages={pages} resetKey={resetKey} onPageChange={closePopup} renderPage={() => (
            <>
              <Text style={styles.cardTitle}>when your posture slips</Text>
              <PostureHeatmap
                hourlyData={HOURLY_POSTURE} range={range}
                activeIndex={activePopup?.chartId === "heatmap" ? (activePopup.index as number) : null}
                onOpenPopup={(i, info) => openPopup("heatmap", i, info)}
                onClosePopup={closePopup}
              />
            </>
          )} />
        </View>

        {/* ── POSTURE BREAKDOWN ── */}
        <View style={[styles.card, styles.shadow]}>
          <SwipeCard pages={pages} resetKey={resetKey} onPageChange={closePopup} renderPage={(p) => (
            <>
              <Text style={styles.cardTitle}>posture breakdown</Text>
              <PostureBreakdown
                stateTotals={p.stateTotals} range={range}
                activeKey={activePopup?.chartId === "breakdown" ? (activePopup.index as string) : null}
                onOpenPopup={(k, info) => openPopup("breakdown", k, info)}
                onClosePopup={closePopup}
              />
            </>
          )} />
        </View>
      </ScrollView>

      {/* ── Global popup — Modal renders above everything, including the nav bar ── */}
      {activePopup && (
        <Modal transparent visible animationType="none" onRequestClose={closePopup}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closePopup}>
            <Pressable
              style={[popupStyles.bubble, { top: bubbleTop, left: bubbleLeft }]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={popupStyles.dateText}>{activePopup.info.dateRange}</Text>
              <Text style={popupStyles.valueText}>
                {activePopup.info.value}
                <Text style={popupStyles.unitText}> {activePopup.info.unit}</Text>
              </Text>
              <Text style={popupStyles.avgText}>{activePopup.info.avgLabel}</Text>
              <View style={[popupStyles.line, { left: lineLeft }]} />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20, marginBottom: 16,
    padding: 18, paddingTop: 16, borderRadius: 28,
  },
  shadow: {
    shadowColor: "#1D014A", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 10, elevation: 5,
  },
  cardTitle: {
    fontFamily: "Agrandir-GrandHeavy", fontSize: 14,
    color: PRIMARY_TEXT, opacity: 0.75, marginBottom: 12,
  },
});
