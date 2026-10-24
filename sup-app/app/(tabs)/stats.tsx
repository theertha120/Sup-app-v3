import PressFeedback from "@/src/components/ui/PressFeedback";
import TutorialActions from "@/src/components/onboarding/TutorialActions";
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
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
import { useFonts } from "expo-font";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import HeaderBar from "@/src/components/ui/HeaderBar";
import RefreshButton from "@/src/components/ui/RefreshButton";
import type {
  PosturePageRow,
  StateTotals,
} from "../../src/services/posture/postureSyncService";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePostureHistory } from "@/src/contexts/PostureHistoryContext";
import { useTutorial } from "@/src/contexts/TutorialContext";
import { colours } from "@/theme/colours";
import { InfoButton, InfoModal, InfoModalEntry } from "@/src/components/ui/InfoModal";
import { toLocalDateKey } from "@/src/lib/dateKey";
import { formatSessionMins } from "@/src/lib/formatDuration";

export { default as ErrorBoundary } from "@/src/components/ui/ScreenErrorBoundary";

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
  upright:      "upright",
  forward_lean: "forward lean",
  slouched:     "slouched",
  severe:       "severe",
  tilted_left:  "tilted left",
  tilted_right: "tilted right",
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


type Range = "week" | "month" | "year";

interface PopupInfo {
  x: number;
  y: number;
  value: number | string;
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
  const M = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Page count ───────────────────────────────────────────────────────────────
// How many historical pages exist for this range. No cap — the user can swipe
// all the way back to the first ever recorded session. Derived from the history
// already in memory, so it costs no query of its own.
function getPageCountFromRows(rows: PosturePageRow[], range: Range): number {
  // Anchored on the oldest row we hold. Falls back to the same placeholder the
  // previous query-based version used when the user has no rows at all.
  const earliestKey = rows[0]?.date;
  const dataStart = earliestKey
    ? new Date(`${earliestKey}T00:00:00.000Z`)
    : new Date(2026, 0, 1);
  const now = new Date();

  if (range === "week") {
    const msPerWeek = 7 * 86_400_000;
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


// Phone-local YYYY-MM-DD — must match how posture_daily.date is written.
const toDateKey = (d: Date): string => toLocalDateKey(d);

const DAY_LABELS = ["sun","mon","tue","wed","thu","fri","sat"];

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

// Builds every page for a range from the history already in memory. Pure, so
// switching range or swiping pages costs no network call — this used to issue one
// query per page, serially, on every range change.
function buildPages(history: PosturePageRow[], range: Range): PageData[] {
  const now    = new Date();
  const PAGES  = getPageCountFromRows(history, range);

  // Rows arrive sorted by date, so a filtered slice keeps that order — matching
  // what the old per-page query returned.
  // One pass into "YYYY-MM" buckets, so month/year pages don't each rescan the whole history.
  const rowByDate = new Map<string, PosturePageRow>();
  const rowsByMonth = new Map<string, PosturePageRow[]>();
  for (const r of history) {
    rowByDate.set(r.date, r);
    const monthKey = r.date.slice(0, 7);
    const bucket = rowsByMonth.get(monthKey);
    if (bucket) bucket.push(r);
    else rowsByMonth.set(monthKey, [r]);
  }
  const monthRows = (d: Date) => rowsByMonth.get(toDateKey(d).slice(0, 7)) ?? [];
  const dayOfMonth = (r: PosturePageRow) => Number(r.date.slice(8, 10));

  const pages: PageData[] = [];

  for (let p = 0; p < PAGES; p++) {
    const stateTotals: FullStateTotals = emptyStateTotals();
    if (range === "week") {
      // Calendar-day steps (setDate) rather than fixed 24h ms steps, so a
      // daylight-saving change can't shift a bar onto the wrong day.
      const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - p * 7);
      const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);

      const days = Array.from({ length: 7 }, (_, i) =>
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
      const dayKeys = days.map(toDateKey);
      const dayRows = dayKeys.map((k) => rowByDate.get(k));

      dayRows.forEach((r) => accumulateStateTotals(stateTotals, r));

      pages.push({
        // The window is the 7 days ending today, not Mon–Sun, so label each bar by its own weekday.
        labels:      days.map((d) => DAY_LABELS[d.getDay()]),
        scores:      dayRows.map((r) => r?.supScore ?? 0),
        sessionMins: dayRows.map((r) => sessionMinsOf(r)),
        hasData:     dayRows.map((r) => r !== undefined),
        stateTotals,
        startDate:   fmt(start),
        endDate:     fmt(end),
        pointDates:  days.map((d) => fmtFull(d)),
      });

    } else if (range === "month") {
      // Built from day 1: setMonth() on e.g. 31 Oct → "31 Sep" overflows to 1 Oct,
      // which repeated the current month and skipped the previous one.
      const ref   = new Date(now.getFullYear(), now.getMonth() - p, 1);
      const year  = ref.getFullYear();
      const month = ref.getMonth();
      const start = new Date(year, month, 1);
      const end   = new Date(year, month + 1, 0);

      const rows = monthRows(start);
      rows.forEach((r) => accumulateStateTotals(stateTotals, r));

      // 4 weekly buckets: 1-7, 8-14, 15-21, 22-end
      const weekBounds = [
        [1, 7], [8, 14], [15, 21], [22, end.getDate()],
      ];
      const weekly = weekBounds.map(([dStart, dEnd]) => {
        const bucketRows = rows.filter((r) => {
          const day = dayOfMonth(r);
          return day >= dStart && day <= dEnd;
        });
        return {
          score:       avgOf(bucketRows.map((r) => r.supScore ?? NaN)),
          sessionMins: bucketRows.reduce((sum, r) => sum + sessionMinsOf(r), 0),
          hasData:     bucketRows.length > 0,
        };
      });

      const M = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
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

      const M = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
      const monthly = Array.from({ length: 12 }, (_, m) => {
        const bucketRows = monthRows(new Date(yr, m, 1));
        bucketRows.forEach((r) => accumulateStateTotals(stateTotals, r));
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

function SwipeCard({
  pages,
  renderPage,
  onPageChange,
}: {
  pages:      PageData[];
  renderPage: (page: PageData, prevPage: PageData | null) => React.ReactNode;
  onPageChange?: () => void;
}) {
  // Callers pass key={range}, so a range change remounts this at page 0.
  const [pageIdx, setPageIdx] = useState(0);

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

  const currentPage = pages[pageIdx] ?? pages[0];
  // Extra guard against the one-render gap between a resetKey change and the
  // deferred setPageIdx(0) above actually landing (e.g. switching from a
  // long range straight to a short one) — keeps the counter's numerator from
  // ever reading ahead of the *current* pages array too.
  const displayIdx  = Math.min(pageIdx, pages.length - 1);
  // Only the current page and its neighbours get a View; the first one is
  // pushed to its slot with a margin so slots before it don't need empty Views.
  const firstIdx    = Math.max(0, displayIdx - 1);
  const windowPages = pages.slice(firstIdx, displayIdx + 2);

  return (
    <View>
      <Text style={swipeStyles.dateRange}>
        {currentPage.startDate} – {currentPage.endDate}
      </Text>
      <View style={swipeStyles.clip} {...panResponder.panHandlers}>
        <Animated.View style={[swipeStyles.row, { transform: [{ translateX: offset }] }]}>
          {windowPages.map((p, j) => {
            const i = firstIdx + j;
            return (
              <View key={i} style={[swipeStyles.page, j === 0 && { marginLeft: i * PAGE_STRIDE }]}>
                {renderPage(p, pages[i + 1] ?? null)}
              </View>
            );
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

function avgLabel(range: Range): string {
  if (range === "week")  return "daily avg";
  if (range === "month") return "weekly avg";
  return "monthly avg";
}

// Session bars are totals, so their popup says "total" rather than "avg".
function totalLabel(range: Range): string {
  if (range === "week")  return "daily total";
  if (range === "month") return "weekly total";
  return "monthly total";
}

// Bar chart

// Session time is the page's total; score averages only bars with data, since
// a 0 there means "no score", not a bad one.
function summaryValue(page: PageData, type: string): number | null {
  if (type === "session") {
    return Math.round(page.sessionMins.reduce((a, b) => a + b, 0));
  }
  const values = page.scores.filter((_, i) => page.hasData[i]);
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// Memoised so opening a popup on one chart doesn't re-render the others.
const BarChart = React.memo(function BarChart({
  data, prevData, range, type, hasData, activeIndex, onOpenPopup, onClosePopup,
}: {
  data: PageData;
  prevData: PageData | null;
  range: Range;
  type: string; // also the popup chartId ("score" | "session")
  hasData: boolean[];
  activeIndex: number | null;
  onOpenPopup: (chartId: string, index: number, info: PopupInfo) => void;
  onClosePopup: () => void;
}) {
  const maxBarH = 72;
  const barRefs = useRef<(View | null)[]>([]);

  const values = type === "session" ? data.sessionMins : data.scores;
  const maxV   = Math.max(...values, 1);
  const curValue  = summaryValue(data, type);
  const prevValue = prevData ? summaryValue(prevData, type) : null;

  const chartW   = CARD_W - 36;
  const diff     = curValue !== null && prevValue !== null ? curValue - prevValue : null;

  const handleBarPress = (i: number) => {
    if (activeIndex === i) { onClosePopup(); return; }
    barRefs.current[i]?.measureInWindow((x, y, width) => {
      onOpenPopup(type, i, {
        x: x + width / 2,
        y,
        // Session time is pre-formatted ("1h 5min"), so it carries its own unit
        value: type === "session" ? formatSessionMins(values[i]) : values[i],
        unit: type === "session" ? "" : "pts",
        dateRange: data.pointDates[i] ?? data.labels[i],
        avgLabel:  type === "session" ? totalLabel(range) : avgLabel(range),
      });
    });
  };

  return (
    <View>
      <View style={barStyles.statRow}>
        <Text style={barStyles.statText}>
          {type === "session" ? `total ${formatSessionMins(curValue ?? 0)}` : `avg ${curValue ?? 0} pts`}
        </Text>
        {diff !== null && (
          <Text style={[barStyles.statText, { color: diff >= 0 ? "#6DC96D" : "#EC555E" }]}>
            {"  "}{diff >= 0 ? "↑" : "↓"}{" "}
            {type === "session" ? formatSessionMins(Math.abs(diff)) : `${Math.abs(diff)} pts`}
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
});

const barStyles = StyleSheet.create({
  statRow:   { flexDirection: "row", justifyContent: "flex-end", alignItems: "baseline", marginBottom: 4 },
  statText:  { fontFamily: "Agrandir-Regular", fontSize: 11, color: "rgba(29,1,74,0.55)" },
  container: { flexDirection: "row", alignItems: "flex-end", height: 88, gap: 3 },
  col:       { flex: 1, alignItems: "center", gap: 3 },
  bar:       { width: "100%", borderRadius: 3, backgroundColor: "#6DC96D" },
  label:     { fontFamily: "Agrandir-GrandHeavy", fontSize: 8, color: "rgba(29,1,74,0.5)" },
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

const PostureBreakdown = React.memo(function PostureBreakdown({
  stateTotals, range, activeKey, onOpenPopup, onClosePopup,
}: {
  stateTotals: Record<string, number>;
  range: Range;
  activeKey: string | null;
  onOpenPopup: (chartId: string, key: string, info: PopupInfo) => void;
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
      onOpenPopup("breakdown", k, {
        x: x + width / 2,
        y,
        value: Math.round(pcts[k] * 10) / 10, unit: "%",
        dateRange: SEGMENT_LABELS[k],
        // A share of the period's summed time, not an average
        avgLabel: "of session time",
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
});

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
  const [activePopup, setActivePopup] = useState<ActivePopup | null>(null);
  const [activeMetricInfo, setActiveMetricInfo] = useState<string | null>(null);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const scrollPaddingBottom     = NAV_BAR_HEIGHT + NAV_BOTTOM_OFFSET + bottomInset + 16;
  const {
    rows: history,
    isRefreshing,
    lastUpdatedAt,
    error,
    refresh,
    ensureFreshForToday,
  } = usePostureHistory();

  // Reloads only if the calendar day rolled over since the last pull.
  useFocusEffect(
    useCallback(() => {
      ensureFreshForToday();
    }, [ensureFreshForToday])
  );

  // Shown by each card while there is nothing to chart yet.
  const emptyMessage = error ?? "loading…";

  // Derived from the history loaded at login, so changing range is instant.
  // Empty until a load has succeeded, so the cards show "loading…" / the error
  // instead of a page of zero bars (buildPages always returns at least one page).
  const hasHistory = lastUpdatedAt != null;
  const pages = useMemo(
    () => (isAuthenticated && userId && hasHistory ? buildPages(history, range) : []),
    [history, range, isAuthenticated, userId, hasHistory]
  );

  // Stable identities so the memoised charts skip re-rendering.
  const closePopup = useCallback(() => setActivePopup(null), []);
  const openPopup  = useCallback((chartId: string, index: number | string, info: PopupInfo) =>
    setActivePopup({ chartId, index, info }), []);

  const handleRangeChange = (r: Range) => {
    setRange(r);
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
                track your posture over time here. tap any "?" to learn more!
              </Text>
              <TutorialActions>
                <PressFeedback feedback="link" onPress={() => setTutorialStep("go-community-tip")}>
                  <Text style={styles.tutorialTipNext}>next {'>>'}</Text>
                </PressFeedback>
              </TutorialActions>
            </View>
          </View>
        )}

        {/* S'CORE TREND */}
        <View style={[styles.card, styles.shadow]}>
          <InfoButton onPress={() => setActiveMetricInfo("trend")} color={PRIMARY_TEXT} />

          {pages && pages.length > 0 ? (
            <SwipeCard key={range} pages={pages} onPageChange={closePopup} renderPage={(p, prev) => (
              <>
                <Text style={styles.cardTitle}>s'core trend</Text>
                <BarChart
                  data={p} prevData={prev} range={range} type="score"
                  hasData={p.hasData}
                  activeIndex={activePopup?.chartId === "score" ? (activePopup.index as number) : null}
                  onOpenPopup={openPopup}
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
            <SwipeCard key={range} pages={pages} onPageChange={closePopup} renderPage={(p, prev) => (
              <>
                <Text style={styles.cardTitle}>s'ession time</Text>
                <BarChart
                  data={p} prevData={prev} range={range} type="session"
                  hasData={p.hasData}
                  activeIndex={activePopup?.chartId === "session" ? (activePopup.index as number) : null}
                  onOpenPopup={openPopup}
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
            <Text style={styles.cardTitle}>{emptyMessage}</Text>
          )}
        </View> */}

        {/* POSTURE BREAKDOWN */}
        <View style={[styles.card, styles.shadow]}>
          <InfoButton onPress={() => setActiveMetricInfo("breakdown")} color={PRIMARY_TEXT} />

          {pages && pages.length > 0 ? (
            <SwipeCard key={range} pages={pages} onPageChange={closePopup} renderPage={(p) => (
              <>
                <Text style={styles.cardTitle}>posture breakdown</Text>
                <PostureBreakdown
                  stateTotals={p.stateTotals} range={range}
                  activeKey={activePopup?.chartId === "breakdown" ? (activePopup.index as string) : null}
                  onOpenPopup={openPopup}
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
                {activePopup.info.unit ? (
                  <Text style={popupStyles.unitText}> {activePopup.info.unit}</Text>
                ) : null}
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
    fontSize: 15,
    color: "#FFFFFF",
    lineHeight: 20,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 15,
    color: colours.primary,
    textDecorationLine: "underline",
  },
  cardTitle: {
    fontFamily: "Agrandir-GrandHeavy", fontSize: 14,
    color: PRIMARY_TEXT, opacity: 0.75, marginBottom: 12,
  },
});
