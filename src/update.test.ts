import { describe, expect, it } from 'bun:test';

import { isWindowsSetupArtifact } from './update';

describe('update', () => {
  it('detects NSIS Setup artifact on Windows', () => {
    expect(
      isWindowsSetupArtifact({
        version: '1.1.7',
        path: '/tmp/x',
        sha256: 'abc',
        filename: 'AnkaraConnector-Setup-1.1.6.exe',
      }),
    ).toBe(true);
  });

  it('detects raw core binary as non-setup', () => {
    expect(
      isWindowsSetupArtifact({
        version: '1.1.7',
        path: '/tmp/x',
        sha256: 'abc',
        filename: 'ankara-connector-core-1.1.6-windows-x64.exe',
      }),
    ).toBe(false);
  });
});
