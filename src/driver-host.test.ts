import { describe, expect, test } from 'bun:test';

import { DriverHost, type ICapabilityDriver } from './driver-host';
import type { Capability, CommandMessage } from './protocol';
import { buildDriverHost } from './drivers/host';

function cmd(cap: Capability, action: string, id = 'c1'): CommandMessage {
  return { kind: 'command', v: 1, id, cap, action };
}

function fakeDriver(cap: Capability, available: boolean, label: string): ICapabilityDriver {
  return {
    id: `fake-${cap}`,
    capability: cap,
    label,
    isAvailable: () => available,
    handle: async () => ({ payload: { handled: cap } }),
  };
}

describe('DriverHost', () => {
  test('registers and resolves a driver by capability', () => {
    const host = new DriverHost();
    host.register(fakeDriver('rfid.uhf', true, 'RFID'));
    expect(host.driverFor('rfid.uhf')?.label).toBe('RFID');
    expect(host.driverFor('barrier.relay')).toBeNull();
  });

  test('advertisedCapabilities only lists available drivers', () => {
    const host = new DriverHost();
    host.register(fakeDriver('rfid.uhf', false, 'RFID'));
    host.register(fakeDriver('barrier.relay', true, 'Bariyer'));
    expect(host.advertisedCapabilities()).toEqual(['barrier.relay']);
  });

  test('handlerFor returns null when driver unavailable', () => {
    const host = new DriverHost();
    host.register(fakeDriver('rfid.uhf', false, 'RFID'));
    expect(host.handlerFor('rfid.uhf')).toBeNull();
  });

  test('handlerFor routes to the registered handler', async () => {
    const host = new DriverHost();
    host.register(fakeDriver('barrier.relay', true, 'Bariyer'));
    const h = host.handlerFor('barrier.relay');
    expect(h).not.toBeNull();
    const r = await h!(cmd('barrier.relay', 'open'));
    expect(r.payload).toEqual({ handled: 'barrier.relay' });
  });

  test('adding a driver does not require router edits (Open/Closed)', () => {
    const host = new DriverHost();
    const before = host.advertisedCapabilities();
    host.register(fakeDriver('signage.led', true, 'LED'));
    const after = host.advertisedCapabilities();
    expect(after.length).toBe(before.length + 1);
    expect(after).toContain('signage.led');
  });

  test('buildDriverHost registers POS Wave-0 base drivers', () => {
    const host = buildDriverHost();
    const caps = host.advertisedCapabilities();
    // scanner.barcode/qr are always available; printer/drawer only when configured.
    expect(caps).toContain('scanner.barcode');
    expect(caps).toContain('scanner.qr');
    // Without a printer configured, escpos/drawer are not advertised.
    expect(host.driverFor('printer.escpos')).not.toBeNull();
    expect(host.driverFor('signature.esign')).not.toBeNull();
  });
});
