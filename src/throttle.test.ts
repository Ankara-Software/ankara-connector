import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setConfigOverride } from './config';
import { resetThrottle, sleep, throttlePoll } from './throttle';

describe('throttle', () => {
  beforeEach(() => {
    resetThrottle();
    setConfigOverride({
      apiBase: 'http://x',
      token: null,
      deviceId: null,
      label: null,
      tenantName: null,
      pairedAt: null,
      printer: null,
      statusPort: 4781,
      pollMinIntervalMs: 50,
    });
  });
  afterEach(() => {
    resetThrottle();
    setConfigOverride(null);
  });

  it('does not wait on first call', async () => {
    const waited = await throttlePoll('cam-1');
    expect(waited).toBe(0);
  });

  it('waits when called again within the min interval', async () => {
    await throttlePoll('cam-1');
    const waited = await throttlePoll('cam-1');
    expect(waited).toBeGreaterThan(0);
  });

  it('throttles per-key independently', async () => {
    await throttlePoll('cam-1');
    const w = await throttlePoll('cam-2');
    expect(w).toBe(0);
  });

  it('sleep yields the event loop', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
