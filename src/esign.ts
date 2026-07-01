// PKCS#11 / NES e-imza contract (roadmap §16).
//
// Nitelikli e-imza via NES (Nitelikli Elektronik Sertifika) requires the
// vendor PKCS#11 shared library (Akis, e-Tuğra, U-NET) + a valid certificate
// on a smart card or USB token. The SDK + cert provisioning are operator-
// blocked (roadmap p298-udf-esign-integration). This module defines the
// contract so the agent, panel, and conformance tests agree on shape today;
// a real PKCS#11 implementation drops in by implementing `EsignProvider`.

export interface EsignDocument {
  /** Base64 document bytes to sign. */
  base64: string;
  /** MIME type (application/pdf, application/xml). */
  mimeType: string;
  /** Optional digest to sign (pre-hashed). */
  digest?: string;
}

export interface EsignResult {
  /** Base64 signature (CMS/PKCS#7). */
  signature: string;
  /** Signer certificate (base64 DER). */
  certificate: string;
  /** Signing time (ISO). */
  signedAt: string;
}

export interface EsignProvider {
  readonly id: string;
  /** List available signing tokens/cards. */
  listTokens(): Promise<{ id: string; label: string; certSubject: string | null }[]>;
  /** Sign a document with the selected token + PIN. */
  sign(tokenId: string, pin: string, doc: EsignDocument): Promise<EsignResult>;
}

/** Mock e-imza provider — returns a deterministic fake signature. Real NES
 *  SDK integration is operator-blocked (roadmap p298-udf-esign-integration). */
export class MockEsignProvider implements EsignProvider {
  readonly id = 'mock-esign';

  async listTokens(): Promise<{ id: string; label: string; certSubject: string | null }[]> {
    return [{ id: 'mock-token', label: 'Mock e-imza (test)', certSubject: 'CN=Test Signer' }];
  }

  async sign(tokenId: string, _pin: string, doc: EsignDocument): Promise<EsignResult> {
    if (tokenId !== 'mock-token') {
      throw new Error('E-imza belirteci bulunamadı.');
    }
    return {
      signature: btoa(`mock-signature:${doc.base64.slice(0, 16)}`),
      certificate: btoa('mock-certificate'),
      signedAt: new Date().toISOString(),
    };
  }
}
