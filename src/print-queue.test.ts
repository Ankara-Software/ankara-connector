import { describe, expect, test } from 'bun:test';

import { enqueuePrint, resetPrintQueueState } from './print-queue';

function makeJob(host = '192.168.1.50'): { id: string; data: Uint8Array; target: { host: string; port: number }; enqueuedAt: number; attempts: number } {
  return {
    id: 'job-1',
    data: new Uint8Array([0x1b, 0x40]),
    target: { host, port: 9100 },
    enqueuedAt: Date.now(),
    attempts: 0,
  };
}

describe('print-queue', () => {
  test('delivers on first success', async () => {
    resetPrintQueueState();
    const send = async () => ({ ok: true, bytes: 2 });
    const r = await enqueuePrint(makeJob(), send, { baseDelayMs: 5, maxDelayMs: 20 });
    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(2);
    expect(r.deadLettered).toBeUndefined();
  });

  test('retries then succeeds', async () => {
    resetPrintQueueState();
    let calls = 0;
    const send = async () => {
      calls += 1;
      return calls < 3 ? { ok: false, bytes: 0, error: 'busy' } : { ok: true, bytes: 2 };
    };
    const r = await enqueuePrint(makeJob(), send, { baseDelayMs: 2, maxDelayMs: 10, maxAttempts: 5 });
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
  });

  test('dead-letters after maxAttempts', async () => {
    resetPrintQueueState();
    const send = async () => ({ ok: false, bytes: 0, error: 'offline' });
    const r = await enqueuePrint(makeJob(), send, { baseDelayMs: 1, maxDelayMs: 4, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(r.deadLettered).toBe(true);
    expect(r.error).toBe('offline');
  });

  test('serializes concurrent jobs on same host (FIFO)', async () => {
    resetPrintQueueState();
    const order: string[] = [];
    let inFlight = false;
    const send = async (_t: unknown, _d: Uint8Array) => {
      expect(inFlight).toBe(false);
      inFlight = true;
      await new Promise((res) => setTimeout(res, 5));
      inFlight = false;
      order.push('sent');
      return { ok: true, bytes: 2 };
    };
    const j1 = { ...makeJob(), id: 'a' };
    const j2 = { ...makeJob(), id: 'b' };
    await Promise.all([enqueuePrint(j1, send, { baseDelayMs: 1 }), enqueuePrint(j2, send, { baseDelayMs: 1 })]);
    expect(order).toEqual(['sent', 'sent']);
  });
});
