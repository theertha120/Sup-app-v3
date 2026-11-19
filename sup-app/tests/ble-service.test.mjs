// BLEService against a fake react-native-ble-plx. Covers the invariants in
// CLAUDE.md: one connect at a time, no auto-reconnect on an unexpected drop
// (user confirms), de-duped drop handling, and service-UUID-only scanning.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeAsyncStorage, fakeClock, fakeSentry, flush, imuPacket, loadTs, quietConsole } from './helpers/harness.mjs';

const SERVICE_UUID = '0000ffe5-0000-1000-8000-00805f9a34fb';

function setup({ bleState = 'PoweredOn' } = {}) {
  const clock = fakeClock();
  const log = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const disconnectListeners = new Map();
  const manager = {
    scanCallback: null,
    scanArgs: null,
    onStateChange() {},
    state: async () => bleState,
    startDeviceScan(uuids, options, cb) { this.scanArgs = { uuids, options }; this.scanCallback = cb; log.push('scan'); },
    stopDeviceScan() { log.push('stop-scan'); },
    onDeviceDisconnected(id, cb) {
      disconnectListeners.set(id, cb);
      return { remove: () => { if (disconnectListeners.get(id) === cb) disconnectListeners.delete(id); } };
    },
  };
  const makeDevice = (id, name = id, { failConnects = 0, connectMs = 0 } = {}) => {
    const device = {
      id, name, notify: null, connects: 0, cancelled: 0, failConnects,
      async connect() {
        device.connects++;
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => clock.setTimeout(r, connectMs));
        inFlight--;
        if (device.failConnects-- > 0) throw new Error('connect failed');
        return device;
      },
      async discoverAllServicesAndCharacteristics() {},
      monitorCharacteristicForService(_s, _c, cb) { device.notify = cb; return { remove: () => { device.notify = null; } }; },
      async cancelConnection() { device.cancelled++; },
      async writeCharacteristicWithResponseForService() {},
    };
    return device;
  };
  const sentry = fakeSentry();
  const { bleService } = loadTs('src/services/BLEService.ts', {
    mocks: {
      'react-native-ble-plx': { BleManager: function BleManager() { return manager; } },
      'react-native': { Platform: { OS: 'ios' }, PermissionsAndroid: {} },
      '../lib/sentry': sentry.module,
      // v2 background-service work: s'pot slots are saved for Bluetooth state restoration.
      '@react-native-async-storage/async-storage': fakeAsyncStorage(),
    },
    globals: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Date: clock.Date, console: quietConsole },
  });
  const events = { data: [], status: [], unexpected: [] };
  bleService.setCallbacks(
    (slot, view) => events.data.push([slot, view.byteLength, view.getUint8(0)]),
    (slot, state) => events.status.push([slot, state.connected]),
    (slot, device) => events.unexpected.push([slot, device.id]),
  );
  // Drives the fake clock until the given promise settles.
  const run = async (promise, maxMs = 120_000) => {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    for (let t = 0; t < maxMs && !done; t += 100) { await flush(2); clock.advance(100); }
    await flush();
    return promise;
  };
  return { bleService, manager, makeDevice, events, run, clock, sentry, disconnectListeners, stats: () => ({ maxInFlight }) };
}

const b64 = (view) => btoa(String.fromCharCode(...new Uint8Array(view.buffer)));

test('scan filters by the s\'pot service UUID only (no name-prefix filter) and allows duplicates', async () => {
  const s = setup();
  const found = [];
  assert.equal(await s.bleService.scan((d) => found.push(d.name), 5000), true);
  assert.deepEqual(s.manager.scanArgs, { uuids: [SERVICE_UUID], options: { allowDuplicates: true } });
  // A renamed pilot unit and a nameless advertisement are both reported.
  s.manager.scanCallback(null, { id: 'a', name: 'spot_top_0048_05_01' });
  s.manager.scanCallback(null, { id: 'b', name: null });
  assert.deepEqual(found, ['spot_top_0048_05_01', null]);
  // A second scan while one is running is refused, not silently dropped.
  const errors = [];
  assert.equal(await s.bleService.scan(() => {}, 5000, (m) => errors.push(m)), false);
  assert.equal(errors.length, 1);
  s.clock.advance(5000);
  assert.equal(await s.bleService.scan(() => {}, 5000), true, 'scan lock released after the timeout');
});

test('scan refuses to start while Bluetooth is not powered on', async () => {
  const s = setup({ bleState: 'PoweredOff' });
  const errors = [];
  assert.equal(await s.bleService.scan(() => {}, 5000, (m) => errors.push(m)), false);
  assert.match(errors[0], /PoweredOff/);
});

test('connect streams decoded packets to the slot and reports connected state', async () => {
  const s = setup();
  const top = s.makeDevice('top-1');
  await s.run(s.bleService.connectDevice(top, 'top'));
  assert.deepEqual(s.events.status.at(-1), ['top', true]);
  assert.deepEqual(s.bleService.getConnectedDeviceIds(), ['top-1']);
  top.notify(null, { value: b64(imuPacket({ roll: 10 })) });
  assert.deepEqual(s.events.data, [['top', 20, 0x55]]);
});

test('a foreground connect and a background reconnect never connect at the same time', async () => {
  const s = setup();
  const top = s.makeDevice('top-1', 'top', { connectMs: 3000 });
  const bottom = s.makeDevice('bot-1', 'bot', { connectMs: 3000 });
  await s.run(s.bleService.connectDevice(top, 'top'));
  s.disconnectListeners.get('top-1')();
  s.bleService.confirmReconnect(top, 'top');          // loop's first attempt is at +2s
  await s.run(s.bleService.connectDevice(bottom, 'bottom')); // connects +0.3s → +3.3s
  await s.run(new Promise((r) => { const poll = () => (s.bleService.getConnectedDeviceIds().length === 2 ? r() : s.clock.setTimeout(poll, 100)); poll(); }));
  assert.equal(s.stats().maxInFlight, 1);
});

// The fake clock fires same-time timers in one batch (as RN's old bridge did),
// which defeated the previous check-then-set flag; the queue must hold anyway.
test('two foreground connects started together are serialised, even when timers fire in one batch', async () => {
  const s = setup();
  const top = s.makeDevice('top-1', 'top', { connectMs: 3000 });
  const bottom = s.makeDevice('bot-1', 'bot', { connectMs: 3000 });
  await s.run(Promise.all([s.bleService.connectDevice(top, 'top'), s.bleService.connectDevice(bottom, 'bottom')]));
  assert.equal(s.stats().maxInFlight, 1);
  assert.deepEqual(s.bleService.getConnectedDeviceIds().sort(), ['bot-1', 'top-1']);
});

test('a failed connect releases the queue for the next one', async () => {
  const s = setup();
  const top = s.makeDevice('top-1', 'top', { failConnects: 1, connectMs: 1000 });
  const bottom = s.makeDevice('bot-1', 'bot', { connectMs: 1000 });
  await s.run(Promise.all([s.bleService.connectDevice(top, 'top'), s.bleService.connectDevice(bottom, 'bottom')]));
  assert.deepEqual(s.bleService.getConnectedDeviceIds(), ['bot-1']);
});

test('a stuck connect holds the queue for at most 15s', async () => {
  const s = setup();
  const stuck = s.makeDevice('top-1', 'top', { connectMs: 10 * 60_000 });
  const bottom = s.makeDevice('bot-1', 'bot');
  s.bleService.connectDevice(stuck, 'top');
  const start = s.clock.now();
  await s.run(s.bleService.connectDevice(bottom, 'bottom'), 30_000);
  assert.deepEqual(s.bleService.getConnectedDeviceIds(), ['bot-1']);
  assert.ok(s.clock.now() - start <= 16_000, `waited ${s.clock.now() - start}ms`);
});

test('an unexpected drop prompts the app once and never reconnects on its own', async () => {
  const s = setup();
  const top = s.makeDevice('top-1');
  await s.run(s.bleService.connectDevice(top, 'top'));
  // Both drop paths fire for one disconnect — the app is asked once.
  top.notify({ message: 'link lost' }, null);
  s.disconnectListeners.get('top-1')?.();
  assert.deepEqual(s.events.unexpected, [['top', 'top-1']]);
  assert.deepEqual(s.events.status.at(-1), ['top', false]);
  s.clock.advance(60_000);
  await flush();
  assert.equal(top.connects, 1, 'no automatic reconnect attempt');
});

test('confirmReconnect retries with backoff until connected, and re-arms drop detection', async () => {
  const s = setup();
  const top = s.makeDevice('top-1');
  await s.run(s.bleService.connectDevice(top, 'top'));
  s.disconnectListeners.get('top-1')();
  top.failConnects = 2;
  s.bleService.confirmReconnect(top, 'top');
  await s.run(new Promise((r) => { const poll = () => (s.bleService.getConnectedDeviceIds().length ? r() : s.clock.setTimeout(poll, 100)); poll(); }));
  assert.equal(top.connects, 4, '1 initial + 2 failures + 1 success');
  // A second drop after reconnecting is still noticed.
  s.disconnectListeners.get('top-1')();
  assert.equal(s.events.unexpected.length, 2);
});

test('cancelReconnect (user ended the session) stops any reconnect from starting', async () => {
  const s = setup();
  const top = s.makeDevice('top-1');
  await s.run(s.bleService.connectDevice(top, 'top'));
  s.disconnectListeners.get('top-1')();
  s.bleService.cancelReconnect('top');
  s.clock.advance(60_000);
  await flush();
  assert.equal(top.connects, 1);
});

test('a manual disconnect never prompts', async () => {
  const s = setup();
  const top = s.makeDevice('top-1');
  await s.run(s.bleService.connectDevice(top, 'top'));
  await s.bleService.disconnectSlot('top');
  top.notify?.({ message: 'cancelled' }, null);
  s.disconnectListeners.get('top-1')?.();
  assert.deepEqual(s.events.unexpected, []);
  assert.equal(top.cancelled, 1);
  assert.deepEqual(s.bleService.getConnectedDeviceIds(), []);
});

test('a failed connect reports disconnected and logs to Sentry instead of throwing', async () => {
  const s = setup();
  const top = s.makeDevice('top-1', 'top', { failConnects: 1 });
  await s.run(s.bleService.connectDevice(top, 'top'));
  assert.deepEqual(s.events.status.at(-1), ['top', false]);
  assert.ok(s.sentry.errors.some((e) => e.context === 'spot-connect'));
});
