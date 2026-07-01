// Transport abstraction layer (roadmap §7-9, enterprise §2 + §5).
//
// Every physical link to a device — TCP, UDP, RS232 serial, USB HID, raw USB
// printer — implements one `Transport`. Capability drivers depend on this
// interface, not on a specific bus, so a printer driver is agnostic to whether
// it is reached over the network (TCP:9100) or a direct USB raw endpoint
// (enterprise §2: Windows Spooler Bypass). Native-addon transports (serial,
// HID, raw-USB) load lazily so the core single-binary build still cross-
// compiles when the addon is absent (roadmap §7-8).

export type TransportKind = 'tcp' | 'udp' | 'serial' | 'usb-hid' | 'usb-raw' | 'rtsp' | 'http';

export interface TransportAddress {
  kind: TransportKind;
  /** Transport-specific connection string (host:port, COM3, vid:pid, rtsp url). */
  endpoint: string;
  /** Optional transport params (baud, vid:pid, rtsp path, parity...). */
  params?: Record<string, string | number>;
}

export interface TransportHealth {
  online: boolean;
  error: boolean;
  label: string;
  /** Driver-specific detail (paper out, cover open, signal level...). */
  detail?: Record<string, unknown>;
}

export interface Transport {
  readonly address: TransportAddress;
  /** Open the link. Resolve false when the device is unreachable. */
  open(): Promise<boolean>;
  /** Write a raw byte buffer. Resolve false on write failure. */
  write(data: Uint8Array): Promise<boolean>;
  /** Read available bytes within a timeout. Returns null when nothing arrived. */
  read(timeoutMs?: number): Promise<Uint8Array | null>;
  /** Probe link health. */
  health(): Promise<TransportHealth>;
  /** Close the link and release resources. */
  close(): Promise<void>;
}

export interface TransportFactory {
  create(address: TransportAddress): Transport;
}

/** Parse a "host:port" endpoint string. Returns null when malformed. */
export function parseHostPort(endpoint: string): { host: string; port: number } | null {
  const m = endpoint.match(/^([^:]+):(\d+)$/);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host: m[1]!, port };
}

/** Parse a "vid:pid" endpoint string (hex). Returns null when malformed. */
export function parseVidPid(endpoint: string): { vid: number; pid: number } | null {
  const m = endpoint.match(/^([0-9a-fA-F]{4}):([0-9a-fA-F]{4})$/);
  if (!m) return null;
  return { vid: parseInt(m[1]!, 16), pid: parseInt(m[2]!, 16) };
}

/** Standard serial-port defaults (9600 8N1). */
export const SERIAL_DEFAULTS = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none' as const,
} as const;
