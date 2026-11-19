import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the real provider and tracker using deterministic hook lifecycles and time.
function fixture({ failRead = false, failWrite = false } = {}) {
  let now = new Date(2026, 9, 26, 12).getTime();
  let active;
  const timers = new Map();
  const writes = [];
  const reports = [];
  const imu = {
    posture: { state: 'upright' }, bothConnected: true, isNeutralCalibrated: true,
    sessionStartTimeMs: now, setSessionStateTotals: totals => { imu.totals = totals; },
    // v2 background-service work: packets can drive the stats tick while timers are paused.
    registerStatsTick: fn => { imu.statsTick = fn; },
  };
  const react = {
    createContext: value => {
      const context = { value };
      context.Provider = ({ value }) => { context.value = value; };
      return context;
    },
    createElement: (type, props) => type(props),
    useContext: context => context.value,
    useRef: initial => {
      const index = active.cursor++;
      return active.slots[index] ??= { current: initial };
    },
    useState: initial => {
      const owner = active;
      const index = owner.cursor++;
      if (!(index in owner.slots)) owner.slots[index] = initial;
      return [owner.slots[index], next => {
        owner.slots[index] = typeof next === 'function' ? next(owner.slots[index]) : next;
      }];
    },
    useEffect: (effect, deps) => {
      const owner = active;
      const index = owner.cursor++;
      const previous = owner.slots[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        owner.effects.push(() => {
          previous?.cleanup?.();
          owner.slots[index] = { deps, cleanup: effect() };
        });
      }
    },
    // Memoised like React's (the tracker's load effect depends on a useCallback).
    useCallback: (fn, deps) => {
      const index = active.cursor++;
      const previous = active.slots[index];
      if (previous && deps && deps.every((dep, i) => dep === previous.deps[i])) return previous.fn;
      active.slots[index] = { fn, deps };
      return fn;
    },
  };
  const mount = fn => {
    const owner = { cursor: 0, slots: [], effects: [] };
    return {
      render() {
        active = owner;
        owner.cursor = 0;
        const result = fn();
        owner.effects.splice(0).forEach(effect => effect());
        return result;
      },
      unmount() { owner.slots.forEach(slot => slot?.cleanup?.()); },
    };
  };
  function load(path, deps) {
    const js = ts.transpile(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    });
    const module = { exports: {} };
    class Clock extends Date { static now() { return now; } }
    new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', 'Date', 'console', js)(
      name => { assert.ok(name in deps, `Unexpected import ${name}`); return deps[name]; },
      module, module.exports,
      (fn, delay) => { const id = Symbol(); timers.set(id, { fn, delay }); return id; },
      id => timers.delete(id), Clock, { log() {}, warn() {} },
    );
    return module.exports;
  }
  const tracker = load('../src/hooks/useSessionStats.ts', {
    react,
    '../lib/sentry': {
      captureError: (...args) => reports.push(args),
      createThrottledErrorReporter: () => (...args) => reports.push(args),
    },
    '@react-native-async-storage/async-storage': {
      getItem: async () => { if (failRead) throw new Error('local read failed'); return null; },
      setItem: async (...args) => { if (failWrite) throw new Error('local write failed'); writes.push(args); },
      // v2 saves the live session's totals together with today's in one write.
      multiSet: async (entries) => { if (failWrite) throw new Error('local write failed'); entries.forEach((entry) => writes.push(entry)); },
      removeItem: async () => {},
    },
    '../contexts/AuthContext': { useAuth: () => ({ userId: 'user-a' }) },
    '../contexts/IMUContext': { useIMUContext: () => imu },
    '../lib/dateKey': { toLocalDateKey: () => '2026-10-26' },
  });
  const context = load('../src/contexts/SessionStatsContext.tsx', {
    react, './IMUContext': { useIMUContext: () => imu }, '../hooks/useSessionStats': tracker,
  });
  const provider = mount(() => context.SessionStatsProvider({ children: null }));
  const screen = () => mount(context.useSessionStats);
  // One 5s stats tick, stepping 1s at a time so the 1s timeline sampler runs too.
  const tick = () => {
    for (let step = 1; step <= 5; step++) {
      now += 1000;
      for (const { fn, delay } of timers.values()) {
        assert.ok(delay === 1000 || delay === 5000, `unexpected interval ${delay}`);
        if ((step * 1000) % delay === 0) fn();
      }
    }
    provider.render();
  };
  return { provider, screen, tick, imu, timers, writes, reports };
}

test('tracks before Desk opens, after it unmounts, and retains totals and timeline on return', async () => {
  const f = fixture();
  f.provider.render();
  // Saving waits until saved stats have loaded (v2 background-service work).
  await new Promise(resolve => setImmediate(resolve));
  f.tick();
  assert.equal(f.imu.totals.upright, 5000);
  const desk = f.screen();
  assert.equal(desk.render().sessionTotalMs, 5000);
  desk.unmount();
  f.imu.posture = { state: 'slouched' };
  f.provider.render();
  f.tick();
  f.tick();
  const stats = f.screen().render();
  assert.deepEqual(stats.sessionStats, { upright: 5000, slouched: 10000 });
  assert.deepEqual(stats.getSessionTimeline().map(segment => segment.state), ['upright', 'slouched']);
  assert.deepEqual(f.imu.totals, stats.sessionStats);
  assert.ok(f.writes.some(([, value]) => JSON.parse(value).slouched === 10000));
  assert.equal(f.timers.size, 2) // stats tick + timeline sampler, one shared provider;
  f.provider.unmount();
  assert.equal(f.timers.size, 0);
});

test('multiple screens share one tracker and shared session end resets its totals', () => {
  const f = fixture();
  f.provider.render();
  const first = f.screen();
  const second = f.screen();
  first.render();
  second.render();
  f.tick();
  assert.equal(first.render().sessionTotalMs, 5000);
  assert.equal(second.render().sessionTotalMs, 5000);
  assert.equal(f.timers.size, 2);
  first.unmount();
  f.tick();
  assert.equal(second.render().sessionTotalMs, 10000);
  f.imu.sessionStartTimeMs = null;
  f.provider.render();
  f.provider.render();
  assert.equal(second.render().sessionTotalMs, 0);
  assert.deepEqual(second.render().getSessionTimeline(), []);
  f.provider.unmount();
});

test('session tracking wraps navigation outside OfflineGate screen remounts', () => {
  const source = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(source, /<IMUProvider>\s*<SessionStatsProvider>[\s\S]*<OfflineGate>[\s\S]*<Stack/);
  assert.match(source, /<\/OfflineGate>[\s\S]*<\/SessionStatsProvider>\s*<\/IMUProvider>/);
});

test('local load, periodic save and final save errors are observable without changing tracking', async () => {
  const f = fixture({ failRead: true, failWrite: true });
  f.provider.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.reports[0][1], 'desk-stats-load');
  f.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.reports[1][1], 'desk-stats-save');
  assert.equal(f.imu.totals.upright, 5000);
  f.imu.sessionStartTimeMs = null;
  f.provider.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.reports[2][1], 'desk-stats-final-save');
  assert.equal(f.reports.length, 3);
  f.provider.unmount();
});
