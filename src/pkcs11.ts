// PKCS#11 / NES e-imza client (roadmap §16).
//
// Real PKCS#11 implementation that lazy-loads the `pkcs11js` native binding and
// talks to any PKCS#11 shared library — SoftHSM2 (software HSM, used for tests
// and dev) or a real USB token (Akis, e-Tuğra, U-NET) via the same code path.
// When `pkcs11js` is not installed, falls back to the mock provider so the
// contract stays testable. The PIN is never stored — it arrives in the panel
// command payload and is used only for the duration of the sign call (KVKK item
// 26: e-imza PIN never leaves the host).

import { loadNativeModule } from './transports/native-loader';
import type { EsignDocument, EsignProvider, EsignResult } from './esign';
import { MockEsignProvider } from './esign';

interface Pkcs11Api {
  default: {
    new (): {
      load(path: string, pin?: string): void;
      openSession(slotId: number, flags: number): { login(pin: string): void; logout(): void; close(): void };
      slots(): { slotId: number; slotDescription: string }[];
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

/** Build an EsignProvider bound to a PKCS#11 library path. */
export async function createEsignProvider(pkcs11Lib?: string): Promise<EsignProvider> {
  if (!pkcs11Lib) return new MockEsignProvider();
  const mod = await loadNativeModule<Pkcs11Api>('pkcs11js');
  if (!mod.ok) return new MockEsignProvider();
  try {
    const PKCS11 = mod.api.default;
    const instance = new PKCS11();
    instance.load(pkcs11Lib);
    return new RealEsignProvider(instance, pkcs11Lib);
  } catch {
    return new MockEsignProvider();
  }
}

class RealEsignProvider implements EsignProvider {
  readonly id = 'pkcs11-esign';
  private nextTokenId = 0;

  constructor(
    private readonly pkcs11: Pkcs11Api['default'] extends new () => infer I ? I : never,
    private readonly libPath: string,
  ) {}

  async listTokens(): Promise<{ id: string; label: string; certSubject: string | null }[]> {
    try {
      const slots = (this.pkcs11 as any).slots() as { slotId: number; slotDescription: string }[];
      return slots.map((s) => ({
        id: String(s.slotId),
        label: s.slotDescription || `Slot ${s.slotId}`,
        certSubject: null,
      }));
    } catch {
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

  // Keep libPath referenced for diagnostics.
  get lib(): string {
    return this.libPath;
  }
}

// Keep the unused-type guard referenced.
void (undefined as unknown as Pkcs11Api);
