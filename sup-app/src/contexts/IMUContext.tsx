/**
 * IMUContext.tsx
 *
 * Global singleton context for s'pot BLE state.
 *
 * Cumulative Postural Load (CPL) model — replaces per-state timers:
 *
 *   Based on Solomonow et al. (Spine 2003) and Kang & Mirka (2024):
 *   Short neutral breaks do NOT reset spinal creep. Creep developed
 *   during loading accumulates across multiple bouts with insufficient
 *   recovery between them. Recovery requires ~3x the loading duration.
 *
 *   CPL formula (runs every second):
 *     Non-neutral: CPL += STATE_WEIGHT[state]  (0.2–1.0 based on severity)
 *     Neutral:     CPL -= 0.15                 (slow recovery, 3:1 ratio)
 *     CPL clamped to [0, ∞)
 *
 *   This means a 1-minute neutral break after 5 minutes of slouching
 *   only reduces CPL by ~9 seconds of equivalent load — the next
 *   bad posture bout picks up from nearly the same level. This correctly
 *   models the cumulative tissue damage mechanism.
 *
 *   Intervention fires when CPL crosses a threshold:
 *     slouched/severe:  CPL ≥ 1200 (≈ 20 min equivalent at full weight)
 *     forward_lean:     CPL ≥ 900  (≈ 15 min equivalent)
 *     lateral:          CPL ≥ 900
 *
 * Other features:
 *   - EMA smoothing (α=0.15) on raw angles before classification
 *   - UI throttle (500ms) to prevent figure jitter
 *   - Neutral offset applied immediately after calibration step 1
 *   - Session start time tracked for desk time display
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import { BrandAlert, BrandAlertButton } from "../components/ui/BrandAlert";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Device } from "react-native-ble-plx";
import { bleService, SensorSlot, SensorState } from "../services/BLEService";
import { useAuth } from "./AuthContext";
import * as postureSync from "../services/posture/postureSyncService";
import { syncDayXp } from "../services/xp/xpService";
import { captureError, sentryBreadcrumb } from "../lib/sentry";
import { startTrackingService, stopTrackingService } from "../../modules/sup-foreground-service";
import {
  sendBackgroundAlert,
  dismissBackgroundAlerts,
  armSessionWatchdog,
  disarmSessionWatchdog,
} from "../services/reminder/pushNotificationService";
import {
  parseIMUPacket,
  createPostureStabilizer,
  ParsedIMU,
  ClinicalBaseline,
  NeutralOffset,
  PostureState,
  PostureSeverity,
  POSTURE_LABELS,
  POSTURE_CUES,
  INTERVENTION_MESSAGES,
  MOVEMENT_NUDGE,
  SHS_RATES,
  SHS_GRACE_PERIODS_MS,
  DEFAULT_SAGITTAL_SIGN,
  DEFAULT_LATERAL_SIGN,
} from "../lib/imuParser";
import { DeskPostureState } from "../components/desk/mockDeskPostureData";
import { toLocalDateKey } from "../lib/dateKey";

// ── Storage keys ──────────────────────────────────────────────────────────────

const BASELINE_STORAGE_KEY       = "sup_clinical_baseline_v2";
const NEUTRAL_OFFSET_STORAGE_KEY = "sup_neutral_offset_v1";
// The session currently being recorded. Removed when it's ended normally, so
// one still here on launch belongs to an app process that died mid-session.
const ACTIVE_SESSION_STORAGE_KEY = "sup_active_session_v1";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATIC_NUDGE_THRESHOLD_MS = 15 * 60 * 1000; // 15 min — fires regardless of posture quality, just staying static too long
const SHS_TICK_MS               = 1_000;
const DISPLAY_TICK_MS           = 10_000;
const TICK_CHECK_MS             = 250; // how often the foreground interval checks for due ticks
const SNAPSHOT_TICK_MS          = 20_000;
const EMA_ALPHA                 = 0.15;
const UI_THROTTLE_MS            = 500;

// Packets required from EACH s'pot (at ~10Hz) before classification is
// trusted enough to let calibration start — roughly half a second of real
// data. Prevents starting a calibration step's 3s sampling window before any
// packet has arrived, which would silently capture zero samples.
const READY_PACKET_THRESHOLD = 5;

// Kinds of pop-ups mirrored as notifications while backgrounded.
const NOTIF_INTERVENTION = "posture-intervention";
const NOTIF_MOVEMENT     = "movement-nudge";
const NOTIF_DISCONNECT   = "spot-disconnected"; // suffixed with the slot

// Safety net for tracking that stops without the user ending the session.
// While packets arrive, a notification is kept scheduled WATCHDOG_S seconds
// ahead and pushed back every WATCHDOG_REARM_MS. If the app dies (iOS
// terminating it, a crash) nothing pushes it back, so iOS delivers it. If the
// app is alive but the data goes quiet for STALL_END_MS with no disconnect
// event, the session is ended and saved here instead.
const WATCHDOG_S        = 90;
const WATCHDOG_REARM_MS = 20_000;
// How often the running session's totals are saved on the phone, so a
// relaunched app can carry on the same session (see ActiveSessionRecord).
const SESSION_PERSIST_MS = 5_000;
const STALL_END_MS      = 75_000;
const STALL_CHECK_MS    = 5_000;
const SESSION_STOPPED_TITLE = "your s'ession has ended";
const SESSION_STOPPED_BODY  = "your s'pots stopped sending data, so we saved your s'ession up to that point. open s'up to start tracking again.";

// How long posture must stay out of the alerted state before the s'train
// notification is cleared — ignores ~10Hz classification flicker at a boundary.
const STRAIN_MOVED_HOLD_MS = 5_000;

// Minimum raw angle delta (deg) during calibration steps 2 (lean forward) and
// 4 (lean right) before we trust its SIGN as evidence of the kit's mounting
// orientation. Below this, the delta is close enough to sensor noise that a
// "backwards" reading could just be an unclear/incomplete lean rather than a
// genuinely reversed s'pot — so we keep the previous/default sign and flag
// the step as low-confidence instead (CalibrationModal prompts to redo it).
const MIN_RELIABLE_ORIENTATION_DEG = 5;

// ── Cumulative Postural Load (CPL) ────────────────────────────────────────────
//
// Weight per second in each state (Solomonow et al. 2003 / Kang & Mirka 2024).
// upright recovers at 0.15/s regardless of state.
// Non-neutral states accumulate; recovery is ~3× slower than loading.

const CPL_WEIGHTS: Record<PostureState, number> = {
  upright:       0,    // neutral — handled by recovery rate
  transition:    0.2,  // early flexion — low accumulation
  forward_lean:  0.6,  // lumbar flexion, muscle fatigue
  slouched:      1.0,  // significant disc compression
  severe:        1.5,  // passive ligament zone — accumulates fastest
  tilted_left:   0.7,  // asymmetric disc loading
  tilted_right:  0.7,
};
const CPL_RECOVERY_RATE = 0.15; // pts/sec during neutral

// CPL thresholds for intervention (seconds of equivalent full-weight loading)
const CPL_THRESHOLDS: Partial<Record<PostureState, number>> = {
  forward_lean:  900,   // ≈ 15 min at full weight
  slouched:      1200,  // ≈ 20 min (McGill ligament creep threshold)
  severe:        300,   // ≈ 5 min — urgent
  tilted_left:   900,
  tilted_right:  900,
};

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The running session, saved on the phone every SESSION_PERSIST_MS while
 * data flows. If iOS terminates the app in the background, Bluetooth state
 * restoration relaunches it when the s'pots next send data; the new process
 * reads this and carries on the SAME session instead of starting a new one —
 * as long as it's back before the "session ended" notification the old
 * process left scheduled (watchdogFiresAt). Otherwise the user has already
 * been told the session ended, so it's closed and a new one starts.
 */
interface ActiveSessionRecord {
  sessionId: string;
  userId: string | null;
  startedAt: number;
  savedAt: number;
  watchdogFiresAt: number;
  shs: number;
  cpl: number;
  shsSum: number;
  shsTicks: number;
  minShs: number;
  maxCpl: number;
  upperSumScoreMs: number;
  upperSumMs: number;
  gapMs: number;
  stateTotals: postureSync.StateTotals;
  interventionFired: boolean;
}

function isResumable(rec: Partial<ActiveSessionRecord> | null): rec is ActiveSessionRecord {
  return !!rec &&
    typeof rec.sessionId === "string" &&
    typeof rec.startedAt === "number" &&
    typeof rec.savedAt === "number" &&
    typeof rec.watchdogFiresAt === "number" &&
    Date.now() < rec.watchdogFiresAt;
}

export interface IMUSensorData {
  latest: ParsedIMU | null;
  state: SensorState;
}

export interface PostureResult {
  state: DeskPostureState;
  instantScore: number;
  severity: PostureSeverity;
  label: string;
  description: string;
  pitchDiff: number;
  rollDiff: number;
}

export interface CalibrationState {
  currentStep: 1 | 2 | 3 | 4 | 5 | null;
  countdown: number | null;
  stepComplete: boolean[];
  isComplete: boolean;
  /**
   * Set to the step number (2 or 4) right after a capture whose lean was too
   * small to reliably tell which way the s'pot kit is oriented — the sign
   * used for that axis falls back to the previous/default value instead.
   * Cleared to null whenever a new step starts. CalibrationModal uses this
   * to prompt "lean further and redo this step."
   */
  lowConfidenceStep: number | null;
}

export interface InterventionAlert {
  state: PostureState;
  title: string;
  body: string;
  cue: string;
  /** CPL value when alert fired — for display */
  cplAtAlert: number;
}

export interface IMUContextValue {
  topSensor: IMUSensorData;
  bottomSensor: IMUSensorData;
  posture: PostureResult | null;
  bothConnected: boolean;
  /** Percent 0-100 derived from live top-sensor sagittal offset vs neutral (null if unavailable) */
  neckAlignmentPercent: number | null;
  /** Percent 0-100 derived from inter-s'pot lateral diff (null if unavailable) */
  shoulderBalancePercent: number | null;
  /** Time-weighted upper-back support percent (0-100) computed from per-packet instant scores */
  upperBackPercent: number | null;
  /**
   * True once BOTH s'pots have sent enough packets after connecting to trust
   * live classification. Gates calibration — starting a step before this is
   * true risks its 3s sampling window capturing zero packets and silently
   * failing. False again immediately on either slot disconnecting.
   */
  sensorsReady: boolean;

  discoveredDevices: Device[];
  isScanning: boolean;
  scan: () => Promise<void>;
  connect: (device: Device, slot: SensorSlot) => Promise<void>;
  disconnect: (slot: SensorSlot) => Promise<void>;
  disconnectAll: () => Promise<void>;
  /** Ends the current session but leaves the s'pots connected. */
  endSessionKeepConnected: () => void;
  /** Lets the next packet from connected s'pots start a fresh session. */
  startNewSession: () => void;

  calibration: CalibrationState;
  clinicalBaseline: ClinicalBaseline | null;
  isNeutralCalibrated: boolean;
  startCalibrationStep: (step: 1 | 2 | 3 | 4 | 5) => void;
  resetCalibration: () => void;

  shs: number;
  /**
   * Cumulative Postural Load (0–∞).
   * Accumulates across multiple bad posture bouts.
   * Short neutral breaks barely dent it (3:1 recovery ratio).
   * Use for intervention threshold checks and UI display.
   */
  cpl: number;
  timeInCurrentStateMs: number;
  /** How long the s'pots have been connected this session (ms) */
  sessionDurationMs: number;
  /** Session start timestamp (ms since epoch) — null if not started */
  sessionStartTimeMs: number | null;
  shouldNudge: boolean;
  activeIntervention: InterventionAlert | null;
  confirmMovement: () => void;
  dismissIntervention: (moved: boolean) => void;
  /** Called by useSessionStats each tick to keep state_totals current for endSession */
  setSessionStateTotals: (totals: postureSync.StateTotals) => void;
  /** useSessionStats registers its tick here so packets can drive it while timers are stalled */
  registerStatsTick: (fn: ((state: DeskPostureState) => void) | null) => void;
  /**
   * SessionLiveNotification registers here to get every packet's confirmed
   * posture straight away — including in the background, where `posture`
   * (React state) isn't updated. Refs only, no re-render.
   */
  registerLiveStatus: (fn: LiveStatusListener | null) => void;
}

export type LiveStatusListener = (update: { state: DeskPostureState; sessionStartTimeMs: number | null }) => void;

// ── Defaults ──────────────────────────────────────────────────────────────────

const defaultSensorState: SensorState = {
  connected: false,
  deviceId: null,
  deviceName: null,
};

const defaultSensorData: IMUSensorData = {
  latest: null,
  state: defaultSensorState,
};

const defaultCalibration: CalibrationState = {
  currentStep: null, countdown: null,
  stepComplete: [false, false, false, false, false],
  isComplete: false,
  lowConfidenceStep: null,
};

interface EMAState {
  topRoll: number; topPitch: number;
  bottomRoll: number; bottomPitch: number;
  initialised: boolean;
}

// ── Context ───────────────────────────────────────────────────────────────────

const IMUContext = createContext<IMUContextValue | null>(null);

export function IMUProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [topData,    setTopData]    = useState<IMUSensorData>(defaultSensorData);
  const [bottomData, setBottomData] = useState<IMUSensorData>(defaultSensorData);
  const [posture,    setPosture]    = useState<PostureResult | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<Device[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationState>(defaultCalibration);
  const [clinicalBaseline, setClinicalBaseline] = useState<ClinicalBaseline | null>(null);
  const [isNeutralCalibrated, setIsNeutralCalibrated] = useState(false);

  const [shs,                  setShs]                  = useState(100);
  const [cpl,                  setCpl]                  = useState(0);
  const [timeInCurrentStateMs, setTimeInCurrentStateMs] = useState(0);
  const [sessionDurationMs,    setSessionDurationMs]    = useState(0);
  const [sessionStartTimeMs,   setSessionStartTimeMs]   = useState<number | null>(null);
  // State mirror of sessionEndedRef — drives the Android foreground service
  const [sessionEnded,         setSessionEnded]         = useState(false);
  const [shouldNudge,          setShouldNudge]          = useState(false);
  const [activeIntervention,   setActiveIntervention]   = useState<InterventionAlert | null>(null);
  const [neckAlignmentPercent, setNeckAlignmentPercent] = useState<number | null>(null);
  const [shoulderBalancePercent, setShoulderBalancePercent] = useState<number | null>(null);
  const [upperBackPercent, setUpperBackPercent] = useState<number | null>(null);
  // True once BOTH s'pots have sent enough packets to trust classification —
  // gates the calibration UI so a step can't be started before real data is
  // flowing (previously: starting immediately after connect could sample zero
  // packets during the 3s capture window and silently fail with no error).
  const [sensorsReady, setSensorsReady] = useState(false);

  // On-brand replacement for native Alert.alert on s'pot disconnect notices.
  const [brandAlert, setBrandAlert] = useState<{
    title: string;
    message?: string;
    buttons: BrandAlertButton[];
    dismissable?: boolean;
  } | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────

  const topLatestRef     = useRef<ParsedIMU | null>(null);
  const bottomLatestRef  = useRef<ParsedIMU | null>(null);
  const topPacketCountRef    = useRef(0);
  const bottomPacketCountRef = useRef(0);
  const sensorsReadyRef      = useRef(false);
  const neutralOffsetRef = useRef<NeutralOffset | null>(null);
  const baselineRef      = useRef<ClinicalBaseline | null>(null);
  const userIdRef        = useRef<string | null>(userId);

  const emaRef = useRef<EMAState>({
    topRoll: 0, topPitch: 0, bottomRoll: 0, bottomPitch: 0, initialised: false,
  });
  const lastUIUpdateRef         = useRef<number>(0);
  const postureStabilizerRef    = useRef(createPostureStabilizer());

  const stateStartTimeRef       = useRef<number>(Date.now());
  const lastPostureStateRef     = useRef<PostureState | null>(null);
  const interventionFiredRef    = useRef(false);
  const staticNudgeFiredRef     = useRef(false);
  const staticStartTimeRef      = useRef<number>(Date.now());
  const sessionStartTimeRef     = useRef<number | null>(null); // set on first packet after connect
  const sessionIdRef            = useRef<string | null>(null);
  // True from the moment a session is deliberately ended until the s'pots
  // reconnect / the app returns to the foreground. Stops in-flight packets
  // that arrive during BLE teardown from spawning a phantom new session.
  const sessionEndedRef         = useRef(false);
  // Cumulative time (ms) the s'pots were disconnected during the current
  // session, plus the start of the gap currently in progress (or null). Used
  // to subtract dead time from total_duration_ms so it matches the tracked
  // time in state_totals.
  const sessionGapMsRef         = useRef(0);
  const disconnectedAtRef       = useRef<number | null>(null);
  const shsRef                  = useRef(100);
  const cplRef                  = useRef(0);
  const sessionShsSumRef        = useRef<number>(0);
  const sessionShsTickCountRef  = useRef<number>(0);
  const sessionMinShsRef        = useRef<number>(100);
  const sessionMaxCplRef        = useRef<number>(0);
  const sessionStateTotalsRef   = useRef<postureSync.StateTotals>({});
  const statsTickRef            = useRef<((state: DeskPostureState) => void) | null>(null);
  const liveStatusRef           = useRef<LiveStatusListener | null>(null);
  const lastSnapshotAtRef       = useRef(0);
  const shsIntervalRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastShsTickAtRef        = useRef<number>(Date.now());
  const lastDisplayTickAtRef    = useRef<number>(Date.now());
  // Background notifications that may still be in the tray, so they can be
  // cleared once no longer relevant without querying the tray every packet.
  const strainNotifStateRef     = useRef<PostureState | null>(null); // posture the s'train alert fired for
  const strainMovedSinceRef     = useRef<number | null>(null);
  const nudgeNotifPendingRef    = useRef(false);
  // Upper-back accumulators for time-weighted averaging
  const upperSumScoreMsRef      = useRef<number>(0);
  const upperSumMsRef           = useRef<number>(0);
  const lastPacketTimestampRef  = useRef<number | null>(null);
  // Live percents, computed per packet but only pushed to React state on the
  // UI throttle while the app is on screen.
  const neckPctRef              = useRef<number | null>(null);
  const shoulderPctRef          = useRef<number | null>(null);
  // Whether the app is on screen. All per-packet / per-tick React state
  // updates are skipped while false — see the packet handler.
  const appActiveRef            = useRef(AppState.currentState === "active");
  // Last time a packet from BOTH s'pots fed the session, and last time the
  // session watchdog notification was pushed back.
  const lastSessionPacketAtRef  = useRef<number | null>(null);
  const lastWatchdogArmAtRef    = useRef(0);
  const watchdogFiresAtRef      = useRef(0);
  const lastPersistAtRef        = useRef(0);
  // True once calibration and any session left by a previous app process
  // have been loaded. Packets are ignored until then, so a background
  // relaunch can't start classifying with no calibration, or start a fresh
  // session before it has had the chance to resume the old one.
  const bootReadyRef            = useRef(false);
  const bootStartedRef          = useRef(false);
  // A session left by a previous process that can still be resumed.
  const resumableRef            = useRef<ActiveSessionRecord | null>(null);
  // Serialises the active-session record's writes and removal so a late
  // write can't resurrect a session that was just ended.
  const sessionStoreChainRef    = useRef<Promise<unknown>>(Promise.resolve());
  const sessionRowPendingRef    = useRef(false);

  const captureRef = useRef<{
    neutral: NeutralOffset | null;
    maxForward: number | null; maxBackward: number | null;
    maxRight: number | null;   maxLeft: number | null;
    // Detected during steps 2/4 from the sign of the raw lean — null until a
    // reliable (>= MIN_RELIABLE_ORIENTATION_DEG) lean has been captured.
    sagittalSign: 1 | -1 | null;
    lateralSign:  1 | -1 | null;
  }>({
    neutral: null, maxForward: null, maxBackward: null, maxRight: null, maxLeft: null,
    sagittalSign: null, lateralSign: null,
  });

  const resetPostureStability = useCallback(() => {
    postureStabilizerRef.current.reset();
    lastPostureStateRef.current = null;
    lastUIUpdateRef.current = 0;
    setPosture(null);
  }, []);

  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Pushes the ref-held live readings into React state. Called on the UI
  // throttle while on screen, and once on returning to the foreground.
  const publishLiveMetrics = useCallback(() => {
    setTopData((prev) => (prev.latest === topLatestRef.current ? prev : { ...prev, latest: topLatestRef.current }));
    setBottomData((prev) => (prev.latest === bottomLatestRef.current ? prev : { ...prev, latest: bottomLatestRef.current }));
    if (upperSumMsRef.current > 0) {
      const pct = upperSumScoreMsRef.current / upperSumMsRef.current;
      setUpperBackPercent(Math.round(Math.max(0, Math.min(100, pct))));
    }
    if (neckPctRef.current !== null) setNeckAlignmentPercent(neckPctRef.current);
    if (shoulderPctRef.current !== null) setShoulderBalancePercent(shoulderPctRef.current);
  }, []);

  // Catches the screen up with everything that was tracked on refs while the
  // app was in the background.
  const flushUIFromRefs = useCallback(() => {
    publishLiveMetrics();
    setShs(Math.round(shsRef.current));
    setCpl(Math.round(cplRef.current));
    setTimeInCurrentStateMs(Date.now() - stateStartTimeRef.current);
    if (sessionStartTimeRef.current !== null) {
      setSessionDurationMs(Date.now() - sessionStartTimeRef.current);
    }
    lastUIUpdateRef.current = 0; // next packet refreshes posture immediately
  }, [publishLiveMetrics]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const active = next === "active";
      if (active && !appActiveRef.current) flushUIFromRefs();
      appActiveRef.current = active;
    });
    return () => sub.remove();
  }, [flushUIFromRefs]);

  // ── Load persisted data on mount ──────────────────────────────────────────

  // ── Active-session record (resume after relaunch) ───────────────────────

  const queueSessionStore = useCallback((op: () => Promise<unknown>) => {
    sessionStoreChainRef.current = sessionStoreChainRef.current.then(op).catch(() => {});
    return sessionStoreChainRef.current;
  }, []);

  const persistActiveSession = useCallback(() => {
    const sessionId = sessionIdRef.current;
    const startedAt = sessionStartTimeRef.current;
    if (!sessionId || startedAt === null) return;
    lastPersistAtRef.current = Date.now();
    const rec: ActiveSessionRecord = {
      sessionId,
      userId:            userIdRef.current,
      startedAt,
      savedAt:           Date.now(),
      watchdogFiresAt:   watchdogFiresAtRef.current,
      shs:               shsRef.current,
      cpl:               cplRef.current,
      shsSum:            sessionShsSumRef.current,
      shsTicks:          sessionShsTickCountRef.current,
      minShs:            sessionMinShsRef.current,
      maxCpl:            sessionMaxCplRef.current,
      upperSumScoreMs:   upperSumScoreMsRef.current,
      upperSumMs:        upperSumMsRef.current,
      gapMs:             sessionGapMsRef.current,
      stateTotals:       sessionStateTotalsRef.current,
      interventionFired: interventionFiredRef.current,
    };
    queueSessionStore(() => AsyncStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(rec)));
  }, [queueSessionStore]);

  const clearActiveSession = useCallback(() => {
    queueSessionStore(() => AsyncStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY));
  }, [queueSessionStore]);

  // A session left by a process that died, and that can't (or didn't) get
  // resumed. Its data is already in Supabase from the last snapshot — mark it
  // completed so it counts as a finished session, and rebuild that day.
  const closeOrphanedRecord = useCallback((rec: Partial<ActiveSessionRecord>) => {
    const sessionId = rec.sessionId;
    if (!sessionId) return;
    sentryBreadcrumb("closing session orphaned by app termination", { sessionId });
    (async () => {
      const closed = await postureSync.closeOrphanedSession(sessionId);
      if (!closed) return; // keep the record so the next launch retries
      await queueSessionStore(async () => {
        const raw = await AsyncStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
        const current = raw ? JSON.parse(raw) : null;
        if (current?.sessionId === sessionId) await AsyncStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      });
      if (rec.userId) {
        const dateKey = toLocalDateKey(new Date(rec.startedAt ?? Date.now()));
        postureSync.rebuildDailyFromSessions(rec.userId, dateKey);
      }
    })().catch((e) => captureError(e, "posture-orphan-recover"));
  }, [queueSessionStore]);

  // Creates the Supabase row for the running session if it doesn't have one
  // yet. Retried from the snapshot tick, since on a background relaunch the
  // first packets can arrive before the login has loaded (or the network is
  // briefly unavailable) and the first attempt then has nothing to attach to.
  const ensureSessionRow = useCallback(() => {
    if (sessionIdRef.current || sessionRowPendingRef.current) return;
    const startedAt = sessionStartTimeRef.current;
    const uid = userIdRef.current;
    if (startedAt === null || !uid) return;
    sessionRowPendingRef.current = true;
    postureSync.startSession(uid, startedAt).then((id) => {
      sessionRowPendingRef.current = false;
      if (sessionStartTimeRef.current !== startedAt || !id) return; // session changed meanwhile
      sessionIdRef.current = id;
      sentryBreadcrumb("posture session started", { sessionId: id });
      persistActiveSession();
    });
  }, [persistActiveSession]);

  // ── Load persisted data on mount ──────────────────────────────────────────

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(BASELINE_STORAGE_KEY);
        if (raw) {
          const saved: ClinicalBaseline = JSON.parse(raw);
          baselineRef.current      = saved;
          neutralOffsetRef.current = saved.neutral;
          resetPostureStability();
          setClinicalBaseline(saved);
          setIsNeutralCalibrated(true);
          setCalibration((prev) => ({
            ...prev, stepComplete: [true, true, true, true, true], isComplete: true,
          }));
        }
      } catch (e) {
        console.warn("[IMUContext] Failed to load baseline:", e);
      }

      try {
        const raw = await AsyncStorage.getItem(NEUTRAL_OFFSET_STORAGE_KEY);
        if (raw && !neutralOffsetRef.current) {
          const saved: NeutralOffset = JSON.parse(raw);
          neutralOffsetRef.current = saved;
          resetPostureStability();
          setIsNeutralCalibrated(true);
          setCalibration((prev) => {
            const updated = [...prev.stepComplete]; updated[0] = true;
            return { ...prev, stepComplete: updated };
          });
        }
      } catch (e) {
        console.warn("[IMUContext] Failed to load neutral offset:", e);
      }

      // A session still saved here belongs to an app process that died
      // mid-session (iOS terminated it, a crash).
      try {
        const raw = await AsyncStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
        const rec: Partial<ActiveSessionRecord> | null = raw ? JSON.parse(raw) : null;
        if (rec?.sessionId) {
          if (isResumable(rec)) {
            // Resumed by the first packet if the s'pots are back in time;
            // past that point the user has been told it ended, so close it.
            resumableRef.current = rec;
            setTimeout(() => {
              if (resumableRef.current !== rec) return;
              resumableRef.current = null;
              closeOrphanedRecord(rec);
            }, Math.max(0, rec.watchdogFiresAt - Date.now()));
          } else {
            closeOrphanedRecord(rec);
          }
        }
      } catch (e) {
        captureError(e, "posture-orphan-recover");
      }

      bootReadyRef.current = true;
    })();
  }, [resetPostureStability, closeOrphanedRecord]);

  // ── SHS + CPL accumulation — ticks every second ───────────────────────────
  //
  // CPL model (Solomonow et al. 2003):
  //   Non-neutral: CPL += weight/sec  (depends on state severity)
  //   Neutral:     CPL -= 0.15/sec   (slow 3:1 recovery ratio)
  //
  // This means brief neutral breaks barely reduce CPL, correctly modelling
  // how spinal creep accumulates across multiple loading bouts.

  const shsTick = useCallback(() => {
    const state = lastPostureStateRef.current;
    if (!state) return;

    // ── SHS ──
    const rate        = SHS_RATES[state] ?? 0;
    const gracePeriod = SHS_GRACE_PERIODS_MS[state] ?? 0;
    const stateElapsed = Date.now() - stateStartTimeRef.current;
    if (rate > 0 || stateElapsed >= gracePeriod) {
      const newShs = Math.max(0, Math.min(100, shsRef.current + rate));
      shsRef.current = newShs;
      if (appActiveRef.current) setShs(Math.round(newShs));
    }

    // ── CPL ──
    let newCpl: number;
    if (state === "upright") {
      newCpl = Math.max(0, cplRef.current - CPL_RECOVERY_RATE);
    } else {
      newCpl = cplRef.current + (CPL_WEIGHTS[state] ?? 0);
    }
    cplRef.current = newCpl;
    if (appActiveRef.current) setCpl(Math.round(newCpl));
    sessionShsSumRef.current += shsRef.current;
    sessionShsTickCountRef.current += 1;
    sessionMinShsRef.current = Math.min(sessionMinShsRef.current, shsRef.current);
    sessionMaxCplRef.current = Math.max(sessionMaxCplRef.current, newCpl);

    // Check CPL intervention threshold for current state
    const cplThreshold = CPL_THRESHOLDS[state];
    if (cplThreshold !== undefined && newCpl >= cplThreshold && !interventionFiredRef.current) {
      interventionFiredRef.current = true;
      const msg = INTERVENTION_MESSAGES[state];
      if (msg) {
        setActiveIntervention({ state, ...msg, cplAtAlert: Math.round(newCpl) });
        sendBackgroundAlert(NOTIF_INTERVENTION, msg.title, `${msg.body}\n\n${msg.cue}`);
        strainNotifStateRef.current = state;
        strainMovedSinceRef.current = null;
        // PHONE: Vibration.vibrate([0, 400, 100, 400, 100, 400]);
        // FUTURE S'POT HAPTIC: bleService.sendHapticPulse("top")
        console.log("[IMUContext] CPL intervention fired for", state, "CPL:", Math.round(newCpl));
      }
    }
  }, []);

  // ── Display timer — ticks every 10 seconds ────────────────────────────────

  const displayTick = useCallback(() => {
    // Current state duration
    if (appActiveRef.current) {
      setTimeInCurrentStateMs(Date.now() - stateStartTimeRef.current);
      if (sessionStartTimeRef.current !== null) {
        setSessionDurationMs(Date.now() - sessionStartTimeRef.current);
      }
    }

    // Static movement nudge (any posture held too long)
    // Only while posture is live — null when a s'pot is disconnected or no
    // session is running. The timer restarts when posture resumes, since
    // null → state counts as a state change in the packet handler.
    const staticElapsed = Date.now() - staticStartTimeRef.current;
    if (lastPostureStateRef.current !== null && staticElapsed >= STATIC_NUDGE_THRESHOLD_MS && !staticNudgeFiredRef.current) {
      staticNudgeFiredRef.current = true;
      setShouldNudge(true);
      sendBackgroundAlert(NOTIF_MOVEMENT, MOVEMENT_NUDGE.title, `${MOVEMENT_NUDGE.body}\n\n${MOVEMENT_NUDGE.cue}`);
      nudgeNotifPendingRef.current = true;
      // PHONE: Vibration.vibrate([0, 300, 100, 300]);
      // FUTURE S'POT HAPTIC: bleService.sendHapticPulse("top")
      console.log("[IMUContext] static nudge fired");
    }
  }, []);

  const clearStrainNotifs = useCallback(() => {
    strainNotifStateRef.current = null;
    strainMovedSinceRef.current = null;
    dismissBackgroundAlerts(NOTIF_INTERVENTION);
  }, []);

  const clearNudgeNotifs = useCallback(() => {
    if (!nudgeNotifPendingRef.current) return;
    nudgeNotifPendingRef.current = false;
    dismissBackgroundAlerts(NOTIF_MOVEMENT);
  }, []);

  // RN pauses JS timers while the app is backgrounded (Android and iOS), but
  // BLE packets keep arriving — so the ticks above are also driven from the
  // packet handler. Each tick is time-gated here so the interval and packets
  // never double-count.
  const runDueTicks = useCallback(() => {
    const now = Date.now();
    const sinceShs = now - lastShsTickAtRef.current;
    if (sinceShs >= SHS_TICK_MS) {
      // Step exactly one tick to hold 1/s; after a long gap, resync rather
      // than back-fill time whose posture is unknown.
      lastShsTickAtRef.current = sinceShs >= 2 * SHS_TICK_MS ? now : lastShsTickAtRef.current + SHS_TICK_MS;
      shsTick();
    }
    if (now - lastDisplayTickAtRef.current >= DISPLAY_TICK_MS) {
      lastDisplayTickAtRef.current = now;
      displayTick();
    }

    // Clear s'train notifications once posture has held away from the
    // alerted state (a disconnect, i.e. null posture, doesn't count as moving).
    const alerted = strainNotifStateRef.current;
    if (alerted !== null) {
      const state = lastPostureStateRef.current;
      if (state === null || state === alerted) {
        strainMovedSinceRef.current = null;
      } else if (strainMovedSinceRef.current === null) {
        strainMovedSinceRef.current = now;
      } else if (now - strainMovedSinceRef.current >= STRAIN_MOVED_HOLD_MS) {
        clearStrainNotifs();
      }
    }
  }, [shsTick, displayTick, clearStrainNotifs]);

  useEffect(() => {
    shsIntervalRef.current = setInterval(runDueTicks, TICK_CHECK_MS);
    return () => { if (shsIntervalRef.current) clearInterval(shsIntervalRef.current); };
  }, [runDueTicks]);

  // App backgrounding no longer ends the session — s'pots keep streaming and
  // accumulating SHS/CPL while backgrounded (react-native-ble-plx is
  // configured with isBackgroundEnabled/central mode for this). The session
  // now only ends via endCurrentSession(): manual disconnect, the "end
  // s'ession" button, or "end session" from the reconnect prompt.

  const computeSessionAggregates = useCallback((): postureSync.SessionAggregates => {
    const tickCount = sessionShsTickCountRef.current;

    // Duration excludes time the s'pots were disconnected — banked gaps plus a
    // gap still open right now (mid-session, or the session ended while
    // disconnected). This keeps total_duration_ms in step with the tracked
    // time in state_totals.
    const now      = Date.now();
    const openGapMs = disconnectedAtRef.current !== null ? now - disconnectedAtRef.current : 0;
    const rawMs     = sessionStartTimeRef.current ? now - sessionStartTimeRef.current : 0;
    const trackedMs = Math.max(0, rawMs - sessionGapMsRef.current - openGapMs);

    return {
      avgShs: tickCount > 0 ? sessionShsSumRef.current / tickCount : null,
      minShs: sessionMinShsRef.current,
      maxCpl: sessionMaxCplRef.current,
      avgInstantScore: upperSumMsRef.current > 0 ? upperSumScoreMsRef.current / upperSumMsRef.current : null,
      totalDurationMs: trackedMs,
      stateTotals: sessionStateTotalsRef.current,
    };
  }, []);

  const finalizeSession = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    sentryBreadcrumb("posture session ended", { sessionId });

    // posture_daily groups sessions by the local day they STARTED on, so a
    // session that runs past midnight is rebuilt under its start day.
    const todayDK = toLocalDateKey(new Date(sessionStartTimeRef.current ?? Date.now()));
    const uid     = userIdRef.current;

    postureSync.endSession(sessionId, computeSessionAggregates());
    clearActiveSession();

    sessionIdRef.current          = null;
    sessionStateTotalsRef.current = {};
    sessionGapMsRef.current       = 0;
    disconnectedAtRef.current     = null;

    // Rebuild posture_daily after a short delay to ensure endSession has written to DB,
    // then recalculate that day's XP from the new session time (docs/xp.md).
    if (uid) {
      setTimeout(() => {
        void postureSync.rebuildDailyFromSessions(uid, todayDK).then(() => syncDayXp(uid, todayDK));
      }, 5000);
    }
  }, [computeSessionAggregates, clearActiveSession]);

  const snapshotCurrentSession = useCallback(() => {
    lastSnapshotAtRef.current = Date.now();
    const sessionId = sessionIdRef.current;
    if (!sessionId) { ensureSessionRow(); return; }
    postureSync.snapshotSession(sessionId, computeSessionAggregates());
  }, [computeSessionAggregates, ensureSessionRow]);

  // Deliberate end of the current session: writes it to Supabase
  // (finalizeSession) AND clears the local session timer so a brand-new
  // session starts on the next packet. Used for a manual disconnect and the
  // "end s'ession" button (including from the disconnect prompt). NOT used
  // for an unexpected drop the user might still reconnect through — that
  // path deliberately leaves the timer running so "reconnect s'pot" resumes
  // the same session.
  const endCurrentSession = useCallback(() => {
    resumableRef.current = null;
    finalizeSession();
    resetPostureStability();
    disarmSessionWatchdog();
    lastSessionPacketAtRef.current = null;
    lastWatchdogArmAtRef.current   = 0;
    sessionStartTimeRef.current = null;
    sessionEndedRef.current = true;
    setSessionEnded(true);
    setSessionStartTimeMs(null);
    setSessionDurationMs(0);
  }, [finalizeSession, resetPostureStability]);

  useEffect(() => {
    const interval = setInterval(snapshotCurrentSession, SNAPSHOT_TICK_MS);
    return () => clearInterval(interval);
  }, [snapshotCurrentSession]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "background") {
        sentryBreadcrumb("app backgrounded — flushing session snapshot", { sessionId: sessionIdRef.current });
        snapshotCurrentSession();
      }
    });
    return () => sub.remove();
  }, [snapshotCurrentSession]);

  // ── BLE callbacks ─────────────────────────────────────────────────────────

  useEffect(() => {
    bleService.setCallbacks(
      (slot, dataView) => {
        const parsed = parseIMUPacket(dataView);
        if (!parsed) return;

        if (slot === "top") {
          topLatestRef.current = parsed;
          topPacketCountRef.current += 1;
        } else {
          bottomLatestRef.current = parsed;
          bottomPacketCountRef.current += 1;
        }

        // Flip once, the first time both slots have enough packets — using a
        // ref (not the sensorsReady state) since this closure is captured
        // once at mount and would otherwise read a stale value.
        if (
          !sensorsReadyRef.current &&
          topPacketCountRef.current    >= READY_PACKET_THRESHOLD &&
          bottomPacketCountRef.current >= READY_PACKET_THRESHOLD
        ) {
          sensorsReadyRef.current = true;
          setSensorsReady(true);
        }

        const top    = slot === "top"    ? parsed : topLatestRef.current;
        const bottom = slot === "bottom" ? parsed : bottomLatestRef.current;
        if (!top || !bottom) return;

        // A session was just deliberately ended — ignore any packets still
        // draining out of the BLE stack during teardown so they can't spawn a
        // phantom session. Cleared when the s'pots make a fresh connection.
        if (sessionEndedRef.current) return;

        // Calibration / a resumable session are still loading (the first
        // fraction of a second after launch) — see bootReadyRef.
        if (!bootReadyRef.current) return;

        // Both slots are streaming again after a mid-session disconnect —
        // bank the dead gap so it's excluded from total_duration_ms.
        if (disconnectedAtRef.current !== null) {
          sessionGapMsRef.current += Date.now() - disconnectedAtRef.current;
          disconnectedAtRef.current = null;
        }

        // First packet of a session: carry on the one a previous app process
        // was recording if it's still resumable, otherwise start a new one.
        const resumable = sessionStartTimeRef.current === null ? resumableRef.current : null;
        if (resumable) resumableRef.current = null;
        if (resumable && isResumable(resumable)) {
          const now = Date.now();
          sessionStartTimeRef.current    = resumable.startedAt;
          sessionIdRef.current           = resumable.sessionId;
          setSessionStartTimeMs(resumable.startedAt);
          shsRef.current                 = resumable.shs;
          cplRef.current                 = resumable.cpl;
          sessionShsSumRef.current       = resumable.shsSum;
          sessionShsTickCountRef.current = resumable.shsTicks;
          sessionMinShsRef.current       = resumable.minShs;
          sessionMaxCplRef.current       = resumable.maxCpl;
          upperSumScoreMsRef.current     = resumable.upperSumScoreMs;
          upperSumMsRef.current          = resumable.upperSumMs;
          sessionStateTotalsRef.current  = resumable.stateTotals ?? {};
          interventionFiredRef.current   = resumable.interventionFired;
          // Nothing was tracked between the last save and now.
          sessionGapMsRef.current        = resumable.gapMs + Math.max(0, now - resumable.savedAt);
          disconnectedAtRef.current      = null;
          lastPacketTimestampRef.current = now;
          if (appActiveRef.current) { setShs(Math.round(resumable.shs)); setCpl(Math.round(resumable.cpl)); }
          sentryBreadcrumb("posture session resumed after relaunch", {
            sessionId: resumable.sessionId, gapMs: now - resumable.savedAt,
          });
        } else if (sessionStartTimeRef.current === null) {
          if (resumable) closeOrphanedRecord(resumable);
          sessionStartTimeRef.current = Date.now();
          setSessionStartTimeMs(sessionStartTimeRef.current);
          console.log("[IMUContext] session started at", new Date(sessionStartTimeRef.current).toISOString());
          // reset upper-back accumulators for new session
          upperSumScoreMsRef.current = 0;
          upperSumMsRef.current = 0;
          lastPacketTimestampRef.current = Date.now();
          sessionShsSumRef.current = 0;
          sessionShsTickCountRef.current = 0;
          sessionMinShsRef.current = 100;
          sessionMaxCplRef.current = 0;
          sessionGapMsRef.current = 0;
          disconnectedAtRef.current = null;

          ensureSessionRow();
        }

        // Data is flowing — keep the "session stopped" notification pushed out.
        const pktAt = Date.now();
        lastSessionPacketAtRef.current = pktAt;
        if (pktAt - lastWatchdogArmAtRef.current >= WATCHDOG_REARM_MS) {
          lastWatchdogArmAtRef.current = pktAt;
          watchdogFiresAtRef.current   = pktAt + WATCHDOG_S * 1000;
          armSessionWatchdog(WATCHDOG_S, SESSION_STOPPED_TITLE, SESSION_STOPPED_BODY);
          persistActiveSession();
        } else if (pktAt - lastPersistAtRef.current >= SESSION_PERSIST_MS) {
          persistActiveSession();
        }

        // EMA smoothing
        const ema = emaRef.current;
        if (!ema.initialised) {
          ema.topRoll = top.angle.roll; ema.topPitch = top.angle.pitch;
          ema.bottomRoll = bottom.angle.roll; ema.bottomPitch = bottom.angle.pitch;
          ema.initialised = true;
        } else {
          ema.topRoll     = EMA_ALPHA * top.angle.roll     + (1 - EMA_ALPHA) * ema.topRoll;
          ema.topPitch    = EMA_ALPHA * top.angle.pitch    + (1 - EMA_ALPHA) * ema.topPitch;
          ema.bottomRoll  = EMA_ALPHA * bottom.angle.roll  + (1 - EMA_ALPHA) * ema.bottomRoll;
          ema.bottomPitch = EMA_ALPHA * bottom.angle.pitch + (1 - EMA_ALPHA) * ema.bottomPitch;
        }

        const smoothedTop: ParsedIMU    = { ...top,    angle: { ...top.angle,    roll: ema.topRoll,    pitch: ema.topPitch    } };
        const smoothedBottom: ParsedIMU = { ...bottom, angle: { ...bottom.angle, roll: ema.bottomRoll, pitch: ema.bottomPitch } };

        const offsetToUse = baselineRef.current ?? neutralOffsetRef.current;
        const result = postureStabilizerRef.current.update(
          smoothedTop, smoothedBottom, offsetToUse, Date.now(),
        );
        // --- Upper-back time-weighted accumulation (per-packet) ---
        try {
          const pktNow = Date.now();
          const last = lastPacketTimestampRef.current ?? pktNow;
          const dt = Math.max(0, pktNow - last);
          lastPacketTimestampRef.current = pktNow;

          const instant = result.instantScore ?? 0; // 0-100
          upperSumScoreMsRef.current += instant * dt;
          upperSumMsRef.current += dt;
        } catch (e) {
          // defensive
        }
        // Neck alignment and shoulder balance percents from live, offset-corrected
        // angles — computed into refs here, published on the UI throttle below.
        try {
          const neutral = offsetToUse ? ("neutral" in offsetToUse ? offsetToUse.neutral : offsetToUse) : null;
          const topNeutralRoll = neutral ? neutral.topRoll : 0;
          const topRollDelta = smoothedTop.angle.roll - topNeutralRoll;
          const NECK_TOLERANCE_DEG = 12; // 12° maps to ~0% alignment
          const neckPct = Math.max(0, Math.min(100, 100 - (Math.abs(topRollDelta) / NECK_TOLERANCE_DEG) * 100));
          neckPctRef.current = Math.round(neckPct);

          const rollDiffDeg = result.rollDiff ?? 0;
          const LATERAL_MAX_DEG = 8; // matches imuParser lateral threshold
          const shoulderPct = Math.max(0, Math.min(100, 100 - (Math.abs(rollDiffDeg) / LATERAL_MAX_DEG) * 100));
          shoulderPctRef.current = Math.round(shoulderPct);
        } catch (e) {
          // defensive: do not crash the BLE handler
        }

        // All consumers use the same confirmed state, including scores and timers.
        if (result.state !== lastPostureStateRef.current) {
          lastPostureStateRef.current  = result.state;
          stateStartTimeRef.current    = Date.now();
          staticStartTimeRef.current   = Date.now();
          staticNudgeFiredRef.current  = false;
          if (appActiveRef.current) setTimeInCurrentStateMs(0);
          setShouldNudge(false);
          // Clear the movement nudge notification after a confirmed posture change.
          clearNudgeNotifs();

          // An active intervention still requires the user's explicit answer;
          // even a confirmed posture change must not dismiss it automatically.

          // Reset intervention fired flag when state changes
          // BUT only reset if CPL drops below 80% of threshold
          // This prevents immediate re-trigger on brief state flicker
          const newThreshold = CPL_THRESHOLDS[result.state];
          if (!newThreshold || cplRef.current < newThreshold * 0.8) {
            interventionFiredRef.current = false;
          }

          // Force UI update on state change (bypass throttle)
          lastUIUpdateRef.current = 0;
        }

        // Keeps SHS/CPL, alerts and the nudge running while backgrounded
        runDueTicks();

        // Same for the per-state stats and the Supabase snapshot: their
        // intervals stall in the background once the screen is off, but
        // packets keep arriving (Android foreground service / iOS BLE mode).
        statsTickRef.current?.(result.state as DeskPostureState);
        if (Date.now() - lastSnapshotAtRef.current >= SNAPSHOT_TICK_MS) snapshotCurrentSession();
        // Live session notification (Android): fed per packet so it updates
        // instantly and keeps updating while backgrounded.
        liveStatusRef.current?.({ state: result.state as DeskPostureState, sessionStartTimeMs: sessionStartTimeRef.current });

        // Everything below only feeds the screen. While backgrounded nobody can
        // see it, and re-rendering the app's whole context tree ~20×/s on the
        // throttled background CPU is what got iOS to kill the app
        // (cpu_resource_fatal: >80% CPU over 60s). Tracking above keeps
        // running on refs; flushUIFromRefs() catches the UI up on foreground.
        if (!appActiveRef.current) return;

        // UI throttle
        const now = Date.now();
        if (now - lastUIUpdateRef.current < UI_THROTTLE_MS) return;
        lastUIUpdateRef.current = now;

        publishLiveMetrics();
        setPosture({
          state:        result.state as DeskPostureState,
          instantScore: result.instantScore,
          severity:     result.severity,
          label:        POSTURE_LABELS[result.state],
          description:  POSTURE_CUES[result.state],
          pitchDiff:    result.pitchDiff,
          rollDiff:     result.rollDiff,
        });
      },

      (slot, state) => {
        // Signal-level cleanup only. The session is NOT ended here — a
        // deliberate end goes through endCurrentSession() (manual disconnect
        // or the "end s'ession" button on the prompt below), and an
        // unexpected drop the user may still reconnect through must keep the
        // session timer running.

        // A fresh connection means the user wants to track again — lift the
        // post-end packet suppression so the next packet can start a session.
        if (state.connected) {
          sessionEndedRef.current = false;
          setSessionEnded(false);
          // This s'pot is back, so its "disconnected" notifications no longer apply
          dismissBackgroundAlerts(`${NOTIF_DISCONNECT}-${slot}`);
        } else if (sessionStartTimeRef.current !== null && disconnectedAtRef.current === null) {
          // A slot dropped mid-session — start timing the dead gap. It's
          // banked in the packet handler once BOTH slots stream again (the
          // moment tracking truly resumes).
          disconnectedAtRef.current = Date.now();
        }

        if (slot === "top") {
          setTopData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            topLatestRef.current = null;
            resetPostureStability();
            emaRef.current.initialised  = false;
            // Drop the per-packet timestamp so the first packet after a
            // reconnect doesn't fold the whole disconnected gap into the
            // upper-back time-weighted average.
            lastPacketTimestampRef.current = null;
            // Not ready until this slot streams enough fresh packets again
            topPacketCountRef.current = 0;
            sensorsReadyRef.current = false;
            setSensorsReady(false);
          }
        } else {
          setBottomData((prev) => ({ ...prev, state }));
          if (!state.connected) {
            bottomLatestRef.current = null;
            resetPostureStability();
            emaRef.current.initialised  = false;
            lastPacketTimestampRef.current = null;
            // Not ready until this slot streams enough fresh packets again
            bottomPacketCountRef.current = 0;
            sensorsReadyRef.current = false;
            setSensorsReady(false);
          }
        }
      },

      // Unexpected drop (not a manual disconnect). Ask the user: reconnect the
      // s'pot and stay on the same session, or end the session now (which
      // saves it to Supabase like a normal end). The session timer keeps
      // running while this prompt is up, so "reconnect s'pot" resumes the
      // same session with no gap.
      (slot, device) => {
        // No session running (e.g. the other s'pot was switched off after the
        // session already ended) — a drop is just a drop, don't prompt.
        if (sessionStartTimeRef.current === null) return;

        // Save what we have right away, and stand the watchdog down — this
        // disconnect notification already tells the user tracking stopped.
        snapshotCurrentSession();
        disarmSessionWatchdog();
        lastWatchdogArmAtRef.current = 0;

        const label = slot === "top" ? "top" : "bottom";
        const title = `${label} s'pot disconnected`;
        const message = "reconnect the s'pot to carry on, or end your session now; it'll be saved either way.";
        sendBackgroundAlert(`${NOTIF_DISCONNECT}-${slot}`, title, message);
        setBrandAlert({
          title,
          message,
          dismissable: false,
          buttons: [
            {
              text: "end s'ession",
              style: "destructive",
              onPress: () => { bleService.cancelReconnect(slot); endCurrentSession(); },
            },
            {
              text: "reconnect s'pot",
              onPress: () => bleService.confirmReconnect(device, slot),
            },
          ],
        });
      }
    );
  }, [
    endCurrentSession, resetPostureStability, snapshotCurrentSession, publishLiveMetrics,
    ensureSessionRow, persistActiveSession, closeOrphanedRecord,
  ]);

  // ── 5-position calibration ────────────────────────────────────────────────

  const startCalibrationStep = useCallback((step: 1 | 2 | 3 | 4 | 5) => {
    resetPostureStability();
    // Clear any stale low-confidence warning from a previous attempt at this
    // (or another) step — it only applies to the capture that's about to happen.
    setCalibration((prev) => ({ ...prev, currentStep: step, countdown: 3, lowConfidenceStep: null }));
    const t1 = setTimeout(() => setCalibration((prev) => ({ ...prev, countdown: 2 })), 1000);
    const t2 = setTimeout(() => setCalibration((prev) => ({ ...prev, countdown: 1 })), 2000);

    const samples: Array<{ top: ParsedIMU; bottom: ParsedIMU }> = [];
    const samplingInterval = setInterval(() => {
      const top = topLatestRef.current; const bottom = bottomLatestRef.current;
      if (top && bottom) samples.push({ top, bottom });
    }, 200);

    const t3 = setTimeout(() => {
      clearInterval(samplingInterval);
      if (samples.length === 0) {
        setCalibration((prev) => ({ ...prev, countdown: null, currentStep: null })); return;
      }

      const avg = (key: (s: typeof samples[0]) => number) =>
        samples.reduce((sum, s) => sum + key(s), 0) / samples.length;

      const topPitch = avg((s) => s.top.angle.pitch);
      const topRoll  = avg((s) => s.top.angle.roll);
      const bottomPitch = avg((s) => s.bottom.angle.pitch);
      const bottomRoll  = avg((s) => s.bottom.angle.roll);

      // Set when a step's lean was too small to trust its sign as evidence
      // of mounting orientation — see MIN_RELIABLE_ORIENTATION_DEG above.
      let lowConfidence = false;

      if (step === 1) {
        const offset: NeutralOffset = { topPitch, topRoll, bottomPitch, bottomRoll };
        captureRef.current.neutral   = offset;
        neutralOffsetRef.current     = offset;
        resetPostureStability();
        setIsNeutralCalibrated(true);
        emaRef.current.initialised   = false;
        AsyncStorage.setItem(NEUTRAL_OFFSET_STORAGE_KEY, JSON.stringify(offset))
          .catch((e) => console.warn("[IMUContext] Failed to save neutral offset:", e));
      } else if (step === 2) {
        const neutral = captureRef.current.neutral;
        const tRoll = neutral ? topRoll    - neutral.topRoll    : topRoll;
        const bRoll = neutral ? bottomRoll - neutral.bottomRoll : bottomRoll;
        const rawDiff = tRoll - bRoll;
        captureRef.current.maxForward  = Math.max(Math.abs(rawDiff), 10);

        // Orientation detection: in the DEFAULT_SAGITTAL_SIGN mounting, a real
        // forward lean makes (topRoll - bottomRoll) negative (see imuParser.ts
        // classifySpinePosture doc comment). If it comes out positive instead,
        // this kit's sagittal axis is mounted the other way around for this
        // session — flip the sign we'll use instead of forcing the user to
        // physically remount the kit.
        if (Math.abs(rawDiff) >= MIN_RELIABLE_ORIENTATION_DEG) {
          captureRef.current.sagittalSign = rawDiff < 0 ? -1 : 1;
        } else {
          lowConfidence = true;
        }
      } else if (step === 3) {
        const neutral = captureRef.current.neutral;
        const tRoll = neutral ? topRoll    - neutral.topRoll    : topRoll;
        const bRoll = neutral ? bottomRoll - neutral.bottomRoll : bottomRoll;
        captureRef.current.maxBackward = Math.max(Math.abs(tRoll - bRoll), 5);
      } else if (step === 4) {
        const neutral = captureRef.current.neutral;
        const tPitch = neutral ? topPitch    - neutral.topPitch    : topPitch;
        const bPitch = neutral ? bottomPitch - neutral.bottomPitch : bottomPitch;
        const rawDiff = tPitch - bPitch;
        captureRef.current.maxRight    = Math.max(Math.abs(rawDiff), 5);

        // Same idea as step 2, for the lateral axis: in the DEFAULT_LATERAL_SIGN
        // mounting, leaning right makes (topPitch - bottomPitch) positive.
        if (Math.abs(rawDiff) >= MIN_RELIABLE_ORIENTATION_DEG) {
          captureRef.current.lateralSign = rawDiff > 0 ? 1 : -1;
        } else {
          lowConfidence = true;
        }
      } else if (step === 5) {
        const neutral = captureRef.current.neutral;
        const tPitch = neutral ? topPitch    - neutral.topPitch    : topPitch;
        const bPitch = neutral ? bottomPitch - neutral.bottomPitch : bottomPitch;
        captureRef.current.maxLeft     = Math.max(Math.abs(tPitch - bPitch), 5);
      }

      setCalibration((prev) => {
        const updated = [...prev.stepComplete];
        updated[step - 1] = true;
        const allDone = updated.every(Boolean);
        if (allDone) {
          const { neutral, maxForward, maxBackward, maxRight, maxLeft, sagittalSign, lateralSign } = captureRef.current;
          if (neutral && maxForward !== null && maxBackward !== null && maxRight !== null && maxLeft !== null) {
            const baseline: ClinicalBaseline = {
              neutral, maxForwardDeg: maxForward, maxBackwardDeg: maxBackward,
              maxRightDeg: maxRight, maxLeftDeg: maxLeft, capturedAt: new Date().toISOString(),
              // Fall back to the historical defaults if steps 2/4 never got a
              // reliable lean (e.g. user skipped straight through) — matches
              // the app's pre-detection behaviour rather than guessing.
              sagittalSign: sagittalSign ?? DEFAULT_SAGITTAL_SIGN,
              lateralSign:  lateralSign  ?? DEFAULT_LATERAL_SIGN,
            };
            baselineRef.current = baseline;
            emaRef.current.initialised = false;
            resetPostureStability();
            setClinicalBaseline(baseline);
            AsyncStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline))
              .catch((e) => console.warn("[IMUContext] Failed to save baseline:", e));
          }
        }
        return {
          ...prev, stepComplete: updated, isComplete: allDone, countdown: 0,
          currentStep: allDone ? null : step,
          lowConfidenceStep: lowConfidence ? step : null,
        };
      });

      setTimeout(() =>
        setCalibration((prev) => ({ ...prev, countdown: null, currentStep: null })), 1500);
    }, 3000);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearInterval(samplingInterval); };
  }, [resetPostureStability]);

  const resetCalibration = useCallback(() => {
    resetPostureStability();
    captureRef.current = {
      neutral: null, maxForward: null, maxBackward: null, maxRight: null, maxLeft: null,
      sagittalSign: null, lateralSign: null,
    };
    baselineRef.current    = null; neutralOffsetRef.current = null;
    emaRef.current.initialised = false;
    setClinicalBaseline(null); setIsNeutralCalibrated(false);
    setCalibration(defaultCalibration);
    AsyncStorage.removeItem(BASELINE_STORAGE_KEY).catch(() => {});
    AsyncStorage.removeItem(NEUTRAL_OFFSET_STORAGE_KEY).catch(() => {});
  }, [resetPostureStability]);

  // ── User actions ──────────────────────────────────────────────────────────

  const confirmMovement = useCallback(() => {
    setShouldNudge(false);
    staticNudgeFiredRef.current = false;
    staticStartTimeRef.current  = Date.now();
    clearNudgeNotifs();
  }, [clearNudgeNotifs]);

  const dismissIntervention = useCallback((moved: boolean) => {
    if (!moved) {
      const penalised = Math.max(0, shsRef.current - 5);
      shsRef.current  = penalised;
      setShs(Math.round(penalised));
      console.log("[IMUContext] intervention ignored — -5 SHS structural debt");
    } else {
      // Partial CPL reset on acknowledged movement
      cplRef.current = Math.max(0, cplRef.current * 0.5);
      setCpl(Math.round(cplRef.current));
      clearStrainNotifs();
    }
    // Allow intervention to re-fire if CPL stays high
    interventionFiredRef.current = false;
    setActiveIntervention(null);
  }, [clearStrainNotifs]);

  // ── BLE actions ───────────────────────────────────────────────────────────

  const scan = useCallback(async () => {
    const ok = await bleService.requestPermissions();
    if (!ok) return;
    setDiscoveredDevices([]);
    setIsScanning(true);
    const started = await bleService.scan(
      (device) => {
        setDiscoveredDevices((prev) => {
          const idx = prev.findIndex((d) => d.id === device.id);
          if (idx === -1) return [...prev, device];
          // allowDuplicates means the same device can be re-sighted with a
          // name it didn't carry on its first advertisement (name and
          // service UUID can arrive in separate AD packets) — replace the
          // stored sighting so the picker doesn't get stuck showing a blank
          // name for a device that does have one.
          if (!prev[idx].name && device.name) {
            const updated = [...prev];
            updated[idx] = device;
            return updated;
          }
          return prev;
        });
      },
      10000,
      (message) => console.warn("[IMUContext] scan didn't start:", message)
    );
    if (!started) {
      setIsScanning(false);
      return;
    }
    setTimeout(() => setIsScanning(false), 10000);
  }, []);

  const connect       = useCallback(async (device: Device, slot: SensorSlot) => { bleService.stopScan(); setIsScanning(false); await bleService.connectDevice(device, slot); }, []);
  const disconnect    = useCallback(async (slot: SensorSlot) => {
    await bleService.disconnectSlot(slot);
    endCurrentSession();
  }, [endCurrentSession]);
  const disconnectAll = useCallback(async () => {
    endCurrentSession();
    await bleService.disconnectAll();
    setPosture(null);
  }, [endCurrentSession]);

  // Ends the session without touching BLE. Packets are suppressed by
  // sessionEndedRef, so also clear live posture state to stop the SHS/CPL
  // ticker and the UI from running on stale data.
  const endSessionKeepConnected = useCallback(() => {
    endCurrentSession();
    lastPostureStateRef.current = null;
    emaRef.current.initialised  = false;
    lastPacketTimestampRef.current = null;
    setPosture(null);
  }, [endCurrentSession]);

  // ── Safety net: tracking that stopped without the user ending it ──────────

  // The app is alive but no data has arrived from the s'pots for a while,
  // with no disconnect event (e.g. a s'pot froze). End and save the session
  // rather than leave it silently open, and tell the user.
  useEffect(() => {
    const id = setInterval(() => {
      const last = lastSessionPacketAtRef.current;
      if (
        last === null ||
        sessionStartTimeRef.current === null ||
        sessionEndedRef.current ||
        disconnectedAtRef.current !== null || // a disconnect prompt already covers this
        Date.now() - last < STALL_END_MS
      ) return;
      sentryBreadcrumb("s'pot data stalled — ending session", { sessionId: sessionIdRef.current });
      endSessionKeepConnected();
      sendBackgroundAlert("session-stopped", SESSION_STOPPED_TITLE, SESSION_STOPPED_BODY);
      if (appActiveRef.current) {
        setBrandAlert({
          title: SESSION_STOPPED_TITLE,
          message: SESSION_STOPPED_BODY,
          buttons: [{ text: "ok" }],
        });
      }
    }, STALL_CHECK_MS);
    return () => clearInterval(id);
  }, [endSessionKeepConnected]);

  // Lifts the post-end packet suppression; the next joint packet starts the session.
  const startNewSession = useCallback(() => {
    sessionEndedRef.current = false;
    setSessionEnded(false);
  }, []);

  const registerStatsTick = useCallback((fn: ((state: DeskPostureState) => void) | null) => {
    statsTickRef.current = fn;
  }, []);

  const registerLiveStatus = useCallback((fn: LiveStatusListener | null) => {
    liveStatusRef.current = fn;
  }, []);

  const bothConnected = topData.state.connected && bottomData.state.connected;

  // Android: a foreground service is the only thing that keeps the BLE
  // stream, the JS session tracking and Supabase writes alive once the app is
  // backgrounded. iOS: the same calls start/end the live s'ession Live Activity
  // (iOS keeps tracking alive itself via bluetooth-central). Starts when both
  // s'pots connect (in the foreground, which iOS requires to start a Live
  // Activity), stays up through an unexpected drop the user may still reconnect
  // through (session still running), and stops at session end.
  const trackingActive = sessionStartTimeMs !== null || (bothConnected && !sessionEnded);
  useEffect(() => {
    if (!trackingActive) return;
    try {
      // Placeholder until the first live update: SessionLiveNotification then
      // keeps this same notification updated with posture, time and XP.
      startTrackingService("s'pots connected", "starting your s'ession…");
      sentryBreadcrumb("tracking service started");
    } catch (e) {
      captureError(e, "tracking-service-start");
    }
    return () => {
      try { stopTrackingService(); } catch (e) { captureError(e, "tracking-service-stop"); }
    };
  }, [trackingActive]);

  const setSessionStateTotals = useCallback((totals: postureSync.StateTotals) => {
    sessionStateTotalsRef.current = totals;
  }, []);

  // Memoised so consumers only re-render when something they could read
  // actually changed — an inline object here re-rendered every screen using
  // this context on every render of the provider.
  const value = useMemo<IMUContextValue>(() => ({
    topSensor: topData,
    bottomSensor: bottomData,
    posture,
    bothConnected,
    sensorsReady,
    discoveredDevices, isScanning, scan, connect, disconnect, disconnectAll,
    endSessionKeepConnected, startNewSession,
    calibration, clinicalBaseline, isNeutralCalibrated,
    startCalibrationStep, resetCalibration,
    shs, cpl, timeInCurrentStateMs, sessionDurationMs, sessionStartTimeMs,
    neckAlignmentPercent, shoulderBalancePercent, upperBackPercent,
    shouldNudge, activeIntervention, confirmMovement, dismissIntervention,
    setSessionStateTotals,
    registerStatsTick,
    registerLiveStatus,
  }), [
    topData, bottomData, posture, bothConnected, sensorsReady,
    discoveredDevices, isScanning, scan, connect, disconnect, disconnectAll,
    endSessionKeepConnected, startNewSession,
    calibration, clinicalBaseline, isNeutralCalibrated,
    startCalibrationStep, resetCalibration,
    shs, cpl, timeInCurrentStateMs, sessionDurationMs, sessionStartTimeMs,
    neckAlignmentPercent, shoulderBalancePercent, upperBackPercent,
    shouldNudge, activeIntervention, confirmMovement, dismissIntervention,
    setSessionStateTotals, registerStatsTick, registerLiveStatus,
  ]);

  return (
    <IMUContext.Provider value={value}>
      {children}
      <BrandAlert
        visible={brandAlert !== null}
        title={brandAlert?.title ?? ""}
        message={brandAlert?.message}
        buttons={brandAlert?.buttons ?? [{ text: "ok" }]}
        dismissable={brandAlert?.dismissable ?? true}
        onRequestClose={() => setBrandAlert(null)}
      />
    </IMUContext.Provider>
  );
}

export function useIMUContext(): IMUContextValue {
  const ctx = useContext(IMUContext);
  if (!ctx) throw new Error("useIMUContext must be used inside <IMUProvider>");
  return ctx;
}