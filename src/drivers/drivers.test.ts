import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { defaultConfig, setConfigOverride } from '../config';
import { barrierDriver } from './barrier';
import { signageDriver } from './signage';
import { displayDriver } from './display';
import { esignDriver } from './esign';
import { biometricDriver } from './biometric';
import { oposDriver } from './opos';
import { buildDriverHost } from './host';
import { clearTransportOverrides, registerTransportFactory } from '../transports/registry';
import { LoopbackTransport } from '../transports/mock';
import { decodeModbusFrame } from '../modbus';
import { verifySignageFrame } from '../signage';
import type { Transport, TransportAddress } from '../transports/types';
import type { CommandMessage } from '../protocol';

function cmd(cap: CommandMessage['cap'], action: string, payload?: unknown, id = 'c1'): CommandMessage {
  return { kind: 'command', v: 1, id, cap, action, ...(payload !== undefined ? { payload } : {}) };
}

// Loopback transport that captures the last written bytes for assertions.
class CapturingTransport implements Transport {
  written: Uint8Array[] = [];
  online = true;
  constructor(readonly address: TransportAddress) {}
  async open(): Promise<boolean> { return this.online; }
  async write(data: Uint8Array): Promise<boolean> { this.written.push(new Uint8Array(data)); return true; }
  async read(): Promise<Uint8Array | null> { return null; }
  health(): Promise<{ online: boolean; error: boolean; label: string }> { return Promise.resolve({ online: this.online, error: !this.online, label: 'ok' }); }
  async close(): Promise<void> { this.online = false; }
}

let capture: CapturingTransport;

beforeEach(() => {
  capture = new CapturingTransport({ kind: 'tcp', endpoint: 'x:1' });
  registerTransportFactory('tcp', { create: () => capture });
  registerTransportFactory('serial', { create: () => capture });
});

afterEach(() => {
  setConfigOverride(null);
  clearTransportOverrides();
});

describe('barrier driver (Modbus over loopback)', () => {
  test('open writes a single-coil ON frame', async () => {
    setConfigOverride({ ...defaultConfig(), barrier: { host: '1.2.3.4', port: 502, unit: 1, coil: 2 } });
    // Stub a coil-read response so the driver sees a valid reply frame.
    const origRead = capture.read.bind(capture);
    capture.read = async () => new Uint8Array([0, 1, 0, 0, 0, 6, 1, 0x05, 0, 2, 0xff, 0]);
    void origRead;
    const r = await barrierDriver.handle(cmd('barrier.relay', 'open'));
    expect(r.error).toBeUndefined();
    expect(r.payload).toEqual({ state: 'open', coil: 2 });
    expect(capture.written.length).toBe(1);
    const frame = decodeModbusFrame(capture.written[0]!);
    expect(frame?.function).toBe(0x05);
  });

  test('not_configured when no barrier set', async () => {
    setConfigOverride(defaultConfig());
    const r = await barrierDriver.handle(cmd('barrier.relay', 'open'));
    expect(r.error?.code).toBe('E12');
  });
});

describe('signage driver (loopback)', () => {
  test('display encodes a valid signage frame', async () => {
    setConfigOverride({ ...defaultConfig(), signage: { kind: 'tcp', endpoint: '1.2.3.4:5000', screen: 1 } });
    const r = await signageDriver.handle(cmd('signage.led', 'display', { lines: ['Hoşgeldiniz', '06 ABC 1234'] }));
    expect(r.error).toBeUndefined();
    expect(capture.written.length).toBe(1);
    expect(verifySignageFrame(capture.written[0]!)).toBe(true);
  });
});

describe('display driver (pole display, loopback)', () => {
  test('display sends a two-line frame', async () => {
    setConfigOverride({ ...defaultConfig(), display: { kind: 'serial', endpoint: 'COM3' } });
    const r = await displayDriver.handle(cmd('display.pole', 'display', { line1: 'TOPLAM', line2: '250,00 TL' }));
    expect(r.error).toBeUndefined();
    expect(capture.written.length).toBe(1);
    expect(capture.written[0]!.byteLength).toBeGreaterThan(0);
  });
});

describe('esign driver', () => {
  test('list tokens returns mock when pkcs11lib absent', async () => {
    setConfigOverride({ ...defaultConfig(), esign: { pkcs11Lib: '' } });
    const r = await esignDriver.handle(cmd('signature.esign', 'list'));
    expect(r.error).toBeUndefined();
    const p = r.payload as { tokens: { id: string }[] };
    expect(p.tokens.length).toBeGreaterThan(0);
  });

  test('not configured when esign missing', async () => {
    setConfigOverride(defaultConfig());
    const r = await esignDriver.handle(cmd('signature.esign', 'list'));
    expect(r.error?.code).toBe('E25');
  });
});

describe('biometric driver', () => {
  test('capture returns metadata + handle, not raw template', async () => {
    setConfigOverride({ ...defaultConfig(), biometric: { plugin: 'mock' } });
    const r = await biometricDriver.handle(cmd('biometric.fingerprint', 'capture'));
    expect(r.error).toBeUndefined();
    const p = r.payload as { handle: string; template?: string };
    expect(p.handle).toMatch(/^bio-/);
    expect(p.template).toBeUndefined();
  });
});

describe('opos bridge', () => {
  test('health lists registered device health', async () => {
    const r = await oposDriver.handle(cmd('payment.device', 'health'));
    expect(r.error).toBeUndefined();
    const p = r.payload as { opos: boolean; devices: unknown[] };
    expect(p.opos).toBe(true);
  });
});

describe('DriverHost advertises wired protocol capabilities', () => {
  test('all protocol drivers are registered', () => {
    setConfigOverride({
      ...defaultConfig(),
      printer: { host: 'p', port: 9100 },
      barrier: { host: 'b', port: 502, unit: 1, coil: 0 },
      rfid: { host: 'r', port: 5084 },
      camera: { rtspUrl: 'rtsp://x' },
      signage: { kind: 'tcp', endpoint: 's:1', screen: 1 },
      display: { kind: 'serial', endpoint: 'COM3' },
      wiegand: { vidPid: '0001:0001' },
      biometric: { plugin: 'mock' },
      esign: { pkcs11Lib: '' },
    });
    const host = buildDriverHost();
    const caps = host.advertisedCapabilities();
    expect(caps).toContain('scanner.barcode');
    expect(caps).toContain('printer.escpos');
    expect(caps).toContain('barrier.relay');
    expect(caps).toContain('rfid.uhf');
    expect(caps).toContain('alpr.camera');
    expect(caps).toContain('signage.led');
    expect(caps).toContain('display.pole');
    expect(caps).toContain('rfid.gate');
    expect(caps).toContain('biometric.fingerprint');
    expect(caps).toContain('signature.esign');
    expect(caps).toContain('camera.onvif');
    expect(caps).toContain('payment.device');
  });
});

// Keep LoopbackTransport referenced for the registry override path.
void LoopbackTransport;
