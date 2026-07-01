// In-memory loopback transport for tests + virtual device (roadmap §41).
//
// A pair of linked transports: writes to one appear as reads on the other.
// Used by unit tests and the `ankara-connector selftest --virtual` flow so
// drivers can be exercised end-to-end without physical hardware or native
// addons. Also useful for the hardware loopback tests (roadmap §40).

import type { Transport, TransportAddress, TransportHealth } from './types';

export class LoopbackTransport implements Transport {
  private readonly inbox: Uint8Array[] = [];
  private open_ = false;
  /** The peer whose writes land in this transport's inbox. */
  peer: LoopbackTransport | null = null;

  constructor(readonly address: TransportAddress) {}

  static pair(aAddr: TransportAddress, bAddr: TransportAddress): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport(aAddr);
    const b = new LoopbackTransport(bAddr);
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  async open(): Promise<boolean> {
    this.open_ = true;
    return true;
  }

  async write(data: Uint8Array): Promise<boolean> {
    if (!this.open_ || !this.peer) return false;
    this.peer.inbox.push(new Uint8Array(data));
    return true;
  }

  async read(timeoutMs = 200): Promise<Uint8Array | null> {
    if (this.inbox.length > 0) return this.inbox.shift()!;
    // Poll briefly so tests with a timeout still resolve.
    if (timeoutMs <= 0) return null;
    await new Promise((r) => setTimeout(r, Math.min(20, timeoutMs)));
    return this.inbox.shift() ?? null;
  }

  health(): Promise<TransportHealth> {
    return Promise.resolve({
      online: this.open_,
      error: !this.open_,
      label: this.open_ ? 'Çevrimiçi' : 'Çevrimdışı',
    });
  }

  async close(): Promise<void> {
    this.open_ = false;
    this.inbox.length = 0;
  }

  /** Test helper: inject bytes as if received from the device. */
  inject(data: Uint8Array): void {
    this.inbox.push(new Uint8Array(data));
  }
}

/** A transport that always reports a configured health state (failure sim). */
export class StubTransport implements Transport {
  constructor(
    readonly address: TransportAddress,
    private readonly healthState: TransportHealth,
  ) {}

  async open(): Promise<boolean> {
    return this.healthState.online;
  }
  async write(): Promise<boolean> {
    return this.healthState.online;
  }
  async read(): Promise<Uint8Array | null> {
    return null;
  }
  health(): Promise<TransportHealth> {
    return Promise.resolve(this.healthState);
  }
  async close(): Promise<void> {}
}
