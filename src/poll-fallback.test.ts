import { describe, expect, test } from 'bun:test';

import { DriverHost, type ICapabilityDriver } from './driver-host';
import { dispatchPendingJob, fetchPendingJobs, RevokedError, type PollFallbackOptions } from './poll-fallback';
import { setConfigOverride, defaultConfig } from './config';
import type { CommandMessage } from './protocol';

function cmd(cap: CommandMessage['cap'], action: string): CommandMessage {
  return { kind: 'command', v: 1, id: 'j1', cap, action };
}

describe('poll-fallback dispatch', () => {
  test('dispatches a pending job to the matching driver', async () => {
    const holder: { action?: string; payload?: unknown } = {};
    const driver: ICapabilityDriver = {
      id: 'x',
      capability: 'barrier.relay',
      label: 'Bariyer',
      isAvailable: () => true,
      handle: async (c) => {
        holder.action = c.action;
        holder.payload = c.payload;
        return { payload: { opened: true } };
      },
    };
    const host = new DriverHost();
    host.register(driver);
    const r = await dispatchPendingJob(host, { id: 'j1', cap: 'barrier.relay', action: 'open', payload: { coil: 2 } });
    expect(r.ok).toBe(true);
    expect(holder.action).toBe('open');
    expect((holder.payload as { coil: number }).coil).toBe(2);
  });

  test('unknown capability is rejected without throwing', async () => {
    const host = new DriverHost();
    const r = await dispatchPendingJob(host, { id: 'j1', cap: 'not.a.capability', action: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('unknown_capability');
  });

  test('unavailable driver is rejected', async () => {
    const host = new DriverHost();
    host.register({
      id: 'x',
      capability: 'rfid.uhf',
      label: 'RFID',
      isAvailable: () => false,
      handle: async () => ({ payload: {} }),
    });
    const r = await dispatchPendingJob(host, { id: 'j1', cap: 'rfid.uhf', action: 'inventory' });
    expect(r.ok).toBe(false);
  });

  test('handler throw is caught and mapped to device_error', async () => {
    const host = new DriverHost();
    host.register({
      id: 'x',
      capability: 'signage.led',
      label: 'LED',
      isAvailable: () => true,
      handle: async () => {
        throw new Error('boom');
      },
    });
    const r = await dispatchPendingJob(host, { id: 'j1', cap: 'signage.led', action: 'display' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('device_error');
  });
});

describe('poll-fallback revocation', () => {
  test('RevokedError is detectable', () => {
    const e = new RevokedError();
    expect(e.revoked).toBe(true);
    expect(e.message).toMatch(/kapatılmış/);
  });

  test('fetchPendingJobs returns null when unpaired', async () => {
    setConfigOverride({ ...defaultConfig(), token: null });
    const jobs = await fetchPendingJobs(defaultConfig());
    expect(jobs).toBeNull();
    setConfigOverride(null);
  });
});

// Keep PollFallbackOptions type referenced.
void (undefined as unknown as PollFallbackOptions);
