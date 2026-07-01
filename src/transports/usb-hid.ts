// USB HID transport (roadmap §8) — barcode scanners, pole displays, HID devices.
//
// Uses the `node-hid` native addon when present. Scanners in keyboard-wedge
// mode appear as HID devices and emit scanned codes as input reports; raw-data
// mode reads report bytes directly. Like the serial transport, the addon is
// loaded lazily so the core build stays clean and the agent surfaces a clear
// error when the HID driver module is not installed.

import { requireNativeModule } from './native-loader';
import { parseVidPid } from './types';
import type { Transport, TransportAddress, TransportHealth } from './types';

interface HidApi {
  HID: { new (vid: number, pid: number): HidDevice };
  devices(vid?: number, pid?: number): { vendorId: number; productId: number; path: string; product?: string }[];
}

interface HidDevice {
  write(data: Buffer[]): number;
  read(cb: (err: Error | null, data: Buffer) => void): void;
  on(event: 'data', cb: (data: Buffer) => void): void;
  close(): void;
}

export class UsbHidTransport implements Transport {
  private device: HidDevice | null = null;
  private readonly chunks: Buffer[] = [];
  private openError: string | null = null;
  private readonly vid: number;
  private readonly pid: number;

  constructor(readonly address: TransportAddress) {
    const vp = parseVidPid(address.endpoint);
    this.vid = vp?.vid ?? 0;
    this.pid = vp?.pid ?? 0;
  }

  open(): Promise<boolean> {
    const mod = requireNativeModule<HidApi>('node-hid');
    if (!mod.ok) {
      this.openError = mod.message;
      return Promise.resolve(false);
    }
    if (!this.vid || !this.pid) {
      this.openError = 'Geçersiz vid:pid';
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      try {
        const device = new mod.api.HID(this.vid, this.pid);
        device.on('data', (b: Buffer) => this.chunks.push(b));
        this.device = device;
        resolve(true);
      } catch (e) {
        this.openError = (e as Error).message;
        resolve(false);
      }
    });
  }

  async write(data: Uint8Array): Promise<boolean> {
    const d = this.device;
    if (!d) return false;
    try {
      // HID write expects a leading report-id byte (0 for default report).
      const buf = Buffer.concat([Buffer.from([0]), Buffer.from(data)]);
      const n = d.write([buf]);
      return n > 0;
    } catch {
      return false;
    }
  }

  read(timeoutMs = 1000): Promise<Uint8Array | null> {
    if (this.chunks.length > 0) {
      return Promise.resolve(new Uint8Array(this.chunks.shift()!));
    }
    if (!this.device) return Promise.resolve(null);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.chunks.length > 0) {
          resolve(new Uint8Array(this.chunks.shift()!));
        } else {
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  health(): Promise<TransportHealth> {
    if (this.openError) {
      return Promise.resolve({
        online: false,
        error: true,
        label: 'Sürücü modülü yüklenemedi',
        detail: { reason: this.openError },
      });
    }
    return Promise.resolve({
      online: !!this.device,
      error: !this.device,
      label: this.device ? 'Çevrimiçi' : 'Çevrimdışı',
    });
  }

  async close(): Promise<void> {
    const d = this.device;
    this.device = null;
    try {
      d?.close();
    } catch {
      // noop
    }
  }

  /** Enumerate connected HID devices (when the addon is present). */
  static enumerate(): { vendorId: number; productId: number; product?: string }[] {
    const mod = requireNativeModule<HidApi>('node-hid');
    if (!mod.ok) return [];
    try {
      return mod.api.devices();
    } catch {
      return [];
    }
  }
}
