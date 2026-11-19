// Runs the real IMUProvider with fake BLE / Supabase sync / storage /
// notifications, driven by synthetic s'pot packets. Shared by the session and
// calibration tests.
import { fakeAsyncStorage, fakeClock, imuPacket, loadTs, miniReact, quietConsole } from './harness.mjs';

export function setupImu({ userId = 'user-1', storage = fakeAsyncStorage() } = {}) {
  const clock = fakeClock(new Date(2026, 10, 13, 9, 0).getTime());
  const { react, mount } = miniReact();
  const calls = { start: [], end: [], snapshot: [], rebuild: [], xp: [], alerts: [], dismissed: [], cancelReconnect: [], confirmReconnect: [] };
  let sessionSeq = 0;
  const ble = { callbacks: null };
  const bleService = {
    setCallbacks: (...cbs) => { ble.callbacks = cbs; },
    stopScan() {}, scan: async () => true, connectDevice: async () => {},
    disconnectSlot: async (slot) => { ble.callbacks[1](slot, { connected: false, deviceId: null, deviceName: null }); },
    disconnectAll: async () => {},
    cancelReconnect: (slot) => calls.cancelReconnect.push(slot),
    confirmReconnect: (device, slot) => calls.confirmReconnect.push(slot),
    calibrate: async () => {},
  };
  const postureSync = {
    startSession: async (uid) => { calls.start.push(uid); return `sess-${++sessionSeq}`; },
    endSession: async (id, agg) => { calls.end.push({ id, agg: structuredClone(agg) }); },
    snapshotSession: async (id, agg) => { calls.snapshot.push({ id, agg: structuredClone(agg) }); },
    rebuildDailyFromSessions: async (uid, dateKey) => { calls.rebuild.push([uid, dateKey]); },
  };
  let appStateListener = null;
  const mod = loadTs('src/contexts/IMUContext.tsx', {
    mocks: {
      react,
      'react-native': { AppState: { addEventListener: (_e, cb) => { appStateListener = cb; return { remove() {} }; } } },
      '../components/ui/BrandAlert': { BrandAlert: 'BrandAlert' },
      '@react-native-async-storage/async-storage': storage,
      'react-native-ble-plx': {},
      '../services/BLEService': { bleService },
      './AuthContext': { useAuth: () => ({ userId }) },
      '../services/posture/postureSyncService': postureSync,
      '../services/xp/xpService': { syncDayXp: async (uid, dateKey) => { calls.xp.push([uid, dateKey]); return null; } },
      '../lib/sentry': { sentryBreadcrumb() {} },
      '../services/reminder/pushNotificationService': {
        sendBackgroundAlert: async (kind, title, body) => { calls.alerts.push({ kind, title, body }); },
        dismissBackgroundAlerts: async (kind) => { calls.dismissed.push(kind); },
      },
    },
    globals: {
      Date: clock.Date, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval, clearInterval: clock.clearInterval, console: quietConsole,
    },
  });

  const provider = mount(() => mod.IMUProvider({ children: null }));
  let tree = provider.render();
  const ctx = () => tree.props.value;
  const alert = () => tree.props.children.find((c) => c?.type === 'BrandAlert')?.props;
  const rerender = () => { tree = provider.render(); };

  const [onData, onStatus, onUnexpected] = [0, 1, 2].map((i) => (...args) => ble.callbacks[i](...args));
  const connected = (slot) => onStatus(slot, { connected: true, deviceId: `${slot}-id`, deviceName: slot });
  const dropped = (slot) => onStatus(slot, { connected: false, deviceId: null, deviceName: null });
  // Forward lean in degrees (default mounting: forward = negative top roll).
  const packets = (forward = 0) => {
    onData('top', imuPacket({ roll: -forward }));
    onData('bottom', imuPacket({ roll: 0 }));
  };
  // Stream at 10 Hz for `ms`, letting interval timers run in between.
  const stream = (ms, forward = 0) => {
    for (let t = 0; t < ms; t += 100) { packets(forward); clock.advance(100); }
    rerender();
  };

  return { mod, ctx, alert, rerender, clock, calls, storage, onData, onUnexpected, connected, dropped, packets, stream,
    background: () => appStateListener?.('background'), active: () => appStateListener?.('active') };
}

