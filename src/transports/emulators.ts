// Hardware emulators (roadmap §41) — serial-port + USB-HID device simulators.
//
// `LoopbackTransport` is a generic byte pipe; these emulators go one step
// further and *behave like a specific device*: they react to host writes with
// protocol-correct responses, so a driver can be exercised end-to-end against
// a fake thermal printer (ESC/POS health) or a fake barrier (Modbus coil echo)
// without any physical hardware or native addon. Used by the `selftest` /
// `--virtual` flow and by per-driver conformance tests.
//
// Each emulator implements the `Transport` interface so it can be registered as
// a transport-factory override (`registerTransportFactory`) for `serial` /
// `usb-hid` kinds during tests.

import type { Transport, TransportAddress, TransportHealth } from './types';

export type EmulatorResponder = (data: Uint8Array) => Uint8Array | null | void;

/**
 * A serial/USB-HID transport that emulates a device. Host writes are passed to
 * a responder; the responder's returned bytes become the next `read()` result.
 * If the responder returns null, no response is queued (the host read will
 * time out). Bytes the responder does not consume can be inspected for
 * assertions via `lastWrite()`.
 */
export class EmulatorTransport implements Transport {
  private readonly inbox: Uint8Array[] = [];
  private open_ = false;
  private last: Uint8Array | null = null;
  private readonly writes: Uint8Array[] = [];

  constructor(
    readonly address: TransportAddress,
    private readonly responder: EmulatorResponder,
    private readonly healthState: TransportHealth = { online: true, error: false, label: 'Öykünücü' },
  ) {}

  async open(): Promise<boolean> {
    this.open_ = true;
    return this.healthState.online;
  }

  async write(data: Uint8Array): Promise<boolean> {
    if (!this.open_ || !this.healthState.online) return false;
    const copy = new Uint8Array(data);
    this.last = copy;
    this.writes.push(copy);
    const resp = this.responder(copy);
    if (resp) this.inbox.push(new Uint8Array(resp));
    return true;
  }

  async read(timeoutMs = 200): Promise<Uint8Array | null> {
    if (this.inbox.length > 0) return this.inbox.shift()!;
    if (timeoutMs <= 0) return null;
    await new Promise((r) => setTimeout(r, Math.min(20, timeoutMs)));
    return this.inbox.shift() ?? null;
  }

  health(): Promise<TransportHealth> {
    return Promise.resolve(this.healthState);
  }

  async close(): Promise<void> {
    this.open_ = false;
    this.inbox.length = 0;
  }

  /** Most recent host write (for assertions). */
  lastWrite(): Uint8Array | null {
    return this.last;
  }

  /** All host writes (for protocol conformance assertions). */
  allWrites(): Uint8Array[] {
    return this.writes;
  }

  /** Inject an unsolicited device→host frame (e.g. a scanned barcode). */
  inject(data: Uint8Array): void {
    this.inbox.push(new Uint8Array(data));
  }
}

// --- canned responders for common devices -------------------------------

const DLE = 0x10;
const EOT = 0x04;

/**
 * ESC/POS thermal printer emulator: responds to `DLE EOT n` health probes with
 * a "healthy" status byte (all clear). Other writes are accepted silently.
 */
export function escposHealthResponder(): EmulatorResponder {
  return (data) => {
    if (data.length >= 3 && data[0] === DLE && data[1] === EOT) {
      // Return a single status byte: bit 5 online=0, bit 2 paper ok=0, etc.
      return new Uint8Array([0x00]);
    }
    return null;
  };
}

/**
 * Modbus barrier emulator: echoes a write-coil request back as a success
 * response (function 0x05 echo), and answers a read-coil request (0x01) with a
 * one-bit response. Minimal but enough to exercise the barrier driver.
 */
export function modbusBarrierResponder(): EmulatorResponder {
  return (data) => {
    if (data.length < 2) return null;
    const fn = data[1];
    if (fn === 0x05) {
      // echo the request as the ack
      return new Uint8Array(data);
    }
    if (fn === 0x01) {
      // read coils: respond with 1 byte = 0x01 (coil on)
      return new Uint8Array([data[0], fn, 0x02, 0x01, 0x01, 0x00, 0x00]);
    }
    return null;
  };
}

/** USB-HID barcode scanner emulator: emits scanned code bytes on demand. */
export class HidScannerEmulator {
  constructor(private readonly transport: EmulatorTransport) {}

  /** Simulate a scan: push the code + CR into the host's inbox. */
  scan(code: string): void {
    const bytes = new TextEncoder().encode(code + '\r');
    this.transport.inject(bytes);
  }
}
