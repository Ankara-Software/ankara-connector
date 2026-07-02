// Windows certificate store e-imza provider (hardware private key).

import type { EsignDocument, EsignProvider, EsignResult } from './esign';
import { listWindowsEsignTokens } from './esign-discover';

export class WindowsCertEsignProvider implements EsignProvider {
  readonly id = 'windows-cert-esign';

  async listTokens(): Promise<{ id: string; label: string; certSubject: string | null }[]> {
    return listWindowsEsignTokens();
  }

  async sign(_tokenId: string, _pin: string, _doc: EsignDocument): Promise<EsignResult> {
    throw new Error(
      'Windows sertifika deposu üzerinden imza henüz desteklenmiyor. PKCS#11 sürücüsünü yapılandırın veya panelden tekrar deneyin.',
    );
  }
}

export async function createWindowsCertProviderIfTokens(): Promise<EsignProvider | null> {
  const tokens = await listWindowsEsignTokens();
  if (tokens.length === 0) return null;
  return new WindowsCertEsignProvider();
}
