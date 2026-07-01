// Raw USB printer transport (enterprise §2: Windows Spooler Bypass).
//
// ESC/POS / ZPL printers attached over USB are normally driven through the OS
// print spooler, which adds latency, driver conflicts, and queue stalls. For
// enterprise reliability we bypass the spooler and write raw bytes directly to
// the USB endpoint — 10x faster and immune to driver clashes. On Windows this
// means claiming the printer's USB bulk endpoint; the `usb` (libusb) native
// addon handles that cross-platform. Loaded lazily for the same build-hygiene
// reason as serial/HID.

import { requireNativeModule } from './native-loader';
import { parseVidPid } from './types';
import type { Transport, TransportAddress, TransportHealth } from './types';

interface UsbApi {
  findByIds(vid: number, pid: number): UsbDevice | null;
  getDeviceList(): UsbDevice[];
}

interface UsbDevice {
  open(): void;
  interfaces: { claim(): void; endpoint(out: boolean): UsbEndpoint | undefined }[];
  close(): void;
}

interface UsbEndpoint {
  transfer(data: Buffer, cb: (err: Error | null, len: number) => void): void;
}

export class UsbRawTransport implements Transport {
  private device: UsbDevice | null = null;
  private outEndpoint: UsbEndpoint | null = null;
  private openError: string | null = null;
  private readonly vid: number;
  private readonly pid: number;

  constructor(readonly address: TransportAddress) {
    const vp = parseVidPid(address.endpoint);
    this.vid = vp?.vid ?? 0;
    this.pid = vp?.pid ?? 0;
  }

  open(): Promise<boolean> {
    const mod = requireNativeModule<UsbApi>('usb');
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
        const dev = mod.api.findByIds(this.vid, this.pid);
        if (!dev) {
          this.openError = 'USB cihaz bulunamadı';
          resolve(false);
          return;
        }
        dev.open();
        const iface = dev.interfaces[0];
        if (!iface) {
          this.openError = 'USB arayüzü yok';
          resolve(false);
          return;
        }
        iface.claim();
        this.outEndpoint = iface.endpoint(true) ?? null;
        this.device = dev;
        resolve(true);
      } catch (e) {
        this.openError = (e as Error).message;
        resolve(false);
      }
    });
  }

  async write(data: Uint8Array): Promise<boolean> {
    const ep = this.outEndpoint;
    if (!ep) return false;
    return new Promise((resolve) => {
      try {
        ep.transfer(Buffer.from(data), (err) => resolve(!err));
      } catch {
        resolve(false);
      }
    });
  }

  read(_timeoutMs = 1000): Promise<Uint8Array | null> {
    // Raw USB printer endpoints are typically write-only; no read path.
    return Promise.resolve(null);
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
      online: !!this.outEndpoint,
      error: !this.outEndpoint,
      label: this.outEndpoint ? 'Çevrimiçi' : 'Çevrimdışı',
    });
  }

  async close(): Promise<void> {
    const d = this.device;
    this.device = null;
    this.outEndpoint = null;
    try {
      d?.close();
    } catch {
      // noop
    }
  }
}
