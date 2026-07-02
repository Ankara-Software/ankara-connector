// PKCS#11 / NES e-imza client (roadmap §16).
//
// Lazy-loads `pkcs11js` (or bundled `pkcs11.node`) and talks to vendor PKCS#11
// libraries. When PKCS#11 is unavailable, falls back to Windows certificate
// store enumeration so plugged smart cards are still visible.

import { discoverPkcs11Lib, listWindowsEsignTokens, pkcs11NativePath } from './esign-discover';
import type { EsignDocument, EsignProvider, EsignResult } from './esign';
import { MockEsignProvider } from './esign';
import { createWindowsCertProviderIfTokens } from './esign-windows';
import { logLine } from './logger';
import { loadNativeModule, type NativeModuleResult } from './transports/native-loader';

interface Pkcs11Api {
  default: {
    new (): {
      load(path: string, pin?: string): void;
      openSession(slotId: number, flags: number): { login(pin: string): void; logout(): void; close(): void };
      slots(): { slotId: number; slotDescription: string; token?: unknown }[];
      signInit(session: unknown, mechanism: { mechanism: number }): void;
      sign(session: unknown, data: Buffer): Buffer;
      digest(session: unknown, data: Buffer): Buffer;
      findKeys(session: unknown, opts: { type: string; value: string }): { id: string }[];
      finalize(): void;
    };
  };
}

const CKM_SHA256_RSA_PKCS = 0x00000040 + 0x06;
const CKF_SERIAL_SESSION = 0x04;
const CKF_RW_SESSION = 0x02;
const CKF_TOKEN_PRESENT = 0x01;

async function loadPkcs11Api(): Promise<NativeModuleResult<Pkcs11Api>> {
  const nativePath = pkcs11NativePath();
  if (nativePath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(nativePath);
      const PKCS11 = mod.default ?? mod;
      return { ok: true, module: nativePath, api: { default: PKCS11 } };
    } catch (e) {
      logLine('warn', `pkcs11.node yüklenemedi: ${(e as Error).message}`);
    }
  }
  return loadNativeModule<Pkcs11Api>('pkcs11js');
}

/** Build an EsignProvider bound to a PKCS#11 library path. */
export async function createEsignProvider(pkcs11Lib?: string): Promise<EsignProvider> {
  const lib = pkcs11Lib?.trim() || discoverPkcs11Lib() || undefined;
  if (lib) {
    const mod = await loadPkcs11Api();
    if (mod.ok) {
      try {
        const PKCS11 = mod.api.default;
        const instance = new PKCS11();
        instance.load(lib);
        const pkcs11Provider = new RealEsignProvider(instance, lib);
        const pkcs11Tokens = await pkcs11Provider.listTokens();
        if (pkcs11Tokens.length > 0) return pkcs11Provider;
      } catch (e) {
        logLine('warn', `PKCS#11 oturumu açılamadı (${lib}): ${(e as Error).message}`);
      }
    } else if (lib) {
      logLine('warn', `PKCS#11 modülü yok — Windows sertifika deposu deneniyor.`);
    }
  }

  const win = await createWindowsCertProviderIfTokens();
  if (win) return win;

  if (lib) {
    return new EmptyEsignProvider(lib);
  }
  return new MockEsignProvider();
}

class EmptyEsignProvider implements EsignProvider {
  readonly id = 'esign-unavailable';
  constructor(private readonly libPath: string) {}
  async listTokens() {
    if (process.platform === 'win32') return listWindowsEsignTokens();
    return [];
  }
  async sign(): Promise<EsignResult> {
    throw new Error(`E-imza sürücüsü yanıt vermiyor (${this.libPath}). Akıllı kartın takılı olduğundan emin olun.`);
  }
}

class RealEsignProvider implements EsignProvider {
  readonly id = 'pkcs11-esign';

  constructor(
    private readonly pkcs11: Pkcs11Api['default'] extends new () => infer I ? I : never,
    private readonly libPath: string,
  ) {}

  async listTokens(): Promise<{ id: string; label: string; certSubject: string | null }[]> {
    try {
      const slots = (this.pkcs11 as { slots: (flags?: number) => { slotId: number; slotDescription: string }[] }).slots(
        CKF_TOKEN_PRESENT,
      );
      const withToken = slots.length > 0 ? slots : ((this.pkcs11 as any).slots() as { slotId: number; slotDescription: string }[]);
      const pkcs11Tokens = withToken.map((s) => ({
        id: String(s.slotId),
        label: s.slotDescription || `Slot ${s.slotId}`,
        certSubject: null as string | null,
      }));
      if (process.platform === 'win32') {
        const win = await listWindowsEsignTokens();
        const merged = [...pkcs11Tokens];
        for (const w of win) {
          if (!merged.some((m) => m.id === w.id || m.label === w.label)) merged.push(w);
        }
        return merged;
      }
      return pkcs11Tokens;
    } catch {
      if (process.platform === 'win32') return listWindowsEsignTokens();
      return [];
    }
  }

  async sign(tokenId: string, pin: string, doc: EsignDocument): Promise<EsignResult> {
    const data = Buffer.from(doc.base64, 'base64');
    try {
      const session = (this.pkcs11 as any).openSession(Number(tokenId), CKF_SERIAL_SESSION | CKF_RW_SESSION);
      session.login(pin);
      try {
        (this.pkcs11 as any).signInit(session, { mechanism: CKM_SHA256_RSA_PKCS });
        const sig = (this.pkcs11 as any).sign(session, data);
        return {
          signature: sig.toString('base64'),
          certificate: '',
          signedAt: new Date().toISOString(),
        };
      } finally {
        session.logout();
        session.close();
      }
    } catch (e) {
      throw new Error(`E-imza imzalama başarısız: ${(e as Error).message}`);
    }
  }

  finalize(): void {
    try {
      (this.pkcs11 as any).finalize();
    } catch {
      // noop
    }
  }

  get lib(): string {
    return this.libPath;
  }
}

void (undefined as unknown as Pkcs11Api);
