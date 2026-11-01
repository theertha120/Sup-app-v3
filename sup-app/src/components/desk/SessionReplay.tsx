/**
 * SessionReplay
 *
 * End-of-session playback of the Desk Mode figure: replays the session's
 * posture timeline (from useSessionStats) through DeskPostureFigure, with
 * play/pause, a speed toggle and a draggable scrubber. Also renders the
 * summary header: "11 nov, 14:20 - 15:40 · 1h 20min" + the session s'core.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import PressFeedback from "../ui/PressFeedback";
import DeskPostureFigure from "./DeskPostureFigure";
import { DeskPostureState, getScoreColor } from "./mockDeskPostureData";
import { PostureSegment } from "../../lib/sessionHighlights";
import { formatSessionMins } from "../../lib/formatDuration";
import { colours } from "../../../theme/colours";

// At 1× the whole session plays back in this long; never slower than real time.
const BASE_PLAYBACK_MS = 30_000;
const SPEEDS = [1, 2, 4] as const;
const FRAME_MS = 50;

// Same per-state figure score the live Desk figure uses, so colours match.
const FIGURE_SCORE: Record<DeskPostureState, number> = {
  upright: 95, transition: 75, forward_lean: 62,
  tilted_left: 55, tilted_right: 55, slouched: 42, severe: 20,
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "11 nov, 14:20 - 15:40 · 1h 20min" */
export function formatSessionHeader(startMs: number, endMs: number): string {
  const d = new Date(startMs);
  const mins = Math.max(0, (endMs - startMs) / 60_000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock(startMs)} - ${clock(endMs)} · ${formatSessionMins(mins)}`;
}

interface Props {
  startMs: number;
  endMs: number;
  score: number | null;
  timeline: PostureSegment[];
  stateColors: Record<DeskPostureState, string>;
  stateLabels: Record<DeskPostureState, string>;
  /** Lets the parent lock its ScrollView while the scrubber is being dragged. */
  onScrubbingChange?: (scrubbing: boolean) => void;
}

export default function SessionReplay({
  startMs, endMs, score, timeline, stateColors, stateLabels, onScrubbingChange,
}: Props) {
  const hasTimeline = timeline.length > 0;
  const playStart = hasTimeline ? timeline[0].startMs : startMs;
  const playEnd   = hasTimeline ? timeline[timeline.length - 1].endMs : endMs;
  const spanMs    = Math.max(1, playEnd - playStart);

  const [posMs, setPosMs]       = useState(0);
  const [playing, setPlaying]   = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [trackW, setTrackW]     = useState(0);

  const posRef      = useRef(0);
  const trackWRef   = useRef(0);
  const spanRef     = useRef(spanMs);
  const dragStartRef = useRef(0);
  // Latest callback in a ref so the PanResponder is created once and isn't
  // swapped out mid-drag when the parent re-renders.
  const onScrubbingChangeRef = useRef(onScrubbingChange);

  useEffect(() => { spanRef.current = spanMs; }, [spanMs]);
  useEffect(() => { onScrubbingChangeRef.current = onScrubbingChange; }, [onScrubbingChange]);

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(spanRef.current, ms));
    posRef.current = clamped;
    setPosMs(clamped);
  }, []);

  // Playback loop
  useEffect(() => {
    if (!playing) return;
    const rate = Math.max(1, spanMs / BASE_PLAYBACK_MS) * SPEEDS[speedIdx];
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const next = posRef.current + (now - last) * rate;
      last = now;
      if (next >= spanRef.current) {
        seek(spanRef.current);
        setPlaying(false);
      } else {
        seek(next);
      }
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [playing, speedIdx, spanMs, seek]);

  const togglePlay = useCallback(() => {
    if (!playing && posRef.current >= spanRef.current) seek(0);
    setPlaying((p) => !p);
  }, [playing, seek]);

  const panResponder = useMemo(() => {
    // Tap or drag anywhere on the track; playback continues from where it's released.
    const finishScrub = () => {
      onScrubbingChangeRef.current?.(false);
      if (posRef.current < spanRef.current) setPlaying(true);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        setPlaying(false);
        onScrubbingChangeRef.current?.(true);
        const w = trackWRef.current;
        const x = evt.nativeEvent.locationX;
        dragStartRef.current = x;
        if (w > 0) seek((x / w) * spanRef.current);
      },
      onPanResponderMove: (_, g) => {
        const w = trackWRef.current;
        if (w > 0) seek(((dragStartRef.current + g.dx) / w) * spanRef.current);
      },
      onPanResponderRelease: finishScrub,
      // e.g. Android's ScrollView taking the gesture over — still resume.
      onPanResponderTerminate: finishScrub,
    });
  }, [seek]);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWRef.current = e.nativeEvent.layout.width;
    setTrackW(e.nativeEvent.layout.width);
  };

  // Posture at the playhead: last segment that started at or before it.
  const atMs = playStart + posMs;
  let currentState: DeskPostureState = "upright";
  for (const seg of timeline) {
    if (seg.startMs > atMs) break;
    currentState = seg.state as DeskPostureState;
  }
  const stateColor = stateColors[currentState];
  const progress   = posMs / spanMs;

  return (
    <View style={st.container}>
      {/* Summary header */}
      <View style={st.header}>
        <Text style={st.headerText} numberOfLines={2}>{formatSessionHeader(startMs, endMs)}</Text>
        <View style={st.scoreBlock}>
          <Text style={[st.scoreValue, score !== null && { color: getScoreColor(score) }]}>
            {score ?? "–"}
          </Text>
          <Text style={st.scoreLabel}>{"s'core"}</Text>
        </View>
      </View>

      {!hasTimeline ? (
        <Text style={st.emptyText}>this session was too short to replay.</Text>
      ) : (
        <>
          <View style={[st.stateStrip, { backgroundColor: stateColor + "1F" }]}>
            <View style={[st.stateDot, { backgroundColor: stateColor }]} />
            <Text style={[st.stateText, { color: stateColor }]}>{stateLabels[currentState]}</Text>
            <Text style={st.stateClock}>{clock(atMs)}</Text>
          </View>

          {/* Figure is 260px wide; scale it down to fit the summary card */}
          <View style={st.figureScale}>
            <DeskPostureFigure state={currentState} score={FIGURE_SCORE[currentState]} />
          </View>

          {/* Scrubber: posture-coloured track + draggable thumb */}
          <View style={st.scrubberHit} onLayout={onTrackLayout} {...panResponder.panHandlers}>
            <View style={st.track} pointerEvents="none">
              {timeline.map((seg, i) => (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${((seg.startMs - playStart) / spanMs) * 100}%`,
                    width: `${((seg.endMs - seg.startMs) / spanMs) * 100}%`,
                    top: 0, bottom: 0,
                    backgroundColor: stateColors[seg.state as DeskPostureState] ?? "#ccc",
                  }}
                />
              ))}
              {/* Dim the part not yet played */}
              <View style={[st.unplayed, { left: `${progress * 100}%` }]} />
            </View>
            {trackW > 0 && (
              <View
                pointerEvents="none"
                style={[st.thumb, { left: progress * trackW - THUMB / 2, borderColor: stateColor }]}
              />
            )}
          </View>
          <View style={st.timeRow}>
            <Text style={st.timeText}>{clock(playStart)}</Text>
            <Text style={st.timeText}>{clock(playEnd)}</Text>
          </View>

          {/* Controls */}
          <View style={st.controls}>
            <PressFeedback style={st.playBtn} onPress={togglePlay}>
              <Ionicons name={playing ? "pause" : "play"} size={22} color="#fff" />
            </PressFeedback>
            <PressFeedback style={st.speedBtn} onPress={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>
              <Text style={st.speedText}>{SPEEDS[speedIdx]}×</Text>
            </PressFeedback>
          </View>
        </>
      )}
    </View>
  );
}

const THUMB = 18;

const st = StyleSheet.create({
  container:  { alignSelf: "stretch", marginBottom: 12 },
  header:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  headerText: { flex: 1, fontSize: 14, color: "#333", lineHeight: 20, fontFamily: "Agrandir-Regular" },
  scoreBlock: { alignItems: "flex-end" },
  scoreValue: { fontSize: 28, lineHeight: 32, color: "#999", fontFamily: "Agrandir-GrandHeavy" },
  scoreLabel: { fontSize: 11, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },
  emptyText:  { fontSize: 14, color: colours.textSecondary, textAlign: "center", marginVertical: 12, fontFamily: "Agrandir-Regular" },

  stateStrip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10 },
  stateDot:   { width: 8, height: 8, borderRadius: 4 },
  stateText:  { flex: 1, fontSize: 13, fontFamily: "Agrandir-Regular" },
  stateClock: { fontSize: 13, color: "#666", fontFamily: "Agrandir-Regular" },

  figureScale: { alignItems: "center", transform: [{ scale: 0.8 }], marginVertical: -22 },

  scrubberHit: { height: 32, justifyContent: "center", marginTop: 4 },
  track:       { height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#F0F0F0" },
  unplayed:    { position: "absolute", top: 0, bottom: 0, right: 0, backgroundColor: "rgba(255,255,255,0.6)" },
  thumb: {
    position: "absolute", width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: "#fff", borderWidth: 3, top: (32 - THUMB) / 2,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  timeRow:  { flexDirection: "row", justifyContent: "space-between" },
  timeText: { fontSize: 11, color: colours.textSecondary, fontFamily: "Agrandir-Regular" },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 8 },
  playBtn:  { width: 48, height: 48, borderRadius: 24, backgroundColor: "#AB99FA", alignItems: "center", justifyContent: "center" },
  speedBtn: { minWidth: 48, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: "#AB99FA", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  speedText:{ fontSize: 14, color: "#AB99FA", fontFamily: "Agrandir-Regular" },
});
