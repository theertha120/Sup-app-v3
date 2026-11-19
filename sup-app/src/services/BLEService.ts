/**
 * BLEService.ts
 *
 * Manages BLE connections to the two IMU sensors inside the s'pots.
 *
 * UUIDs confirmed from LightBlue scan of WT9011DCL:
 *   Service:  FFE5
 *   Notify:   FFE4  (IMU data streams FROM s'pot to phone)
 *   Write:    FFE9  (commands sent TO s'pot from phone)
 *
 * Key fixes in this version:
 *   1. Reconnect guard — only one reconnect attempt per slot at a time,
 *      preventing the "Operation was cancelled" loop from stacked attempts.
 *   2. writeCommand uses btoa() not Buffer.from() — Buffer is not available
 *      in the React Native JS runtime on iOS.
 *   3. getConnectedDeviceIds() exposed so the picker can filter out
 *      s'pots that are already assigned to a slot.
 *
 * Reconnection is user-confirmed, not automatic: an unexpected drop fires
 * onUnexpectedDisconnect (set via setCallbacks) instead of retrying on its
 * own. The app prompts "end session, or try to reconnect?" and calls
 * confirmReconnect()/cancelReconnect() with the answer — see IMUContext.tsx.
 * A manual disconnect (disconnectSlot()/disconnectAll()) never prompts.
 */

import { BleManager, Device, Characteristic, BleError, BleRestoredState } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureError, sentryBreadcrumb } from "../lib/sentry";

// ── UUIDs ─────────────────────────────────────────────────────────────────────
const SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
const NOTIFY_UUID  = "0000ffe4-0000-1000-8000-00805f9a34fb";
const WRITE_UUID   = "0000ffe9-0000-1000-8000-00805f9a34fb";

// device.connect() has no default timeout — an unresponsive peripheral (out
// of range, dying battery, a stuck OS-level GATT session) can otherwise hang
// the promise indefinitely, which in a sequential connect flow (autoConnect
// connects top then bottom, awaited) freezes the second slot too and leaves
// any "connecting…" UI spinner stuck forever with no way out.
const CONNECT_TIMEOUT_MS = 15000;

// iOS Core Bluetooth state restoration. With this identifier set, iOS keeps
// the s'pot connections alive at the system level if it terminates the app
// in the background (memory or CPU pressure), and relaunches the app in the
// background when a s'pot next sends data. restoreStateFunction then hands
// back the still-connected peripherals, which adoptConnected() re-subscribes
// to. Must stay stable across releases — changing it orphans the saved state.
const RESTORE_STATE_ID = "com.supapp.app.ble-central";

// Which peripheral id was last connected in which slot, so a restored or
// already-connected peripheral can be put back into the right slot. Written
// on every successful connect, removed on a manual disconnect.
const SLOT_MAP_KEY = "sup_ble_slot_map_v1";

// ── BLE write commands (WT9011DCL protocol) ───────────────────────────────────
// Unlock must be sent before any config write (valid for 10 seconds)
const CMD_UNLOCK          = new Uint8Array([0xFF, 0xAA, 0x69, 0x88, 0xB5]);
const CMD_SAVE            = new Uint8Array([0xFF, 0xAA, 0x00, 0x00, 0x00]);
const CMD_ACCEL_CALIBRATE = new Uint8Array([0xFF, 0xAA, 0x01, 0x01, 0x00]);

// ── Types ─────────────────────────────────────────────────────────────────────
export type SensorSlot = "top" | "bottom";

export interface SensorState {
  connected: boolean;
  deviceId:   string | null;
  deviceName: string | null;
}

type DataCallback   = (slot: SensorSlot, data: DataView) => void;
type StatusCallback = (slot: SensorSlot, state: SensorState) => void;
// Fired when a slot drops unexpectedly (not via disconnectSlot()/disconnectAll()).
// The app decides what happens next — see confirmReconnect()/cancelReconnect()
// below — instead of BLEService silently retrying on its own.
type UnexpectedDisconnectCallback = (slot: SensorSlot, device: Device) => void;

// ── Singleton ─────────────────────────────────────────────────────────────────
class BLEService {
  private manager: BleManager;

  // Currently connected Device objects, one per slot
  private devices: Record<SensorSlot, Device | null> = { top: null, bottom: null };

  // react-native-ble-plx monitor subscriptions
  private subscriptions: Record<SensorSlot, any> = { top: null, bottom: null };

  private isScanning = false;

  // Reconnect guard — prevents parallel reconnect loops for the same slot.
  // true = a reconnect is already in flight for that slot; ignore new attempts.
  private reconnecting: Record<SensorSlot, boolean> = { top: false, bottom: false };
  // Global connect queue — every device.connect() (foreground or reconnect
  // loop, either slot) runs through withConnectLock(), one at a time.
  private connectQueue: Promise<void> = Promise.resolve();

  // Manual disconnect flag — set when the user explicitly disconnects a slot.
  // Prevents auto-reconnect from firing after an intentional disconnection.
  private manuallyDisconnected: Record<SensorSlot, boolean> = { top: false, bottom: false };

  // De-dupes a single drop that surfaces through more than one path (the
  // characteristic notify-error callback AND onDeviceDisconnected can both
  // fire for one disconnect, in either order). Set the first time a drop for
  // the slot is processed; cleared again on the next successful (re)connect.
  private dropHandled: Record<SensorSlot, boolean> = { top: false, bottom: false };

  // onDeviceDisconnected subscriptions — one per slot, removed before re-registering
  // so stale handlers from previous connections don't fire on the next disconnect.
  private disconnectSubs: Record<SensorSlot, { remove: () => void } | null> = { top: null, bottom: null };
  private onData?:   DataCallback;
  private onStatus?: StatusCallback;
  private onUnexpectedDisconnect?: UnexpectedDisconnectCallback;

  // Peripherals iOS handed back via state restoration before the app had
  // registered its callbacks — adopted as soon as setCallbacks() runs.
  private pendingRestored: Device[] | null = null;
  private restoreChecked = false;

  constructor() {
    this.manager = new BleManager({
      restoreStateIdentifier: RESTORE_STATE_ID,
      restoreStateFunction: (restored: BleRestoredState | null) => {
        const peripherals = restored?.connectedPeripherals ?? [];
        sentryBreadcrumb("ble state restored", { count: peripherals.length });
        if (peripherals.length === 0) return;
        if (this.onData) this.adoptRestored(peripherals);
        else this.pendingRestored = peripherals;
      },
    });

    // Reset internal state cleanly if Bluetooth is toggled off/on by the user
    this.manager.onStateChange((state) => {
      if (state === "PoweredOff" || state === "Resetting") {
        console.log("[BLE] Bluetooth state changed:", state, "— clearing slot state");
        this.devices               = { top: null, bottom: null };
        this.subscriptions         = { top: null, bottom: null };
        this.reconnecting          = { top: false, bottom: false };
        this.manuallyDisconnected  = { top: false, bottom: false };
        this.disconnectSubs        = { top: null, bottom: null };
        this.isScanning            = false;
      }
    }, true);
  }

  // ── Callbacks ─────────────────────────────────────────────────────────────

  setCallbacks(
    onData: DataCallback,
    onStatus: StatusCallback,
    onUnexpectedDisconnect?: UnexpectedDisconnectCallback
  ) {
    this.onData                 = onData;
    this.onStatus               = onStatus;
    this.onUnexpectedDisconnect = onUnexpectedDisconnect;

    // First time the app is ready for data: pick up s'pots that are still
    // connected even though this JS instance never connected them — either
    // handed back by iOS state restoration, or still held open by the OS
    // after the previous app process was terminated.
    if (!this.restoreChecked) {
      this.restoreChecked = true;
      const restored = this.pendingRestored;
      this.pendingRestored = null;
      if (restored) this.adoptRestored(restored);
      else this.adoptSystemConnected();
    }
  }

  // ── Restoration ───────────────────────────────────────────────────────────

  private async readSlotMap(): Promise<Partial<Record<SensorSlot, string>>> {
    try {
      const raw = await AsyncStorage.getItem(SLOT_MAP_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  // Read-modify-write of one shared key — chained so a disconnect and the
  // connect that follows it (or both slots at once) can't interleave and
  // drop each other's update.
  private slotMapWrites: Promise<void> = Promise.resolve();

  private writeSlot(slot: SensorSlot, deviceId: string | null): Promise<void> {
    this.slotMapWrites = this.slotMapWrites.then(async () => {
      try {
        const map = await this.readSlotMap();
        if (deviceId) map[slot] = deviceId;
        else delete map[slot];
        await AsyncStorage.setItem(SLOT_MAP_KEY, JSON.stringify(map));
      } catch (e) {
        captureError(e, "ble-slot-map-save", { slot });
      }
    });
    return this.slotMapWrites;
  }

  private async adoptRestored(peripherals: Device[]): Promise<void> {
    await this.slotMapWrites;
    const map = await this.readSlotMap();
    for (const slot of ["top", "bottom"] as SensorSlot[]) {
      const id = map[slot];
      const device = id ? peripherals.find((p) => p.id === id) : undefined;
      if (!device || this.devices[slot]) continue;
      try {
        // A restored peripheral may still be mid-connection — make sure it's
        // actually connected and its services are known before subscribing.
        const connected = (await device.isConnected())
          ? device
          : await device.connect({ timeout: CONNECT_TIMEOUT_MS });
        await connected.discoverAllServicesAndCharacteristics();
        this.adoptConnected(device, connected, slot);
        sentryBreadcrumb("ble slot restored", { slot });
      } catch (e) {
        captureError(e, "ble-restore", { slot });
      }
    }
  }

  private async adoptSystemConnected(): Promise<void> {
    try {
      const state = await this.manager.state();
      if (state !== "PoweredOn") return;
      const connected = await this.manager.connectedDevices([SERVICE_UUID]);
      if (connected.length > 0) await this.adoptRestored(connected);
    } catch (e) {
      captureError(e, "ble-adopt-connected");
    }
  }

  // ── Permissions ───────────────────────────────────────────────────────────

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(granted).every(
        (r) => r === PermissionsAndroid.RESULTS.GRANTED
      );
    }
    return true; // iOS: permissions declared in app.json / Info.plist
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  /**
   * Scan for nearby s'pots.
   * Fires onDeviceFound for each sighting. Automatically stops after timeoutMs.
   *
   * Returns false — without scanning — if a scan is already in progress or
   * Bluetooth isn't powered on, instead of silently no-op'ing. Both were
   * previously silent: a caller whose scan got dropped because another scan
   * was already running had no way to know, and just burned its whole
   * timeout finding nothing; same for starting a scan before the adapter
   * (a real race right after cold launch, or right after the permission
   * prompt resolves) reports PoweredOn. Pass onError to surface either case
   * instead of a generic "not found" a few seconds later.
   *
   * Filtering to s'pots is done by SERVICE_UUID alone (passed to
   * startDeviceScan below) — that's the actual "is this our hardware" gate,
   * since the FFE5 service is only advertised by s'pot firmware. There used
   * to also be a `device.name?.startsWith("WT")` check here, back when every
   * unit shipped with the factory-default "WT901BLE.." name — but pilot
   * units now get renamed to unique per-kit names (e.g. "s'pot_top_0048.05-08",
   * see src/lib/spotNaming.ts) to fix a BLE-name-collision issue, so a
   * hardcoded prefix would silently exclude every renamed sensor. Don't
   * reintroduce a name-prefix filter here — a name check was also removed
   * from the per-sighting filter below for the same reason (see allowDuplicates
   * comment): a name isn't guaranteed to be present on every advertisement.
   *
   * allowDuplicates is true (was false): with it false, a peripheral whose
   * *first* delivered advertisement happens to omit the local name (name and
   * service UUID can arrive in separate AD packets — real, timing-dependent
   * CoreBluetooth behavior, not a device bug) got silently dropped by the old
   * `device?.name` filter and, because duplicates were suppressed, was never
   * reported again for the rest of that scan — a classic "sometimes it just
   * doesn't find it" flake with no visible cause. true costs more radio/CPU
   * (every advertisement re-fires the callback) but that's cheap for an 8-10s
   * window scanning for two known sensors, and callers already dedupe by id.
   */
  async scan(
    onDeviceFound: (device: Device) => void,
    timeoutMs = 10000,
    onError?: (message: string) => void
  ): Promise<boolean> {
    if (this.isScanning) {
      onError?.("a scan is already in progress");
      return false;
    }

    const state = await this.manager.state();
    if (state !== "PoweredOn") {
      onError?.(`bluetooth isn't ready (${state})`);
      return false;
    }

    this.isScanning = true;

    this.manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: true },
      (error, device) => {
        if (error) {
          console.warn("[BLE] Scan error:", error.message);
          this.isScanning = false;
          onError?.(error.message);
          return;
        }
        if (device) {
          onDeviceFound(device);
        }
      }
    );

    setTimeout(() => {
      this.manager.stopDeviceScan();
      this.isScanning = false;
    }, timeoutMs);

    return true;
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
    this.isScanning = false;
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /**
   * Connect a s'pot to a slot and subscribe to its IMU data notifications.
   * Safe to call even if the slot already has a device — existing connection
   * is cleanly torn down first.
   */
  async connectDevice(device: Device, slot: SensorSlot): Promise<void> {
    try {
      // Must stop scanning before connecting — BLE stack limitation
      this.stopScan();
      await new Promise((r) => setTimeout(r, 300));

      // Tear down any existing connection in this slot
      await this.disconnectSlot(slot);

      // Wait for any in-flight background reconnect (the other slot dropped
      // and the user chose "try to reconnect") to finish first, and hold the
      // same lock while this connect runs. Without this, a foreground connect
      // here and a background reconnectDirect() for the other slot can issue
      // device.connect() at the same time — two simultaneous BLE central
      // connect operations cancel each other on iOS (see runReconnectLoop's
      // own use of this same lock, which only protected itself from itself
      // until now).
      const connected = await this.withConnectLock(async () => {
        const d = await device.connect({ timeout: CONNECT_TIMEOUT_MS });
        await d.discoverAllServicesAndCharacteristics();
        return d;
      });

      this.adoptConnected(device, connected, slot);

    } catch (e: any) {
      console.error(`[BLE] Failed to connect ${slot} s'pot:`, e.message);
      captureError(e, "spot-connect", { slot });
      this.onStatus?.(slot, {
        connected: false, deviceId: null, deviceName: null,
      });
    }
  }

  // ── Disconnection ─────────────────────────────────────────────────────────

  async disconnectSlot(slot: SensorSlot): Promise<void> {
    // Mark as intentional — prevents onDeviceDisconnected from auto-reconnecting
    this.manuallyDisconnected[slot] = true;
    this.reconnecting[slot] = false;
    // A stray notify-error / onDeviceDisconnected after teardown must not
    // re-surface this as an unexpected drop.
    this.dropHandled[slot] = true;

    // Remove the disconnect subscription so the stale handler can't fire
    this.disconnectSubs[slot]?.remove();
    this.disconnectSubs[slot] = null;

    this.subscriptions[slot]?.remove();
    this.subscriptions[slot] = null;

    const device = this.devices[slot];
    if (device) {
      try { await device.cancelConnection(); } catch {}
      this.devices[slot] = null;
      // Deliberately disconnected — don't restore it into this slot later.
      void this.writeSlot(slot, null);
    }

    this.onStatus?.(slot, {
      connected: false, deviceId: null, deviceName: null,
    });
  }

  async disconnectAll(): Promise<void> {
    this.stopScan();
    await Promise.all([
      this.disconnectSlot("top"),
      this.disconnectSlot("bottom"),
    ]);
  }

  // ── Reconnection (user-confirmed) ─────────────────────────────────────────
  //
  // An unexpected drop (see onUnexpectedDisconnect above) no longer retries
  // on its own — the app prompts "end session, or try to reconnect?" and
  // calls one of these with the user's answer.

  /**
   * User chose to try reconnecting. Runs the same 5-attempt, escalating-
   * backoff retry loop as before this was gated behind confirmation,
   * serialised across slots so parallel BLE connects don't cancel each
   * other on iOS.
   */
  confirmReconnect(device: Device, slot: SensorSlot): void {
    if (this.reconnecting[slot] || this.devices[slot] !== null) return;
    this.reconnecting[slot] = true;
    this.runReconnectLoop(device, slot);
  }

  /**
   * User chose to end the session instead of reconnecting. The disconnect's
   * cleanup (finalizing the session, clearing sensor state) already ran when
   * the drop was first detected — this just guards against a reconnect ever
   * starting for it.
   */
  cancelReconnect(slot: SensorSlot): void {
    this.reconnecting[slot] = false;
    this.manuallyDisconnected[slot] = true;
  }

  /**
   * Wires up the "this slot's device dropped" listener, shared by the
   * initial connectDevice() and every successful reconnectDirect() — without
   * re-registering here after each reconnect, only the *first* unexpected
   * drop for a given slot would ever be noticed; later drops on the
   * reconnected device would go completely silent (no prompt, no cleanup).
   *
   * `device` is the original handle threaded through retries (used to start
   * another reconnect attempt); `connected` is the live post-.connect()
   * Device whose id the listener is scoped to.
   */
  private registerDisconnectHandler(device: Device, connected: Device, slot: SensorSlot): void {
    // Remove any stale handler from a prior connection on this slot first.
    // Without this, both the old and new handlers fire on disconnect, which
    // clears manuallyDisconnected before the second handler reads it.
    this.disconnectSubs[slot]?.remove();
    this.disconnectSubs[slot] = this.manager.onDeviceDisconnected(connected.id, () => {
      this.handleUnexpectedDrop(slot, device);
    });
  }

  /**
   * Single choke point for a dropped slot, reached from BOTH the
   * characteristic notify-error callback and the onDeviceDisconnected
   * listener — either can win the race for a given drop, and powering a
   * s'pot off / walking out of range usually fires the notify error first,
   * which is why the prompt has to hang off this and not just
   * onDeviceDisconnected. dropHandled[slot] de-dupes; connectDevice() and
   * reconnectDirect() clear it on a fresh connection.
   *
   * `device` is the original Device handle (threaded through retries) so a
   * subsequent confirmReconnect() has something to reconnect.
   */
  private handleUnexpectedDrop(slot: SensorSlot, device: Device): void {
    if (this.dropHandled[slot]) return;
    this.dropHandled[slot] = true;

    console.log(`[BLE] ${slot} s'pot disconnected`);
    this.devices[slot] = null;
    this.subscriptions[slot]?.remove();
    this.subscriptions[slot] = null;

    this.onStatus?.(slot, { connected: false, deviceId: null, deviceName: null });

    // Explicit disconnect — the app already knows, no prompt.
    if (this.manuallyDisconnected[slot]) {
      console.log(`[BLE] ${slot} manually disconnected — skipping reconnect prompt`);
      this.manuallyDisconnected[slot] = false;
      return;
    }

    // A reconnect attempt from an earlier prompt is already running.
    if (this.reconnecting[slot]) {
      console.log(`[BLE] ${slot} reconnect already in flight — skipping`);
      return;
    }

    // Unexpected — hand it to the app to ask "reconnect s'pot, or end session?"
    this.onUnexpectedDisconnect?.(slot, device);
  }

  /**
   * Runs `fn` once every earlier connect operation (a foreground
   * connectDevice() or either slot's reconnect loop) has finished — only one
   * BLE central connect should be in flight at a time, since two simultaneous
   * device.connect() calls cancel each other on iOS. Each caller takes its
   * place in the queue synchronously, so two callers can never both see it
   * free (the old check-then-set flag could, if two timers fired in one batch).
   * Waits at most 15s on the previous operation so a stuck one can't wedge
   * every future connect.
   */
  private withConnectLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.connectQueue;
    const run = (async () => {
      await Promise.race([previous, new Promise((r) => setTimeout(r, 15000))]);
      return fn();
    })();
    this.connectQueue = run.then(() => {}, () => {});
    return run;
  }

  private async runReconnectLoop(device: Device, slot: SensorSlot): Promise<void> {
    let attempts = 0;

    while (attempts < 5) {
      attempts++;
      const delayMs = attempts * 2000;
      console.log(`[BLE] ${slot} reconnect attempt ${attempts}/5 in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));

      if (this.devices[slot] !== null) {
        console.log(`[BLE] ${slot} already reconnected externally — aborting loop`);
        break;
      }

      // Wait for any other slot (or a foreground connectDevice()) to finish
      // first — prevents parallel BLE connections which cancel each other on iOS
      try {
        await this.withConnectLock(async () => {
          if (this.devices[slot] !== null) return; // reconnected while waiting
          await this.reconnectDirect(device, slot);
          console.log(`[BLE] ${slot} s'pot reconnected`);
        });
        break;
      } catch (e: any) {
        console.warn(`[BLE] ${slot} reconnect attempt ${attempts} failed:`, e.message);
        if (attempts >= 5) {
          console.log(`[BLE] ${slot} giving up after 5 attempts`);
        }
      }
    }

    this.reconnecting[slot] = false;
  }

  // ── Identity helpers ──────────────────────────────────────────────────────

  /**
   * Returns the device IDs of all currently connected s'pots.
   * Used by the picker in sensor-setup to filter out already-connected devices
   * so the user can't accidentally assign the same s'pot to two slots.
   */
  getConnectedDeviceIds(): string[] {
    return (["top", "bottom"] as SensorSlot[])
      .map((slot) => this.devices[slot]?.id)
      .filter((id): id is string => id !== undefined && id !== null);
  }

  getConnectionState(slot: SensorSlot): SensorState {
    const device = this.devices[slot];
    return {
      connected:  device !== null,
      deviceId:   device?.id   ?? null,
      deviceName: device?.name ?? null,
    };
  }

  // ── Hardware calibration command ──────────────────────────────────────────

  /** Send accelerometer calibration command sequence to a s'pot's IMU */
  async calibrate(slot: SensorSlot): Promise<void> {
    const device = this.devices[slot];
    if (!device) return;
    try {
      await this.writeCommand(device, CMD_UNLOCK);
      await new Promise((r) => setTimeout(r, 200));
      await this.writeCommand(device, CMD_ACCEL_CALIBRATE);
      await new Promise((r) => setTimeout(r, 200));
      await this.writeCommand(device, CMD_SAVE);
    } catch (e: any) {
      console.warn("[BLE] Hardware calibrate error:", e.message);
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Write a command byte array to a s'pot's write characteristic.
   * Uses btoa() — NOT Buffer.from() which is unavailable in the RN JS runtime.
   */
  /**
 * Reconnect path used exclusively by the auto-reconnect loop.
 * Unlike connectDevice(), this does NOT call disconnectSlot() first —
 * that would cancel the pending connection and cause an infinite loop.
 */
  private async reconnectDirect(device: Device, slot: SensorSlot): Promise<void> {
    const connected = await device.connect({ timeout: CONNECT_TIMEOUT_MS });
    await connected.discoverAllServicesAndCharacteristics();
    this.adoptConnected(device, connected, slot);
  }

  /**
   * Shared tail of every path that ends with a live, discovered connection
   * in a slot: a fresh connect, a reconnect, and a peripheral handed back by
   * iOS state restoration. Marks the slot connected, subscribes to the IMU
   * notify characteristic and arms the disconnect listener.
   *
   * `device` is the original handle threaded through retries (used to start
   * another reconnect attempt); `connected` is the live post-.connect() Device.
   */
  private adoptConnected(device: Device, connected: Device, slot: SensorSlot): void {
    this.devices[slot] = connected;
    // Fresh connection is live — a later drop on it is unexpected until
    // proven otherwise, so clear both suppression flags now.
    this.dropHandled[slot] = false;
    this.manuallyDisconnected[slot] = false;
    void this.writeSlot(slot, connected.id);
    this.onStatus?.(slot, {
      connected:  true,
      deviceId:   connected.id,
      deviceName: connected.name,
    });

    this.subscriptions[slot]?.remove();
    this.subscriptions[slot] = connected.monitorCharacteristicForService(
      SERVICE_UUID,
      NOTIFY_UUID,
      (error: BleError | null, characteristic: Characteristic | null) => {
        if (error) {
          console.warn(`[BLE] ${slot} s'pot notify error:`, error.message);
          this.handleUnexpectedDrop(slot, device);
          return;
        }
        if (characteristic?.value) {
          // Decode base64 — use btoa/atob, NOT Buffer (not in RN JS runtime)
          const binaryStr = atob(characteristic.value);
          const bytes     = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          this.onData?.(slot, new DataView(bytes.buffer));
        }
      }
    );

    // Re-armed on every (re)connect so a *second* unexpected drop is caught
    // too — see registerDisconnectHandler()'s doc comment.
    this.registerDisconnectHandler(device, connected, slot);
  }

  private async writeCommand(device: Device, cmd: Uint8Array): Promise<void> {
    const base64 = btoa(String.fromCharCode(...cmd));
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      WRITE_UUID,
      base64
    );
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
export const bleService = new BLEService();
