import { beforeEach, describe, expect, it } from 'bun:test';

import { pendingDeviceKeys, resetDeviceQueues, runOnDevice } from './device-queue';

describe('device-queue', () => {
  beforeEach(() => resetDeviceQueues());

  it('serializes calls with the same key in FIFO order', async () => {
    const order: string[] = [];
    const slow = (label: string, ms: number) =>
      runOnDevice('dev-A', () =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            order.push(label);
            resolve(label);
          }, ms);
        }),
      );

    const p1 = slow('first', 30);
    const p2 = slow('second', 5); // would win if parallel — but must wait
    const p3 = slow('third', 5);
    const results = await Promise.all([p1, p2, p3]);

    expect(results).toEqual(['first', 'second', 'third']);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('runs different keys in parallel', async () => {
    let aDone = 0;
    let bDone = 0;
    const start = Date.now();
    const a = runOnDevice('A', () => new Promise<void>((r) => setTimeout(() => { aDone = Date.now(); r(); }, 40)));
    const b = runOnDevice('B', () => new Promise<void>((r) => setTimeout(() => { bDone = Date.now(); r(); }, 40)));
    await Promise.all([a, b]);
    // Parallel: total < 75ms (two 40ms tasks overlapping).
    expect(Math.max(aDone, bDone) - start).toBeLessThan(75);
  });

  it('propagates errors without stalling subsequent work', async () => {
    const r1 = runOnDevice('err', () => Promise.reject(new Error('boom')));
    const r2 = runOnDevice('err', () => Promise.resolve('ok'));
    await expect(r1).rejects.toThrow('boom');
    await expect(r2).resolves.toBe('ok');
    expect(pendingDeviceKeys()).toBe(0);
  });

  it('cleans up empty queues', async () => {
    await runOnDevice('lonely', () => Promise.resolve(1));
    expect(pendingDeviceKeys()).toBe(0);
  });
});
