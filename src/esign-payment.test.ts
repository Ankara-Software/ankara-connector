import { describe, expect, test } from 'bun:test';

import { MockEsignProvider } from './esign';
import { MockPaymentDeviceProvider } from './payment-device';

describe('esign mock', () => {
  test('listTokens returns the mock token', async () => {
    const p = new MockEsignProvider();
    const tokens = await p.listTokens();
    expect(tokens.length).toBe(1);
    expect(tokens[0].id).toBe('mock-token');
  });

  test('sign returns a CMS-style signature', async () => {
    const p = new MockEsignProvider();
    const r = await p.sign('mock-token', '0000', { base64: btoa('hello'), mimeType: 'application/pdf' });
    expect(r.signature.length).toBeGreaterThan(0);
    expect(r.certificate.length).toBeGreaterThan(0);
  });

  test('sign rejects unknown token', async () => {
    const p = new MockEsignProvider();
    await expect(p.sign('ghost', '0000', { base64: '', mimeType: 'application/pdf' })).rejects.toThrow();
  });
});

describe('payment device mock', () => {
  test('openSession + issueReceipt + closeSession round-trip', async () => {
    const p = new MockPaymentDeviceProvider();
    const { sessionId } = await p.openSession('1234');
    const r = await p.issueReceipt(sessionId, [{ name: 'Kahve', qty: 2, unitKurus: 5000, vatRate: 10 }]);
    expect(r.totalKurus).toBe(10000);
    const z = await p.closeSession(sessionId);
    expect(z.zReportId).toContain('Z-');
  });
});
