import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setConfigOverride } from './config';

describe('tls-cert opt-in trust', () => {
  beforeEach(() => {
    setConfigOverride({
      apiBase: 'http://127.0.0.1:9',
      token: null,
      deviceId: null,
      label: null,
      tenantName: null,
      pairedAt: null,
      printer: null,
      statusPort: 4781,
      tlsCertTrusted: false,
    });
  });

  afterEach(() => setConfigOverride(null));

  it('isCertTrusted is false when config flag is unset', async () => {
    const { isCertTrusted } = await import('./tls-cert');
    expect(isCertTrusted()).toBe(false);
  });

  it('isCertTrusted is false when flag set but cert file missing', async () => {
    setConfigOverride({
      apiBase: 'http://127.0.0.1:9',
      token: null,
      deviceId: null,
      label: null,
      tenantName: null,
      pairedAt: null,
      printer: null,
      statusPort: 4781,
      tlsCertTrusted: true,
    });
    const { isCertTrusted } = await import('./tls-cert');
    expect(isCertTrusted()).toBe(false);
  });
});
