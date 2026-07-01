// UDP transport (roadmap §9) — datagram socket for LAN discovery + Modbus-UDP.
//
// Used by ONVIF WS-Discovery replies, signage UDP frames, and any IP device
// that speaks datagram protocols. node:dgram cross-compiles into the Bun
// binary without native addons.

import { createSocket, type BindOptions, type Socket } from 'node:dgram';

import type { Transport, TransportAddress, TransportHealth } from './types';
import { parseHostPort } from './types';

export class UdpTransport implements Transport {
  private socket: Socket | null = null;
  private readonly chunks: { data: Buffer; from: string }[] = [];
  private bound = false;
  /** Default remote when write() is called without a per-call target. */
  private defaultRemote: { host: string; port: number } | null = null;

  constructor(readonly address: TransportAddress) {
    const hp = parseHostPort(address.endpoint);
    if (hp) this.defaultRemote = hp;
  }

  open(): Promise<boolean> {
    return new Promise((resolve) => {
      const hp = parseHostPort(this.address.endpoint);
      // For UDP, "open" means bind a socket. If the endpoint is a remote only
      // (no local bind specified), bind to an ephemeral port.
      const bind: BindOptions = this.address.params?.localPort
        ? { port: Number(this.address.params.localPort) }
        : { port: 0 };
      try {
        const socket = createSocket('udp4');
        socket.on('error', () => {
          this.bound = false;
        });
        socket.on('message', (data, rinfo) => {
          this.chunks.push({ data, from: `${rinfo.address}:${rinfo.port}` });
        });
        socket.bind(bind, () => {
          this.bound = true;
          if (hp) this.defaultRemote = hp;
          resolve(true);
        });
        this.socket = socket;
      } catch {
        resolve(false);
      }
    });
  }

  async write(data: Uint8Array): Promise<boolean> {
    const s = this.socket;
    if (!s || !this.bound) return false;
    const target = this.resolveRemote();
    if (!target) return false;
    return new Promise((resolve) => {
      s.send(Buffer.from(data), target.port, target.host, (err) => resolve(!err));
    });
  }

  /** Send to an explicit remote (multicast/discovery) instead of the default. */
  sendTo(data: Uint8Array, host: string, port: number): Promise<boolean> {
    const s = this.socket;
    if (!s || !this.bound) return Promise.resolve(false);
    return new Promise((resolve) => {
      s.send(Buffer.from(data), port, host, (err) => resolve(!err));
    });
  }

  read(timeoutMs = 1000): Promise<Uint8Array | null> {
    if (this.chunks.length > 0) {
      return Promise.resolve(new Uint8Array(this.chunks.shift()!.data));
    }
    if (!this.socket || !this.bound) return Promise.resolve(null);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.chunks.length > 0) {
          resolve(new Uint8Array(this.chunks.shift()!.data));
        } else {
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  health(): Promise<TransportHealth> {
    return Promise.resolve({
      online: this.bound,
      error: !this.bound,
      label: this.bound ? 'Dinleniyor' : 'Kapalı',
    });
  }

  async close(): Promise<void> {
    const s = this.socket;
    this.socket = null;
    this.bound = false;
    if (s) {
      try {
        s.close();
      } catch {
        // noop
      }
    }
  }

  private resolveRemote(): { host: string; port: number } | null {
    if (this.defaultRemote) return this.defaultRemote;
    const ep = this.address.params?.remote as string | undefined;
    if (ep) {
      const hp = parseHostPort(ep);
      if (hp) return hp;
    }
    return null;
  }
}
