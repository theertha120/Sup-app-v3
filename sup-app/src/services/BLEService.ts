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
 */

import { BleManager, Device, Characteristic, BleError } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";

// ── UUIDs ─────────────────────────────────────────────────────────────────────
const SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
const NOTIFY_UUID  = "0000ffe4-0000-1000-8000-00805f9a34fb";
const WRITE_UUID   = "0000ffe9-0000-1000-8000-00805f9a34fb";

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
  private reconnectingAny = false; // global lock — only one slot reconnects at a time

  // Manual disconnect flag — set when the user explicitly disconnects a slot.
  // Prevents auto-reconnect from firing after an intentional disconnection.
  private manuallyDisconnected: Record<SensorSlot, boolean> = { top: false, bottom: false };

  // onDeviceDisconnected subscriptions — one per slot, removed before re-registering
  // so stale handlers from previous connections don't fire on the next disconnect.
  private disconnectSubs: Record<SensorSlot, { remove: () => void } | null> = { top: null, bottom: null };
  private onData?:   DataCallback;
  private onStatus?: StatusCallback;

  constructor() {
    this.manager = new BleManager();

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

  setCallbacks(onData: DataCallback, onStatus: StatusCallback) {
    this.onData   = onData;
    this.onStatus = onStatus;
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
   * Fires onDeviceFound for each new device seen.
   * Automatically stops after timeoutMs.
   *
   * Filtering to s'pots is done by SERVICE_UUID alone (passed to
   * startDeviceScan below) — that's the actual "is this our hardware" gate,
   * since the FFE5 service is only advertised by s'pot firmware. There used
   * to also be a `device.name?.startsWith("WT")` check here, back when every
   * unit shipped with the factory-default "WT901BLE.." name — but pilot
   * units now get renamed to unique per-kit names (e.g. "s'pot_top_0048.05-08",
   * see src/lib/spotNaming.ts) to fix a BLE-name-collision issue, so a
   * hardcoded prefix would silently exclude every renamed sensor. Don't
   * reintroduce a name-prefix filter here.
   */
  scan(onDeviceFound: (device: Device) => void, timeoutMs = 10000): void {
    if (this.isScanning) return;
    this.isScanning = true;

    this.manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          console.warn("[BLE] Scan error:", error.message);
          this.isScanning = false;
          return;
        }
        if (device?.name) {
          onDeviceFound(device);
        }
      }
    );

    setTimeout(() => {
      this.manager.stopDeviceScan();
      this.isScanning = false;
    }, timeoutMs);
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

      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();

      this.devices[slot] = connected;
      this.onStatus?.(slot, {
        connected:  true,
        deviceId:   connected.id,
        deviceName: connected.name,
      });

      // Subscribe to IMU data notifications from the s'pot
      this.subscriptions[slot] = connected.monitorCharacteristicForService(
        SERVICE_UUID,
        NOTIFY_UUID,
        (error: BleError | null, characteristic: Characteristic | null) => {
          if (error) {
            console.warn(`[BLE] ${slot} s'pot notify error:`, error.message);
            this.onStatus?.(slot, {
              connected: false, deviceId: null, deviceName: null,
            });
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

      // ── Disconnection handler with reconnect guard ──────────────────────
      // Remove any stale handler from a prior connection on this slot before
      // registering a new one. Without this, both the old and new handlers fire
      // on disconnect, which clears manuallyDisconnected before the second
      // handler reads it and incorrectly triggers auto-reconnect.
      this.disconnectSubs[slot]?.remove();
      this.disconnectSubs[slot] = this.manager.onDeviceDisconnected(connected.id, async () => {
        console.log(`[BLE] ${slot} s'pot disconnected`);
        this.devices[slot] = null;
        this.onStatus?.(slot, {
          connected: false, deviceId: null, deviceName: null,
        });

        // Skip reconnect if the user explicitly disconnected
        if (this.manuallyDisconnected[slot]) {
          console.log(`[BLE] ${slot} manually disconnected — skipping auto-reconnect`);
          this.manuallyDisconnected[slot] = false;
          return;
        }

        // Only attempt reconnect if not already reconnecting this slot
        if (this.reconnecting[slot]) {
          console.log(`[BLE] ${slot} reconnect already in flight — skipping`);
          return;
        }

        this.reconnecting[slot] = true;
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

          // Wait for any other slot to finish reconnecting first
          // This prevents parallel BLE connections which cancel each other on iOS
          let waited = 0;
          while (this.reconnectingAny && waited < 15000) {
            await new Promise((r) => setTimeout(r, 500));
            waited += 500;
          }

          if (this.devices[slot] !== null) break; // reconnected while waiting

          this.reconnectingAny = true;
          try {
            await this.reconnectDirect(device, slot);
            console.log(`[BLE] ${slot} s'pot reconnected`);
            break;
          } catch (e: any) {
            console.warn(`[BLE] ${slot} reconnect attempt ${attempts} failed:`, e.message);
            if (attempts >= 5) {
              console.log(`[BLE] ${slot} giving up after 5 attempts`);
            }
          } finally {
            this.reconnectingAny = false;
          }
        }

        this.reconnecting[slot] = false;
      });

    } catch (e: any) {
      console.error(`[BLE] Failed to connect ${slot} s'pot:`, e.message);
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

    // Remove the disconnect subscription so the stale handler can't fire
    this.disconnectSubs[slot]?.remove();
    this.disconnectSubs[slot] = null;

    this.subscriptions[slot]?.remove();
    this.subscriptions[slot] = null;

    const device = this.devices[slot];
    if (device) {
      try { await device.cancelConnection(); } catch {}
      this.devices[slot] = null;
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
    const connected = await device.connect();
    await connected.discoverAllServicesAndCharacteristics();

    this.devices[slot] = connected;
    this.onStatus?.(slot, {
      connected:  true,
      deviceId:   connected.id,
      deviceName: connected.name,
    });

    this.subscriptions[slot] = connected.monitorCharacteristicForService(
      SERVICE_UUID,
      NOTIFY_UUID,
      (error: BleError | null, characteristic: Characteristic | null) => {
        if (error) {
          console.warn(`[BLE] ${slot} s'pot notify error:`, error.message);
          this.onStatus?.(slot, {
            connected: false, deviceId: null, deviceName: null,
          });
          return;
        }
        if (characteristic?.value) {
          const binaryStr = atob(characteristic.value);
          const bytes     = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          this.onData?.(slot, new DataView(bytes.buffer));
        }
      }
    );
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