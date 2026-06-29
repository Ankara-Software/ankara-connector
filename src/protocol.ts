// Ankara Yazılım Connector — wire protocol (inlined, zero-dep).
// Mirrors packages/connector-protocol in the monorepo; kept inline so the
// compiled agent binary has no external import and cross-compiles cleanly.

export const PROTOCOL_VERSION = 1 as const;

export const CAPABILITIES = [
  'printer.escpos',
  'printer.label',
  'scanner.barcode',
  'scanner.qr',
  'drawer.kick',
  'payment.device',
  'callerid.line',
  'display.pole',
  'rfid.uhf',
  'rfid.gate',
  'biometric.fingerprint',
  'biometric.iris',
  'alpr.camera',
  'barrier.relay',
  'signage.led',
  'camera.onvif',
  'quality.audit',
  'signature.esign',
  'uyap.bridge',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface AgentInfo {
  readonly name: string;
  readonly version: string;
  readonly os: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'ipados';
}

export interface HelloMessage {
  readonly kind: 'hello';
  readonly v: number;
  readonly agent: AgentInfo;
  readonly capabilities: readonly Capability[];
}

export interface CommandMessage {
  readonly kind: 'command';
  readonly v: number;
  readonly id: string;
  readonly cap: Capability;
  readonly action: string;
  readonly payload?: unknown;
}

export interface AckMessage {
  readonly kind: 'ack';
  readonly v: number;
  readonly id: string;
  readonly ok: boolean;
  readonly error?: { code: string; message: string };
  readonly payload?: unknown;
}

export interface EventMessage {
  readonly kind: 'event';
  readonly v: number;
  readonly cap: Capability;
  readonly event: string;
  readonly id?: string;
  readonly payload?: unknown;
}

export type ConnectorMessage = HelloMessage | CommandMessage | AckMessage | EventMessage;

export function encode(msg: ConnectorMessage): string {
  return JSON.stringify(msg);
}

export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeAck(id: string, payload?: unknown): AckMessage {
  return { kind: 'ack', v: PROTOCOL_VERSION, id, ok: true, ...(payload !== undefined ? { payload } : {}) };
}

export function makeAckError(id: string, code: string, message: string): AckMessage {
  return { kind: 'ack', v: PROTOCOL_VERSION, id, ok: false, error: { code, message } };
}

export function makeEvent(cap: Capability, event: string, payload?: unknown): EventMessage {
  return { kind: 'event', v: PROTOCOL_VERSION, cap, event, ...(payload !== undefined ? { payload } : {}) };
}

// --- Validation (mirrors packages/connector-protocol) ---

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}
function isCapability(x: unknown): x is Capability {
  return typeof x === 'string' && (CAPABILITIES as readonly string[]).includes(x);
}

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { code: string; message: string } };

export function parseMessage(raw: unknown): ParseResult<ConnectorMessage> {
  if (!isObject(raw)) return { ok: false, error: { code: 'bad_message', message: 'message must be an object' } };
  if (typeof raw['v'] !== 'number' || !Number.isInteger(raw['v']) || raw['v'] <= 0) {
    return { ok: false, error: { code: 'bad_message', message: 'message.v invalid' } };
  }
  switch (raw['kind']) {
    case 'command': {
      if (!isNonEmptyString(raw['id'])) return { ok: false, error: { code: 'bad_message', message: 'command.id missing' } };
      if (!isCapability(raw['cap'])) return { ok: false, error: { code: 'unknown_capability', message: `unknown capability: ${String(raw['cap'])}` } };
      if (!isNonEmptyString(raw['action'])) return { ok: false, error: { code: 'unsupported_action', message: 'command.action missing' } };
      const cmd: CommandMessage = {
        kind: 'command',
        v: raw['v'] as number,
        id: raw['id'] as string,
        cap: raw['cap'] as Capability,
        action: raw['action'] as string,
        ...('payload' in raw ? { payload: raw['payload'] } : {}),
      };
      return { ok: true, value: cmd };
    }
    case 'hello':
    case 'ack':
    case 'event':
      // Accepted but not acted upon from the panel side.
      return { ok: true, value: raw as ConnectorMessage };
    default:
      return { ok: false, error: { code: 'bad_message', message: `unknown kind: ${String(raw['kind'])}` } };
  }
}
