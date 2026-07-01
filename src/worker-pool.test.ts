import { describe, it, expect, beforeEach } from 'bun:test';

import { submitCompute, setWorkerSupported, inlineCompute } from './worker-pool';
import { resetDeviceQueues } from './device-queue';

describe('worker-pool', () => {
  beforeEach(() => {
    resetDeviceQueues();
    // Force the inline fallback path so tests are deterministic and do not
    // depend on worker-thread availability in the test runner.
    setWorkerSupported(false);
  });

  it('runs hash tasks inline and returns a stable hex digest', async () => {
    const out = await submitCompute<string>('dev-1', { kind: 'hash', data: { input: 'EPC-123' } });
    expect(out).toMatch(/^h[0-9a-f]+$/);
    expect(inlineCompute({ kind: 'hash', data: { input: 'EPC-123' } })).toBe(out);
  });

  it('serializes compute per device key', async () => {
    const order: string[] = [];
    const jobs = ['a', 'b', 'c'].map((label) =>
      submitCompute('dev-1', { kind: 'sleep', data: { ms: 5 } }).then(() => { order.push(label); }),
    );
    await Promise.all(jobs);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('runs different device compute in parallel', async () => {
    const start = Date.now();
    await Promise.all([
      submitCompute('dev-1', { kind: 'sleep', data: { ms: 40 } }),
      submitCompute('dev-2', { kind: 'sleep', data: { ms: 40 } }),
    ]);
    expect(Date.now() - start).toBeLessThan(75);
  });

  it('inline sleep task returns the requested ms', async () => {
    const out = await submitCompute<{ sleptMs: number }>('dev-1', { kind: 'sleep', data: { ms: 7 } });
    expect(out.sleptMs).toBe(7);
  });
});
