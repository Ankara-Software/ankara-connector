import { describe, expect, it } from 'bun:test';

import type { AgentStatus } from './status';
import { buildStatusHtml, panelConnectorUrl, panelPairUrl } from './status-html';

const sample: AgentStatus = {
  paired: true,
  deviceId: 'dev-1',
  label: 'Connector',
  tenantName: 'Demo A.Ş.',
  pairedAt: '2026-07-01T12:00:00.000Z',
  apiBase: 'https://api.ankarayazilim.org/v1',
  capabilities: ['scanner.barcode', 'scanner.qr'],
  printer: null,
  startedAt: '2026-07-01T12:00:00.000Z',
  version: '1.1.7',
  sessionPaused: false,
};

describe('status-html', () => {
  it('panelConnectorUrl maps api host to site panel route', () => {
    expect(panelConnectorUrl('https://api.ankarayazilim.org/v1')).toBe(
      'https://ankarayazilim.org/panel/connector',
    );
  });

  it('panelPairUrl maps api host to connector pair page', () => {
    expect(panelPairUrl('https://api.ankarayazilim.org/v1')).toBe(
      'https://ankarayazilim.org/connector/baglan',
    );
  });

  it('includes local logo and panel manage button when paired', () => {
    const html = buildStatusHtml(sample, { tlsEnabled: true, certTrusted: true });
    expect(html).toContain('/assets/logo.png');
    expect(html).toContain('panel/connector');
    expect(html).toContain('Cihazları panelde yönet');
  });

  it('shows trust banner when TLS on and cert not trusted', () => {
    const html = buildStatusHtml(sample, { tlsEnabled: true, certTrusted: false });
    expect(html).toContain('/trust-cert');
    expect(html).toContain('Yerel sertifikayı güven');
  });

  it('hides trust banner when cert already trusted', () => {
    const html = buildStatusHtml(sample, { tlsEnabled: true, certTrusted: true });
    expect(html).not.toContain('/trust-cert');
  });

  it('shows session section and logout when paired', () => {
    const html = buildStatusHtml(sample, { tlsEnabled: true, certTrusted: true });
    expect(html).toContain('Demo A.Ş.');
    expect(html).toContain('Oturumu kapat');
    expect(html).toContain("sessionAction('logout')");
  });

  it('shows login button when not paired', () => {
    const html = buildStatusHtml(
      { ...sample, paired: false, sessionPaused: true, tenantName: null, pairedAt: null },
      { tlsEnabled: false, certTrusted: true },
    );
    expect(html).toContain("sessionAction('login')");
    expect(html).toContain('Oturum kapalı');
  });

  it('shows pair CTA when not paired', () => {
    const html = buildStatusHtml({ ...sample, paired: false, sessionPaused: false }, { tlsEnabled: false, certTrusted: true });
    expect(html).toContain("sessionAction('login')");
  });
});
