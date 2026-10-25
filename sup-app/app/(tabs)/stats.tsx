import PressFeedback from "@/src/components/ui/PressFeedback";
import TutorialActions from "@/src/components/onboarding/TutorialActions";
import React, { useState, useRef, useEffect, useMemo, useCallback, useId, createContext, useContext } from "react";
import {
  View,
  AppState,
  Text as NativeText,
  Platform,
  type TextProps,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Easing,
  Dimensions,
  PanResponder,
  Modal,
  Image,
} from "react-native";
import { BlurView } from "expo-blur";
import Svg, { Polyline, Circle, Text as SvgText } from "react-native-svg";
import { useFocusEffect } from "expo-router";
import { useFonts } from "expo-font";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";
import RefreshButton from "@/src/components/ui/RefreshButton";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePostureHistory } from "@/src/contexts/PostureHistoryContext";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { colours } from "@/theme/colours";
import { InfoButton, InfoModal, InfoModalEntry } from "@/src/components/ui/InfoModal";
import { toLocalDateKey } from "@/src/lib/dateKey";
import { watchStatsFreshness } from "@/src/services/stats/statsFreshness";
import { statsWindowKey, STATS_STALE_MS } from "@/src/services/stats/statsHistoryStore";
import { buildStatsPage, statsPageCount, statsPageWindow, type PageData, type StatsRange } from "@/src/services/stats/statsPages";

// Font assets are cosmetic: charts and navigation must remain usable if their
// download is slow or fails. Stats uses native text until the fonts are ready.
const StatsFontsContext = createContext(false);
function Text({ style, ...props }: TextProps) {
  const ready = useContext(StatsFontsContext);
  const flat = StyleSheet.flatten(style);
  return <NativeText {...props} style={[style, !ready && {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    fontWeight: flat?.fontFamily === "Agrandir-GrandHeavy" ? "700" : (flat?.fontWeight ?? "400"),
  }]} />;
}

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

// "?" popup content for the three cards below — same content regardless of
// which range tab (week/month/year) is selected, since it's explaining what
// the card shows, not the data itself.
const STATS_METRIC_INFO: Record<string, InfoModalEntry> = {
  trend: {
    title: "s'core trend",
    body: "your daily s'up s'core over time, for the period you've selected. each bar is one day's (or the average of the week's, or month's) score out of 100; tap a bar to see that period's exact score.",
  },
  session: {
    title: "s'ession time",
    body: "how long you tracked posture sessions in each period. the more you track, the more your s'up s'core reflects your real posture.",
  },
  breakdown: {
    title: "posture breakdown",
    body: "the share of your tracked time spent in each posture state over the selected period such as upright, forward lean, slouched, and so on.",
  },
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


type Range = StatsRange;

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
  // Centres the 60px-wide bubble under tab r
  const bubbleOffset = (r: Range) => RANGES.indexOf(r) * TAB_W + (TAB_W / 2 - 30);
  // Start under the initially selected tab, not at x=0
  const bubbleX = useRef(new Animated.Value(bubbleOffset(range))).current;

  const handlePress = (r: Range) => {
    Animated.spring(bubbleX, {
      toValue: bubbleOffset(r),
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
          <PressFeedback feedback="scale" key={r} style={rangeStyles.tab} onPress={() => handlePress(r)}>
            <Text style={[rangeStyles.label, r === range && rangeStyles.labelActive]}>{r}</Text>
          </PressFeedback>
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

const SWIPE_DISTANCE   = 40;   // px past which a release changes page
const SWIPE_VELOCITY   = 0.3;  // or a quick flick, in px/ms
const EDGE_RESISTANCE  = 0.25; // rubber-band drag when there's no page that way
const CARD_PADDING_X   = 18;   // matches styles.card padding
const PAGE_W           = CARD_W - CARD_PADDING_X * 2;
// Pages sit a full card-padding apart so a neighbour starts just past the card edge
const PAGE_STRIDE      = PAGE_W + CARD_PADDING_X * 2;

type StatsPages = {
  length: number;
  loadingMessage?: string;
  get: (index: number) => PageData;
  ensure: (index: number) => void;
  observe: (id: string, indices: number[]) => () => void;
};

function SwipeCard({
  pages,
  renderPage,
  onPageChange,
}: {
  pages:      StatsPages;
  renderPage: (page: PageData, prevPage: PageData | null) => React.ReactNode;
  onPageChange?: () => void;
}) {
  const [pageIdx, setPageIdx] = useState(0);
  const observerId = useId();

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const pageIdxRef = useRef(pageIdx);
  pageIdxRef.current = pageIdx;

  // Carousel: every page has a fixed slot in one row (only the current page and
  // its neighbours are rendered), and the row slides to the target slot. The
  // next page is already mounted when a swipe lands, so there's no blank frame.
  const offset       = useRef(new Animated.Value(0)).current;
  const animatingRef = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder:  (_, g) =>
        !animatingRef.current && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => offset.stopAnimation(),
      onPanResponderMove: (_, g) => {
        const maxIdx = pagesRef.current.length - 1;
        const atEdge = (g.dx > 0 && pageIdxRef.current <= 0) || (g.dx < 0 && pageIdxRef.current >= maxIdx);
        offset.setValue(-pageIdxRef.current * PAGE_STRIDE + (atEdge ? g.dx * EDGE_RESISTANCE : g.dx));
      },
      onPanResponderRelease: (_, g) => {
        const maxIdx = pagesRef.current.length - 1;
        const dir: 1 | -1 | 0 =
          g.dx < -SWIPE_DISTANCE || g.vx < -SWIPE_VELOCITY ? 1 :
          g.dx >  SWIPE_DISTANCE || g.vx >  SWIPE_VELOCITY ? -1 : 0;
        const next = pageIdxRef.current + dir;
        if (dir === 0 || next < 0 || next > maxIdx) {
          settleOn(pageIdxRef.current);
          return;
        }
        settleOn(next);
      },
      onPanResponderTerminate: () => settleOn(pageIdxRef.current),
    })
  ).current;

  function settleOn(idx: number) {
    animatingRef.current = true;
    Animated.timing(offset, {
      toValue: -idx * PAGE_STRIDE,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      animatingRef.current = false;
      if (idx !== pageIdxRef.current) setPageIdx(idx);
    });
  }

  // Keep the row on the current slot when the page changes without a swipe
  // (e.g. the range reset back to page 0).
  useEffect(() => {
    if (!animatingRef.current) offset.setValue(-pageIdx * PAGE_STRIDE);
  }, [pageIdx, offset]);

  useEffect(() => {
    onPageChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdx]);

  const currentPage = pages.get(Math.min(pageIdx, pages.length - 1));
  const displayIdx  = Math.min(pageIdx, pages.length - 1);
  const firstVisible = Math.max(0, displayIdx - 1);
  const visibleIndices = Array.from({ length: Math.min(pages.length - 1, displayIdx + 1) - firstVisible + 1 }, (_, i) => firstVisible + i);
  const ensure = pages.ensure;
  const observe = pages.observe;
  const pageCount = pages.length;
  useEffect(() => {
    const indices = Array.from(
      { length: Math.min(pageCount - 1, displayIdx + 1) - firstVisible + 1 },
      (_, i) => firstVisible + i
    );
    const stop = observe(observerId, indices);
    indices.forEach(ensure);
    return stop;
  }, [displayIdx, firstVisible, pageCount, ensure, observe, observerId]);

  return (
    <View>
      <Text style={swipeStyles.dateRange}>
        {currentPage.startDate} – {currentPage.endDate}
      </Text>
      <View style={swipeStyles.clip} {...panResponder.panHandlers}>
        <Animated.View style={[swipeStyles.row, { marginLeft: firstVisible * PAGE_STRIDE, transform: [{ translateX: offset }] }]}>
          {visibleIndices.map((i) => {
            const page = pages.get(i);
            return <View key={i} style={swipeStyles.page}>
              {page.isLoading ? <Text style={styles.cardTitle}>{pages.loadingMessage ?? "loading…"}</Text>
                : renderPage(page, i + 1 < pages.length ? pages.get(i + 1) : null)}
            </View>;
          })}
        </Animated.View>
      </View>

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
  // Bleeds to the card's edges so a swiped page clips at the card, not its padding.
  // Always clipped: neighbouring pages sit just outside it (popups use a Modal).
  clip: { marginHorizontal: -CARD_PADDING_X, paddingHorizontal: CARD_PADDING_X, overflow: "hidden" },
  row:  { flexDirection: "row", alignItems: "flex-start", gap: CARD_PADDING_X * 2 },
  page: { width: PAGE_W },
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
        unit: type === "session" ? "min" : "pts",
        dateRange: data.pointDates[i] ?? data.labels[i],
        avgLabel:  avgLabel(range),
      });
    });
  };

  return (
    <View>
      <View style={barStyles.statRow}>
        <Text style={barStyles.statText}>
          avg {type === "session" ? fmtMinsLong(curAvgMins) : `${curAvgMins} pts`}
        </Text>
        {diffMins !== null && (
          <Text style={[barStyles.statText, { color: diffMins >= 0 ? "#6DC96D" : "#EC555E" }]}>
            {"  "}{diffMins >= 0 ? "↑" : "↓"}{" "}
            {type === "session" ? fmtMins(Math.abs(diffMins)) : `${Math.abs(diffMins)} pts`}
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
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (tutorialStep === "stats-tip") {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [tutorialStep]);

  const [range, setRange]             = useState<Range>("week");
  const [resetKey, setResetKey]       = useState("week");
  const [activePopup, setActivePopup] = useState<ActivePopup | null>(null);
  const [activeMetricInfo, setActiveMetricInfo] = useState<string | null>(null);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const scrollPaddingBottom     = NAV_BAR_HEIGHT + NAV_BOTTOM_OFFSET + bottomInset + 16;
  const { windows, earliest, pending, lastUpdatedAt, error, refresh, ensureWindow, observe, ensureFresh, watch } = usePostureHistory();
  const [todayKey, setTodayKey] = useState(toLocalDateKey());
  const isRefreshing = pending > 0;
  const emptyMessage = isAuthenticated ? (error ?? "loading…") : "sign in to see your stats";

  useFocusEffect(useCallback(() => watchStatsFreshness({
    check: () => { setTodayKey(toLocalDateKey()); void ensureFresh(); },
    isActive: () => !AppState.currentState || AppState.currentState === "active",
    watch,
    subscribe: (callback) => {
      const subscription = AppState.addEventListener("change", callback);
      return () => subscription.remove();
    },
    intervalMs: STATS_STALE_MS,
  }), [ensureFresh, watch]));

  const anchor = useMemo(() => new Date(`${todayKey}T12:00:00`), [todayKey]);
  const ensurePage = useCallback((index: number) => {
    void ensureWindow(statsPageWindow(range, index, anchor));
  }, [range, anchor, ensureWindow]);
  const observePages = useCallback((id: string, indices: number[]) =>
    observe(id, indices.map((index) => statsPageWindow(range, index, anchor))), [observe, range, anchor]);
  const pages = useMemo<StatsPages>(() => {
    const length = isAuthenticated && userId ? statsPageCount(earliest, range, anchor) : 0;
    // One aggregation per requested index, shared by all three cards. No work
    // or placeholder views are created for the rest of the user's history.
    const prepared = new Map<number, PageData>();
    return { length, loadingMessage: error ?? "loading…", ensure: ensurePage, observe: observePages, get(index) {
      let page = prepared.get(index);
      if (!page) {
        const window = statsPageWindow(range, index, anchor);
        const cached = windows[statsWindowKey(window)];
        page = { ...buildStatsPage(cached?.rows ?? [], range, index, anchor), isLoading: !cached };
        prepared.set(index, page);
      }
      return page;
    } };
  }, [windows, earliest, range, anchor, isAuthenticated, userId, ensurePage, observePages, error]);

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


  let bubbleTop = 0, bubbleLeft = 0, lineLeft = 0;
  if (activePopup) {
    const { x, y } = activePopup.info;
    const rawLeft  = x - POPUP_W / 2;
    bubbleLeft = Math.max(16, Math.min(rawLeft, SCREEN_W - POPUP_W - 16));
    bubbleTop  = Math.max(50, y - POPUP_H - LINE_H);
    lineLeft   = x - bubbleLeft - 0.5;
  }

  return (
    <StatsFontsContext.Provider value={fontsLoaded}>
    <View style={{ flex: 1, backgroundColor: "rgba(211, 193, 231, 0.64)" }}>
      <BackgroundBlobs />
      <ScrollView
        ref={scrollRef}
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
        <RefreshButton
          onPress={refresh}
          isRefreshing={isRefreshing}
          lastUpdatedAt={lastUpdatedAt}
        />

        {tutorialStep === "stats-tip" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../assets/images/mascot_tutorial.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>
                track your posture over time here. tap any &quot;?&quot; to learn more!
              </Text>
              <TutorialActions>
                <PressFeedback feedback="link" onPress={() => setTutorialStep("go-community-tip")}>
                  <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
                </PressFeedback>
              </TutorialActions>
            </View>
          </View>
        )}

        {error && <Text accessibilityRole="alert" style={styles.cardTitle}>{error}</Text>}

        {/* S'CORE TREND */}
        <View style={[styles.card, styles.shadow]}>
          <InfoButton onPress={() => setActiveMetricInfo("trend")} color={PRIMARY_TEXT} />

          {pages && pages.length > 0 ? (
            <SwipeCard pages={pages} key={`${resetKey}:${todayKey}:${userId}`} onPageChange={closePopup} renderPage={(p, prev) => (
              <>
                <Text style={styles.cardTitle}>s&apos;core trend</Text>
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
            <Text style={styles.cardTitle}>{emptyMessage}</Text>
          )}
        </View>

        {/* S'ESSION TIME */}
        <View style={[styles.card, styles.shadow]}>
          <InfoButton onPress={() => setActiveMetricInfo("session")} color={PRIMARY_TEXT} />

          {pages && pages.length > 0 ? (
            <SwipeCard pages={pages} key={`${resetKey}:${todayKey}:${userId}`} onPageChange={closePopup} renderPage={(p, prev) => (
              <>
                <Text style={styles.cardTitle}>s&apos;ession time</Text>
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
            <Text style={styles.cardTitle}>{emptyMessage}</Text>
          )}
        </View>

        {/* WHEN YOUR POSTURE SLIPS */}
        {/* <View style={[styles.card, styles.shadow]}>
          {pages && pages.length > 0 ? (
            <SwipeCard pages={pages} key={`${resetKey}:${todayKey}:${userId}`} onPageChange={closePopup} renderPage={() => (
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
            <Text style={styles.cardTitle}>{emptyMessage}</Text>
          )}
        </View> */}

        {/* POSTURE BREAKDOWN */}
        <View style={[styles.card, styles.shadow]}>
          <InfoButton onPress={() => setActiveMetricInfo("breakdown")} color={PRIMARY_TEXT} />

          {pages && pages.length > 0 ? (
            <SwipeCard pages={pages} key={`${resetKey}:${todayKey}:${userId}`} onPageChange={closePopup} renderPage={(p) => (
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
            <Text style={styles.cardTitle}>{emptyMessage}</Text>
          )}
        </View>

        <InfoModal
          metricKey={activeMetricInfo}
          onClose={() => setActiveMetricInfo(null)}
          metricInfo={STATS_METRIC_INFO}
          accentColor={PRIMARY_TEXT}
        />
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
    </StatsFontsContext.Provider>
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
    fontSize: 15,
    color: "#FFFFFF",
    lineHeight: 20,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },
  cardTitle: {
    fontFamily: "Agrandir-GrandHeavy", fontSize: 14,
    color: PRIMARY_TEXT, opacity: 0.75, marginBottom: 12,
  },
});
