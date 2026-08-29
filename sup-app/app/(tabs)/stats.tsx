import React, { useState, useRef, useEffect } from "react";
import { supabase } from "../../src/lib/supabase";
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
  Image,
} from "react-native";
import { BlurView } from "expo-blur";
import Svg, { Polyline, Circle, Text as SvgText } from "react-native-svg";
import { useFonts } from "expo-font";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";
import {
  fetchPosturePageRows,
  type PosturePageRow,
  type StateTotals,
} from "../../src/services/posture/postureSyncService";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { colours } from "@/theme/colours";

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

// // to update: Constants [0 is if there is no session]
// const HOURLY_POSTURE: Record<string, number> = {
//   "00:00": 0,  "01:00": 0,  "02:00": 0,  "03:00": 0,
//   "04:00": 0,  "05:00": 0,  "06:00": 0,  "07:00": 48,
//   "08:00": 72, "09:00": 81, "10:00": 79, "11:00": 85,
//   "12:00": 60, "13:00": 55, "14:00": 50, "15:00": 44,
//   "16:00": 38, "17:00": 42, "18:00": 30, "19:00": 0,
//   "20:00": 0,  "21:00": 0,  "22:00": 0,  "23:00": 0,
// };


type Range = "week" | "month" | "year";

interface PopupInfo {
  x: number;
  y: number;
  value: number;
  unit: string;
  dateRange: string;
  avgLabel: string;
}

interface ActivePopup {
  chartId: string;
  index: number | string;
  info: PopupInfo;
}

export interface PageData {
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

// ─── Page count — replace body with real Supabase query ───────────────────────
// Returns how many historical pages exist for this range. No cap — the user
// can swipe all the way back to the first ever recorded session.
async function getAvailablePageCount(userId: string, range: Range): Promise<number> {
  if (!userId) {
    console.error("[getAvailablePageCount] missing userId");
    return 0;
  }

  try {
    const { data, error } = await supabase
      .from('posture_daily')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: true })
      .limit(1)
    
    if (error) throw error;

    const dataStart = new Date(data?.[0]?.updated_at || new Date(2026, 0, 1).toISOString())
    const now = new Date();


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
  } catch (error) {
    console.error("[getAvailablePageCount] error:", error);
    return 0; // fallback to 0 pages if error occurs
  }
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

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

async function generatePages(userId: string, range: Range): Promise<PageData[]> {
  const now    = new Date();
  const MS_DAY = 86_400_000;
  const PAGES  = await getAvailablePageCount(userId, range);

  const pages: PageData[] = [];

  for (let p = 0; p < PAGES; p++) {
    const stateTotals: FullStateTotals = emptyStateTotals();
    
    if (range === "week") {
      const end   = new Date(now.getTime() - p * 7 * MS_DAY);
      const start = new Date(end.getTime() - 6 * MS_DAY);
      const startKey = toDateKey(start);
      const endKey   = toDateKey(end);

      const rows = await fetchPosturePageRows(userId, startKey, endKey);

      const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * MS_DAY));
      const dayKeys = days.map(toDateKey);
      const dayRows = dayKeys.map((k) => rows.find((r) => r.date === k));

      dayRows.forEach((r) => accumulateStateTotals(stateTotals, r));

      pages.push({
        labels:      ["mon","tue","wed","thu","fri","sat","sun"],
        scores:      dayRows.map((r) => r?.supScore ?? 0),
        sessionMins: dayRows.map((r) => sessionMinsOf(r)),
        hasData:     dayRows.map((r) => r !== undefined),
        stateTotals,
        startDate:   fmt(start),
        endDate:     fmt(end),
        pointDates:  days.map((d) => fmtFull(d)),
      });

    } else if (range === "month") {
      const ref   = new Date(now);
      ref.setMonth(ref.getMonth() - p);
      const year  = ref.getFullYear();
      const month = ref.getMonth();
      const start = new Date(year, month, 1);
      const end   = new Date(year, month + 1, 0);
      const startKey = toDateKey(start);
      const endKey   = toDateKey(end);

      const rows = await fetchPosturePageRows(userId, startKey, endKey);
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
      pages.push({
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
      });

    } else {
      const yr = now.getFullYear() - p;
      const start = new Date(yr, 0, 1);
      const end   = new Date(yr, 11, 31);
      const startKey = toDateKey(start);
      const endKey   = toDateKey(end);

      const rows = await fetchPosturePageRows(userId, startKey, endKey);
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

      pages.push({
        labels:      ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"],
        scores:      monthly.map((m) => m.score),
        sessionMins: monthly.map((m) => m.sessionMins),
        hasData:     monthly.map((m) => m.hasData),
        stateTotals,
        startDate:   `1 jan ${yr}`,
        endDate:     `31 dec ${yr}`,
        pointDates:  M.map((m) => `${m} ${yr}`),
      });
    }
  }

  return pages;
}

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

// Data popup

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
  line: {
    position: "absolute",
    bottom: -LINE_H,
    width: 1.5,
    height: LINE_H,
    backgroundColor: "#FFFFFF",
  },
});

// LiquidGlass range selector

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

// Swipeable card

function SwipeCard({
  pages,
  renderPage,
  resetKey,
  onPageChange,
}: {
  pages:      PageData[];
  renderPage: (page: PageData, prevPage: PageData | null) => React.ReactNode;
  resetKey:   string;
  onPageChange?: () => void;
}) {
  const [pageIdx, setPageIdx] = useState(0);
  const prevResetKey = useRef(resetKey);
  if (prevResetKey.current !== resetKey) {
    prevResetKey.current = resetKey;
    Promise.resolve().then(() => setPageIdx(0));
  }

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

// Shared helpers

function avg(arr: number[]) {
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function avgLabel(range: Range): string {
  if (range === "week")  return "Daily avg";
  if (range === "month") return "Weekly avg";
  return "Monthly avg";
}

// Bar chart

function fmtMins(m: number) {
  const h = Math.floor(m / 60); const r = m % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
}
function fmtMinsLong(m: number) {
  const h = Math.floor(m / 60); const r = m % 60;
  return h > 0 ? `${h}h ${r} min` : `${r} min`;
}

function BarChart({
  data, prevData, range, type, hasData, activeIndex, onOpenPopup, onClosePopup,
}: {
  data: PageData;
  prevData: PageData | null;
  range: Range;
  type: string;
  hasData: boolean[];
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
        value: type === "session" ? Number(values[i].toFixed(2)) : values[i], //fix to 2 decimal places for session time
        unit: type === "session" ? "min" : "score",
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
          const barHasData  = hasData?.[i] !== false; // treat missing hasData as "has data"
          const barColor    = !barHasData ? "#C4C4C4" : (isActive ? scoreColor(v) : "#6DC96D");
          const barOpacity  = !barHasData ? 1 : (isActive ? 1 : 0.85);
          return (
            <Pressable
              key={i}
              ref={(el) => { barRefs.current[i] = el; }}
              style={barStyles.col}
              onPress={() => handleBarPress(i)}
            >
              <View style={[
                barStyles.bar,
                { height: barH, backgroundColor: barColor, opacity: barOpacity },
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

// Posture heatmap

// function PostureHeatmap({
//   hourlyData, range, activeIndex, onOpenPopup, onClosePopup,
// }: {
//   hourlyData: Record<string, number>;
//   range: Range;
//   activeIndex: number | null;
//   onOpenPopup: (index: number, info: PopupInfo) => void;
//   onClosePopup: () => void;
// }) {
//   const hours = Object.keys(hourlyData);
//   const vals  = Object.values(hourlyData);
//   const active   = vals.filter((v) => v > 0);
//   const allZero  = active.length === 0;
//   const worstVal = allZero ? 0 : Math.min(...active);
//   const worstHr  = allZero ? "" : hours[vals.indexOf(worstVal)];
//   const insight  = allZero
//     ? "no posture data recorded — start a session to see patterns."
//     : `your posture holds well in the morning, then dips around ${worstHr} through the afternoon.`;

//   const labelHours = ["9am","11am","1pm","3pm","5pm","7pm"];
//   const chartW     = CARD_W - 36;
//   const cellRefs   = useRef<(View | null)[]>([]);

//   const handleCellPress = (i: number) => {
//     if (vals[i] === 0) return; // no session data for this hour, so no popup
//     if (activeIndex === i) { onClosePopup(); return; }
//     cellRefs.current[i]?.measureInWindow((x, y, width) => {
//       onOpenPopup(i, {
//         x: x + width / 2,
//         y,
//         value: vals[i], unit: "score",
//         dateRange: hours[i],
//         avgLabel: avgLabel(range),
//       });
//     });
//   };

//   return (
//     <View>
//       <View style={[heatStyles.row, { width: chartW }]}>
//         {hours.map((h, i) => (
//           <Pressable
//             key={h}
//             ref={(el) => { cellRefs.current[i] = el; }}
//             style={[heatStyles.cell, { backgroundColor: heatColor(vals[i]) }]}
//             onPress={() => handleCellPress(i)}
//           />
//         ))}
//       </View>
//       <View style={heatStyles.labelsRow}>
//         {labelHours.map((l) => <Text key={l} style={heatStyles.label}>{l}</Text>)}
//       </View>
//       <Text style={heatStyles.insight}>{insight}</Text>
//     </View>
//   );
// }

// const heatStyles = StyleSheet.create({
//   row:       { flexDirection: "row", gap: 2 },
//   cell:      { flex: 1, height: 26, borderRadius: 4 },
//   labelsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
//   label:     { fontSize: 9, color: "rgba(29,1,74,0.45)", fontWeight: "600" },
//   insight:   { fontFamily: "Agrandir-Regular", fontSize: 11, color: PRIMARY_TEXT, lineHeight: 17, marginTop: 8, opacity: 0.8 },
// });

// Posture breakdown

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

// Main screen

export default function StatsScreen() {
  const { isAuthenticated, userId } = useAuth();
  const { tutorialStep, setTutorialStep } = useTutorial();

  const [range, setRange]             = useState<Range>("week");
  const [resetKey, setResetKey]       = useState("week");
  const [activePopup, setActivePopup] = useState<ActivePopup | null>(null);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const scrollPaddingBottom     = NAV_BAR_HEIGHT + NAV_BOTTOM_OFFSET + bottomInset + 16;
  const [pages, setPages] = useState<PageData[]>([]);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      setPages([]);
      return;
    }

    let mounted = true;
    generatePages(userId, range).then((p) => { if (mounted) setPages(p); });
    return () => { mounted = false; };
  }, [isAuthenticated, userId, range]);

  console.log("[StatsScreen] render — userId:", userId, "pages:", pages);

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

        {tutorialStep === "stats-tip" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../assets/images/mascot.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>
                switch between weekly, monthly, and yearly data here. you can see your s'up score, session time, and posture snapshot for whichever period you pick.
              </Text>
              <Pressable
                onPress={() => {
                  setTutorialStep("community-tip");
                  router.replace("/leaderboard" as any);
                }}
              >
                <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* S'CORE TREND */}
        <View style={[styles.card, styles.shadow]}>
          {pages && pages.length > 0 ? (
            <SwipeCard pages={pages} resetKey={resetKey} onPageChange={closePopup} renderPage={(p, prev) => (
              <>
                <Text style={styles.cardTitle}>s'core trend</Text>
                <BarChart
                  data={p} prevData={prev} range={range} type="score"
                  hasData={p.hasData}
                  activeIndex={activePopup?.chartId === "score" ? (activePopup.index as number) : null}
                  onOpenPopup={(i, info) => openPopup("score", i, info)}
                  onClosePopup={closePopup}
                />
              </>
            )} />
          ) : (
            <Text style={styles.cardTitle}>loading…</Text> // or a spinner
          )}
        </View>

        {/* S'ESSION TIME */}
        <View style={[styles.card, styles.shadow]}>
          {pages && pages.length > 0 ? (
            <SwipeCard pages={pages} resetKey={resetKey} onPageChange={closePopup} renderPage={(p, prev) => (
              <>
                <Text style={styles.cardTitle}>s'ession time</Text>
                <BarChart
                  data={p} prevData={prev} range={range} type="session"
                  hasData={p.hasData}
                  activeIndex={activePopup?.chartId === "session" ? (activePopup.index as number) : null}
                  onOpenPopup={(i, info) => openPopup("session", i, info)}
                  onClosePopup={closePopup}
                />
              </>
            )} />
          ) : (
            <Text style={styles.cardTitle}>loading…</Text> // or a spinner
          )}
        </View>

        {/* WHEN YOUR POSTURE SLIPS */}
        {/* <View style={[styles.card, styles.shadow]}>
          {pages && pages.length > 0 ? (
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
          ) : (
            <Text style={styles.cardTitle}>loading…</Text> // or a spinner
          )}
        </View> */}

        {/* POSTURE BREAKDOWN */}
        <View style={[styles.card, styles.shadow]}>
          {pages && pages.length > 0 ? (
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
          ) : (
            <Text style={styles.cardTitle}>loading…</Text> // or a spinner
          )}
        </View>
      </ScrollView>

      {/* Global popup — Modal renders above everything, including the nav bar */}
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

// Styles

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
  tutorialTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  tutorialTipMascot: {
    width: 34,
    height: 34,
  },
  tutorialTipTextWrap: {
    flex: 1,
  },
  tutorialTipText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: "#FFFFFF",
    lineHeight: 18,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },
  cardTitle: {
    fontFamily: "Agrandir-GrandHeavy", fontSize: 14,
    color: PRIMARY_TEXT, opacity: 0.75, marginBottom: 12,
  },
});
