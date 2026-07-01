import { describe, expect, test } from 'bun:test';

import { secretBackend, secretFilePath } from './secret-store';

describe('secret-store', () => {
  test('secretBackend returns one of the documented backends', () => {
    expect(['keychain', 'credential-manager', 'file']).toContain(secretBackend());
  });

  test('secretFilePath lives under ~/.ankara-connector', () => {
    const p = secretFilePath();
    expect(p.includes('token.key')).toBe(true);
    expect(p.includes('.ankara-connector')).toBe(true);
  });
});
