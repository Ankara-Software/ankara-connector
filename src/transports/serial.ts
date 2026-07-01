// Serial / RS232 transport (roadmap §7).
//
// Uses the `serialport` native addon when present. The addon is NOT a bundled
// dependency (it needs native compilation per platform), so the transport
// loads it lazily and degrades to a clear "sürücü modülü yüklenemedi" health
// state when absent. This keeps the core single-binary build clean while
// making real serial I/O work the moment `serialport` is installed alongside
// the binary (e.g. in an OS-specific package).

import { requireNativeModule } from './native-loader';
import type { Transport, TransportAddress, TransportHealth } from './types';
import { SERIAL_DEFAULTS } from './types';

interface SerialPortApi {
  SerialPort: {
    new (opts: Record<string, unknown>): SerialPortInstance;
  };
}

interface SerialPortInstance {
  open(cb: (err: Error | null) => void): void;
  write(data: Buffer, cb: (err: Error | null) => void): void;
  on(event: 'data', cb: (data: Buffer) => void): void;
  on(event: 'close', cb: () => void): void;
  close(cb?: (err: Error | null) => void): void;
  isOpen: boolean;
}

export class SerialTransport implements Transport {
  private port: SerialPortInstance | null = null;
  private readonly chunks: Buffer[] = [];
  private openError: string | null = null;

  constructor(readonly address: TransportAddress) {}

  open(): Promise<boolean> {
    const mod = requireNativeModule<SerialPortApi>('serialport');
    if (!mod.ok) {
      this.openError = mod.message;
      return Promise.resolve(false);
    }
    const baudRate = Number(this.address.params?.baudRate ?? SERIAL_DEFAULTS.baudRate);
    const dataBits = Number(this.address.params?.dataBits ?? SERIAL_DEFAULTS.dataBits);
    const stopBits = Number(this.address.params?.stopBits ?? SERIAL_DEFAULTS.stopBits);
    const parity = String(this.address.params?.parity ?? SERIAL_DEFAULTS.parity);
    return new Promise((resolve) => {
      try {
        const port = new mod.api.SerialPort({
          path: this.address.endpoint,
          baudRate,
          dataBits,
          stopBits,
          parity,
          autoOpen: false,
        });
        port.open((err) => {
          if (err) {
            this.openError = err.message;
            resolve(false);
            return;
          }
          resolve(true);
        });
        port.on('data', (b: Buffer) => this.chunks.push(b));
        port.on('close', () => {
          this.port = null;
        });
        this.port = port;
      } catch (e) {
        this.openError = (e as Error).message;
        resolve(false);
      }
    });
  }

  async write(data: Uint8Array): Promise<boolean> {
    const p = this.port;
    if (!p || !p.isOpen) return false;
    return new Promise((resolve) => p.write(Buffer.from(data), (err) => resolve(!err)));
  }

  read(timeoutMs = 1000): Promise<Uint8Array | null> {
    if (this.chunks.length > 0) {
      return Promise.resolve(new Uint8Array(this.chunks.splice(0).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))));
    }
    if (!this.port) return Promise.resolve(null);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.chunks.length > 0) {
          const buf = this.chunks.splice(0).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0));
          resolve(new Uint8Array(buf));
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
    const online = !!this.port?.isOpen;
    return Promise.resolve({
      online,
      error: !online,
      label: online ? 'Çevrimiçi' : 'Çevrimdışı',
    });
  }

  async close(): Promise<void> {
    const p = this.port;
    this.port = null;
    if (p) {
      await new Promise<void>((res) => p.close(() => res()));
    }
  }
}
