/**
 * BLEService.ts
 * Manages BLE connections to two WT9011DCL sensors simultaneously.
 *
 * UUIDs from LightBlue scan:
 *   Service:  FFE5
 *   Write:    FFE9  (send commands TO sensor)
 *   Notify:   FFE4  (live data FROM sensor)
 */

import { BleManager, Device, Characteristic, BleError } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";

// ── UUIDs ──────────────────────────────────────────────────────────────────
const SERVICE_UUID  = "0000ffe5-0000-1000-8000-00805f9a34fb";
const NOTIFY_UUID   = "0000ffe4-0000-1000-8000-00805f9a34fb";
const WRITE_UUID    = "0000ffe9-0000-1000-8000-00805f9a34fb";

// ── Commands (from protocol doc) ────────────────────────────────────────────
// Unlock → must send before any config command (valid for 10 seconds)
const CMD_UNLOCK = new Uint8Array([0xFF, 0xAA, 0x69, 0x88, 0xB5]);
// Save current config
const CMD_SAVE   = new Uint8Array([0xFF, 0xAA, 0x00, 0x00, 0x00]);
// Accelerometer calibration
const CMD_ACCEL_CALIBRATE = new Uint8Array([0xFF, 0xAA, 0x01, 0x01, 0x00]);

// ── Types ───────────────────────────────────────────────────────────────────
export type SensorSlot = "top" | "bottom";

export interface SensorState {
  connected: boolean;
  deviceId: string | null;
  deviceName: string | null;
}

type DataCallback = (slot: SensorSlot, data: DataView) => void;
type StatusCallback = (slot: SensorSlot, state: SensorState) => void;

// ── Singleton BLE manager ───────────────────────────────────────────────────
class BLEService {
  private manager: BleManager;
  private devices: Record<SensorSlot, Device | null> = { top: null, bottom: null };
  private subscriptions: Record<SensorSlot, any> = { top: null, bottom: null };
  private isScanning = false;

  // Reconnect guard — prevents parallel reconnect loops for the same slot.
  // true = a reconnect is already in flight for that slot; ignore new attempts.
  private reconnecting: Record<SensorSlot, boolean> = { top: false, bottom: false };
  private reconnectingAny = false; // global lock — only one slot reconnects at a time
  private onData?:   DataCallback;

  private onStatus?: StatusCallback;

  constructor() {
    this.manager = new BleManager();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setCallbacks(onData: DataCallback, onStatus: StatusCallback) {
    this.onData   = onData;
    this.onStatus = onStatus;
  }

  /**
   * Request Bluetooth permissions (Android only, iOS handled via Info.plist).
   * Call this once before scanning.
   */
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
    return true; // iOS permissions come from app.json entitlements
  }

  /**
   * Scan for WT9011DCL devices (name starts with "WT").
   * Calls onDeviceFound for each discovered device.
   * Stops after timeoutMs.
   */
  scan(
    onDeviceFound: (device: Device) => void,
    timeoutMs = 10000
  ): void {
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
        if (device && device.name?.startsWith("WT")) {
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

  /**
   * Connect a discovered device to a slot ("top" or "bottom").
   * Automatically subscribes to notifications.
   */
  async connectDevice(device: Device, slot: SensorSlot): Promise<void> {
  try {
    // Stop scanning before connecting — critical, can't do both at once
    this.stopScan();
    await new Promise((r) => setTimeout(r, 300)); // short pause for BLE stack
    // Disconnect existing device in this slot if any
    await this.disconnectSlot(slot);

      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();

      this.devices[slot] = connected;
      this.onStatus?.(slot, {
        connected: true,
        deviceId: connected.id,
        deviceName: connected.name,
      });

      // Subscribe to notifications
      this.subscriptions[slot] = connected.monitorCharacteristicForService(
        SERVICE_UUID,
        NOTIFY_UUID,
        (error: BleError | null, characteristic: Characteristic | null) => {
          if (error) {
            console.warn(`[BLE] ${slot} notify error:`, error.message);
            this.onStatus?.(slot, {
              connected: false,
              deviceId: null,
              deviceName: null,
            });
            return;
          }
          if (characteristic?.value) {
            // Decode base64 without Buffer (not available in React Native)
            const binaryStr = atob(characteristic.value);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            const dataView = new DataView(bytes.buffer);
            this.onData?.(slot, dataView);
          }
        }
      );

      // Handle unexpected disconnection
      this.manager.onDeviceDisconnected(connected.id, () => {
        console.log(`[BLE] ${slot} disconnected`);
        this.devices[slot] = null;
        this.onStatus?.(slot, {
          connected: false,
          deviceId: null,
          deviceName: null,
        });

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
      console.error(`[BLE] Failed to connect ${slot}:`, e.message);
      this.onStatus?.(slot, {
        connected: false,
        deviceId: null,
        deviceName: null,
      });
    }
  }

  async disconnectSlot(slot: SensorSlot): Promise<void> {
    this.subscriptions[slot]?.remove();
    this.subscriptions[slot] = null;

    const device = this.devices[slot];
    if (device) {
      try {
        await device.cancelConnection();
      } catch {}
      this.devices[slot] = null;
    }

    this.onStatus?.(slot, {
      connected: false,
      deviceId: null,
      deviceName: null,
    });
  }

  async disconnectAll(): Promise<void> {
    this.stopScan();
    await Promise.all([
      this.disconnectSlot("top"),
      this.disconnectSlot("bottom"),
    ]);
  }

  /** Send accelerometer calibration command to a sensor */
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
      console.warn("[BLE] Calibrate error:", e.message);
    }
  }

  getConnectionState(slot: SensorSlot): SensorState {
    const device = this.devices[slot];
    return {
      connected: device !== null,
      deviceId: device?.id ?? null,
      deviceName: device?.name ?? null,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async writeCommand(device: Device, cmd: Uint8Array): Promise<void> {
    const base64 = Buffer.from(cmd).toString("base64");
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      WRITE_UUID,
      base64
    );
  }
}

// Export singleton
export const bleService = new BLEService();
