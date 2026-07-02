import { describe, expect, it } from 'bun:test';

import { buildAboutHtml } from './about-html';

describe('about-html', () => {
  it('includes runtime versions and legal links', () => {
    const html = buildAboutHtml({
      version: '1.1.8',
      trayVersion: '1.1.8',
      trayBuild: 'abc1234',
      runtime: { bun: '1.2.0', platform: 'win32', arch: 'x64', build: 'abc1234' },
    });
    expect(html).toContain('1.1.8');
    expect(html).toContain('Bun');
    expect(html).toContain('gizlilik');
    expect(html).toContain('kvkk');
  });
});
