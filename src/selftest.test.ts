import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setConfigOverride } from './config';
import { runSelftest } from './selftest';

describe('selftest', () => {
  beforeEach(() => {
    // Avoid repeated disk reads of config.json (slow on Windows under AV and
    // would blow the 5s test timeout). The selftest exercises the same code
    // paths with an in-memory config.
    setConfigOverride({
      apiBase: 'http://127.0.0.1:9',
      token: null,
      deviceId: null,
      label: null,
      tenantName: null,
      pairedAt: null,
      printer: null,
      statusPort: 4781,
    });
  });
  afterEach(() => setConfigOverride(null));

  it('runs all checks and reports an aggregate ok', async () => {
    const result = await runSelftest();
    expect(result.checks.length).toBeGreaterThan(0);
    const names = result.checks.map((c) => c.name);
    expect(names).toContain('driver-host');
    expect(names).toContain('virtual-device');
    expect(names).toContain('transport-factory');
    expect(names).toContain('offline-buffer');
    expect(names).toContain('crash-store');
    expect(names).toContain('telemetry');
    const dh = result.checks.find((c) => c.name === 'driver-host');
    expect(dh?.ok).toBe(true);
    const vd = result.checks.find((c) => c.name === 'virtual-device');
    expect(vd?.ok).toBe(true);
  }, 15000);
});
