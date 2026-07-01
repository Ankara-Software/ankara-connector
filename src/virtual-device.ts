// Virtual device emulator + mock loopback server (roadmap §40, §41, §42).
//
// A standalone Bun process that pretends to be a Connector agent with a
// virtual thermal printer, barcode scanner, and cash drawer. Used for
// conformance tests, panel smoke checks, and CI without real hardware.
// Reuses the real protocol + handlers so behavior matches production.

import { encodeJob, encodeDrawerKick } from './escpos';
import { parseBarcode } from './barcode';
import { aggregateHealth, type PrinterHealth } from './printer-health';
import { PROTOCOL_VERSION } from './protocol';
import type { AgentInfo, Capability, CommandMessage, AckMessage, HelloMessage } from './protocol';
import { decode, makeAck, makeAckError, encode, makeEvent } from './protocol';

const VIRTUAL_CAPABILITIES: Capability[] = [
  'printer.escpos',
  'printer.label',
  'scanner.barcode',
  'scanner.qr',
  'drawer.kick',
];

export interface VirtualDeviceState {
  printedJobs: { bytes: number; at: string }[];
  scannedCodes: { code: string; symbology: string; at: string }[];
  drawerKicks: number;
  health: PrinterHealth;
  online: boolean;
}

export function createVirtualDeviceState(): VirtualDeviceState {
  return {
    printedJobs: [],
    scannedCodes: [],
    drawerKicks: 0,
    health: aggregateHealth({}),
    online: true,
  };
}

/** Pure handler for a virtual device — no I/O, returns the ack directly. */
export function handleVirtualCommand(
  state: VirtualDeviceState,
  cmd: CommandMessage,
): AckMessage {
  if (!state.online) {
    return makeAckError(cmd.id, 'device_error', 'Sanal cihaz çevrimdışı.');
  }
  const action = String(cmd.action || '');
  switch (cmd.cap) {
    case 'printer.escpos': {
      if (action === 'status' || action === 'health') {
        return makeAck(cmd.id, { health: state.health });
      }
      if (action !== 'print') return makeAckError(cmd.id, 'unsupported_action', `printer.escpos.${action}`);
      const p = (cmd.payload ?? {}) as { lines?: { text: string }[]; cut?: boolean };
      const bytes = encodeJob({ lines: p.lines ?? [], cut: p.cut });
      state.printedJobs.push({ bytes: bytes.byteLength, at: new Date().toISOString() });
      return makeAck(cmd.id, { bytes: bytes.byteLength });
    }
    case 'printer.label': {
      if (action !== 'print' && action !== 'label') return makeAckError(cmd.id, 'unsupported_action', `printer.label.${action}`);
      const p = (cmd.payload ?? {}) as { text?: string };
      const bytes = encodeJob({ lines: [{ text: p.text ?? '', bold: true }] });
      state.printedJobs.push({ bytes: bytes.byteLength, at: new Date().toISOString() });
      return makeAck(cmd.id, { bytes: bytes.byteLength });
    }
    case 'drawer.kick': {
      if (action !== 'kick') return makeAckError(cmd.id, 'unsupported_action', `drawer.kick.${action}`);
      void encodeDrawerKick(1, 50, 50);
      state.drawerKicks += 1;
      return makeAck(cmd.id, { kicked: true });
    }
    case 'scanner.barcode':
    case 'scanner.qr': {
      if (action !== 'scan' && action !== 'capture') return makeAckError(cmd.id, 'unsupported_action', `scanner.${action}`);
      const p = (cmd.payload ?? {}) as { code?: string };
      if (!p.code) return makeAckError(cmd.id, 'bad_message', 'Tarama verisi (code) gerekli.');
      const parsed = parseBarcode(p.code);
      state.scannedCodes.push({ code: parsed.code, symbology: parsed.symbology, at: new Date().toISOString() });
      return makeAck(cmd.id, { code: parsed.code, symbology: parsed.symbology, gs1: parsed.gs1, fields: parsed.fields });
    }
    default:
      return makeAckError(cmd.id, 'unknown_capability', 'Bu yetenek sanal cihazda yok.');
  }
}

export function virtualHello(): HelloMessage {
  const info: AgentInfo = { name: 'ankara-connector-virtual', version: 'virtual', os: 'linux' };
  return { kind: 'hello', v: PROTOCOL_VERSION, agent: info, capabilities: VIRTUAL_CAPABILITIES };
}

/** Decode a wire command string and run it against a virtual device state. */
export function runVirtualWire(state: VirtualDeviceState, wire: string): string {
  const parsed = decode(wire);
  if (!parsed.ok) {
    return encode(makeAckError('bad-json', parsed.error.code, parsed.error.message));
  }
  const m = parsed.value;
  if (m.kind !== 'command') {
    // Echo hello/ack/event back as an event so callers can detect round-trip.
    return encode(makeEvent('scanner.barcode', 'noop'));
  }
  return encode(handleVirtualCommand(state, m));
}
