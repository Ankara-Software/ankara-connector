import { describe, expect, test } from 'bun:test';

import { encode, makeAck, type CommandMessage } from './protocol';
import { createVirtualDeviceState, handleVirtualCommand, runVirtualWire, virtualHello } from './virtual-device';

function cmd(cap: CommandMessage['cap'], action: string, payload?: unknown, id = 'c1'): CommandMessage {
  return { kind: 'command', v: 1, id, cap, action, ...(payload !== undefined ? { payload } : {}) };
}

describe('virtual-device', () => {
  test('hello advertises POS capabilities', () => {
    const h = virtualHello();
    expect(h.kind).toBe('hello');
    expect(h.capabilities).toContain('printer.escpos');
    expect(h.agent.name).toBe('ankara-connector-virtual');
  });

  test('print records a job with byte count', () => {
    const st = createVirtualDeviceState();
    const ack = handleVirtualCommand(st, cmd('printer.escpos', 'print', { lines: [{ text: 'Merhaba' }] }));
    expect(ack.ok).toBe(true);
    expect(st.printedJobs.length).toBe(1);
    expect(st.printedJobs[0].bytes).toBeGreaterThan(0);
  });

  test('scan parses barcode + records scan', () => {
    const st = createVirtualDeviceState();
    const ack = handleVirtualCommand(st, cmd('scanner.barcode', 'scan', { code: '8691234567890' }));
    expect(ack.ok).toBe(true);
    if (ack.ok && ack.payload) {
      const p = ack.payload as { symbology: string };
      expect(p.symbology).toBe('ean13');
    }
    expect(st.scannedCodes.length).toBe(1);
  });

  test('drawer kick increments counter', () => {
    const st = createVirtualDeviceState();
    handleVirtualCommand(st, cmd('drawer.kick', 'kick'));
    handleVirtualCommand(st, cmd('drawer.kick', 'kick'));
    expect(st.drawerKicks).toBe(2);
  });

  test('runVirtualWire round-trips a print command', () => {
    const st = createVirtualDeviceState();
    const wire = encode(cmd('printer.escpos', 'print', { lines: [{ text: 'X' }] }, 'rt-1'));
    const resp = runVirtualWire(st, wire);
    expect(resp).toContain('"ok":true');
    expect(resp).toContain('"id":"rt-1"');
  });

  test('offline device returns device_error', () => {
    const st = createVirtualDeviceState();
    st.online = false;
    const ack = handleVirtualCommand(st, cmd('printer.escpos', 'print', { lines: [{ text: 'X' }] }));
    expect(ack.ok).toBe(false);
  });

  test('unknown capability rejected', () => {
    const st = createVirtualDeviceState();
    const ack = handleVirtualCommand(st, cmd('rfid.uhf' as CommandMessage['cap'], 'read'));
    expect(ack.ok).toBe(false);
  });
});

void makeAck;
