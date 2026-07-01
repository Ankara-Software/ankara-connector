import { describe, expect, test } from 'bun:test';

import { runWatchdog } from './watchdog';

describe('watchdog', () => {
  test('runWatchdog is an async function', () => {
    expect(typeof runWatchdog).toBe('function');
    // It must return a Promise (async) so callers can await graceful shutdown.
    const p = runWatchdog({ argv: ['version'], maxRestarts: 1 });
    expect(p).toBeInstanceOf(Promise);
    // Don't actually let it run — cancel by ignoring the resolution.
    void p.catch(() => undefined);
  });
});
