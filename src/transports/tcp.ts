// TCP transport (roadmap §9) — reusable raw socket link.
//
// Generalizes src/printer.ts's network send into a duplex `Transport` so any
// capability driver (ESC/POS, ZPL, Modbus, LLRP, signage) can reach a LAN
// device over TCP without re-implementing node:net plumbing. Write is fire-and-
// forget; read drains the receive buffer within a timeout for duplex protocols
// (ESC/POS DLE EOT health, Modbus responses, LLRP tag reports).

import { createConnection, type Socket } from 'node:net';

import { parseHostPort } from './types';
import type { Transport, TransportAddress, TransportHealth } from './types';

export class TcpTransport implements Transport {
  private socket: Socket | null = null;
  private readonly chunks: Buffer[] = [];
  private connected = false;

  constructor(readonly address: TransportAddress) {}

  open(): Promise<boolean> {
    return new Promise((resolve) => {
      const hp = parseHostPort(this.address.endpoint);
      if (!hp) {
        resolve(false);
        return;
      }
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const socket = createConnection({ host: hp.host, port: hp.port }, () => {
        this.connected = true;
        done(true);
      });
      socket.on('data', (b: Buffer) => this.chunks.push(b));
      socket.on('error', () => done(false));
      socket.on('close', () => {
        this.connected = false;
      });
      const timer = setTimeout(() => done(false), 8000);
      this.socket = socket;
    });
  }

  async write(data: Uint8Array): Promise<boolean> {
    const s = this.socket;
    if (!s || !this.connected) return false;
    return new Promise((resolve) => {
      s.write(Buffer.from(data), (err) => resolve(!err));
    });
  }

  read(timeoutMs = 1000): Promise<Uint8Array | null> {
    if (this.chunks.length > 0) {
      const buf = Buffer.concat(this.chunks.splice(0));
      return Promise.resolve(new Uint8Array(buf));
    }
    if (!this.socket || !this.connected) return Promise.resolve(null);
    return new Promise((resolve) => {
      const onCheck = () => {
        clearTimeout(timer);
        if (this.chunks.length > 0) {
          resolve(new Uint8Array(Buffer.concat(this.chunks.splice(0))));
        } else {
          resolve(null);
        }
      };
      const timer = setTimeout(onCheck, timeoutMs);
    });
  }

  health(): Promise<TransportHealth> {
    return Promise.resolve({
      online: this.connected,
      error: !this.connected,
      label: this.connected ? 'Çevrimiçi' : 'Çevrimdışı',
    });
  }

  async close(): Promise<void> {
    const s = this.socket;
    this.socket = null;
    this.connected = false;
    if (s) {
      await new Promise<void>((res) => {
        s.end(() => res());
        s.destroy();
      });
    }
  }
}
