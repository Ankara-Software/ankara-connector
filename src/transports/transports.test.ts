import { describe, expect, test } from 'bun:test';

import { LoopbackTransport, StubTransport } from './mock';
import { createTransport, createLoopbackPair } from './registry';
import { SerialTransport } from './serial';
import { TcpTransport } from './tcp';
import { UdpTransport } from './udp';
import { UsbHidTransport } from './usb-hid';
import { UsbRawTransport } from './usb-raw';
import { parseHostPort, parseVidPid } from './types';

describe('transports / types', () => {
  test('parseHostPort parses host:port', () => {
    expect(parseHostPort('192.168.1.50:9100')).toEqual({ host: '192.168.1.50', port: 9100 });
    expect(parseHostPort('bad')).toBeNull();
    expect(parseHostPort('h:99999')).toBeNull();
  });

  test('parseVidPid parses vid:pid hex', () => {
    expect(parseVidPid('04b8:0202')).toEqual({ vid: 0x04b8, pid: 0x0202 });
    expect(parseVidPid('xyz')).toBeNull();
  });

  test('createTransport returns the right class per kind', () => {
    expect(createTransport({ kind: 'tcp', endpoint: '1.2.3.4:9100' })).toBeInstanceOf(TcpTransport);
    expect(createTransport({ kind: 'udp', endpoint: '1.2.3.4:502' })).toBeInstanceOf(UdpTransport);
    expect(createTransport({ kind: 'serial', endpoint: 'COM3' })).toBeInstanceOf(SerialTransport);
    expect(createTransport({ kind: 'usb-hid', endpoint: '04b8:0202' })).toBeInstanceOf(UsbHidTransport);
    expect(createTransport({ kind: 'usb-raw', endpoint: '04b8:0202' })).toBeInstanceOf(UsbRawTransport);
  });

  test('unknown kind returns a stub that reports offline', async () => {
    const t = createTransport({ kind: 'rtsp' as any, endpoint: 'x' });
    const h = await t.health();
    expect(h.online).toBe(false);
  });
});

describe('LoopbackTransport', () => {
  test('writes on one side appear as reads on the peer', async () => {
    const [a, b] = createLoopbackPair(
      { kind: 'tcp', endpoint: 'a:1' },
      { kind: 'tcp', endpoint: 'b:1' },
    );
    await a.open();
    await b.open();
    const ok = await a.write(new Uint8Array([1, 2, 3]));
    expect(ok).toBe(true);
    const got = await b.read(500);
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual([1, 2, 3]);
    await a.close();
    await b.close();
  });

  test('inject surfaces bytes as a device read', async () => {
    const [a] = createLoopbackPair(
      { kind: 'serial', endpoint: 'COM3' },
      { kind: 'serial', endpoint: 'COM4' },
    );
    await a.open();
    a.inject(new Uint8Array([9, 9]));
    const got = await a.read(500);
    expect(Array.from(got!)).toEqual([9, 9]);
  });

  test('closed transport refuses write', async () => {
    const [a] = createLoopbackPair(
      { kind: 'tcp', endpoint: 'a:1' },
      { kind: 'tcp', endpoint: 'b:1' },
    );
    expect(await a.write(new Uint8Array([1]))).toBe(false);
  });
});

describe('StubTransport', () => {
  test('reports configured health', async () => {
    const t = new StubTransport({ kind: 'tcp', endpoint: 'x:1' }, { online: false, error: true, label: 'Kapalı' });
    const h = await t.health();
    expect(h.online).toBe(false);
    expect(await t.open()).toBe(false);
  });
});

describe('native-addon transports degrade gracefully', () => {
  test('serial transport reports driver_module_missing when addon absent', async () => {
    const t = new SerialTransport({ kind: 'serial', endpoint: 'COM3' });
    const ok = await t.open();
    // serialport is not installed in the test env -> open fails gracefully.
    expect(ok).toBe(false);
    const h = await t.health();
    expect(h.online).toBe(false);
    expect(h.label).toBe('Sürücü modülü yüklenemedi');
  });

  test('usb-hid transport degrades when addon absent', async () => {
    const t = new UsbHidTransport({ kind: 'usb-hid', endpoint: '04b8:0202' });
    expect(await t.open()).toBe(false);
    const h = await t.health();
    expect(h.online).toBe(false);
  });

  test('usb-raw transport degrades when addon absent', async () => {
    const t = new UsbRawTransport({ kind: 'usb-raw', endpoint: '04b8:0202' });
    expect(await t.open()).toBe(false);
    const h = await t.health();
    expect(h.online).toBe(false);
  });
});
