import { describe, expect, test } from 'bun:test';

import { MockBiometricProvider } from './biometric';

describe('biometric mock provider', () => {
  test('capture returns an ISO template with quality', async () => {
    const p = new MockBiometricProvider();
    const t = await p.capture();
    expect(t.format).toBe('iso-19794');
    expect(t.quality).toBeGreaterThan(0);
    expect(t.template.length).toBeGreaterThan(0);
  });

  test('enroll + match round-trip', async () => {
    const p = new MockBiometricProvider();
    const t = await p.capture();
    const ok = await p.enroll('user-1', t);
    expect(ok).toBe(true);
    const m = await p.match(t);
    expect(m.matched).toBe(true);
    expect(m.userId).toBe('user-1');
  });

  test('match misses unknown template', async () => {
    const p = new MockBiometricProvider();
    const m = await p.match({ format: 'iso-19794', template: 'x', quality: 50, capturedAt: new Date().toISOString() });
    expect(m.matched).toBe(false);
  });
});
