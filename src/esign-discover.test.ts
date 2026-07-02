import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setConfigOverride, defaultConfig } from './config';
import {
  discoverPkcs11Lib,
  ensureEsignConfigured,
  esignCapabilityPresentSync,
  invalidateEsignTokenCache,
  WINDOWS_PKCS11_CANDIDATES,
} from './esign-discover';

describe('esign-discover', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'esign-disc-'));
    invalidateEsignTokenCache();
    setConfigOverride(defaultConfig());
  });

  afterEach(() => {
    setConfigOverride(null);
    invalidateEsignTokenCache();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  it('uses configured pkcs11Lib when file exists', () => {
    const dll = join(dir, 'vendor.dll');
    writeFileSync(dll, 'x');
    setConfigOverride({ ...defaultConfig(), esign: { pkcs11Lib: dll } });
    expect(discoverPkcs11Lib()).toBe(dll);
    expect(esignCapabilityPresentSync()).toBe(true);
  });

  it('ensureEsignConfigured persists discovered path', () => {
    const dll = join(dir, 'akisp11.dll');
    writeFileSync(dll, 'x');
    setConfigOverride({ ...defaultConfig(), esign: { pkcs11Lib: dll } });
    const next = ensureEsignConfigured();
    expect(next.esign?.pkcs11Lib).toBe(dll);
  });

  it('WINDOWS_PKCS11_CANDIDATES includes Akis and e-Tuğra paths', () => {
    expect(WINDOWS_PKCS11_CANDIDATES.some((p) => p.includes('akisp11.dll'))).toBe(true);
    expect(WINDOWS_PKCS11_CANDIDATES.some((p) => p.includes('eTPKCS11.dll'))).toBe(true);
  });

  it('returns null when no lib configured or found', () => {
    expect(discoverPkcs11Lib()).toBeNull();
    if (process.platform !== 'win32') {
      expect(esignCapabilityPresentSync()).toBe(false);
    }
  });
});
