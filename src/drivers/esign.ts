// E-imza capability driver (roadmap §16) — PKCS#11 + Windows cert store discovery.

import { discoverPkcs11Lib, esignCapabilityPresentSync, invalidateEsignTokenCache, listWindowsEsignTokens } from '../esign-discover';
import { loadConfig } from '../config';
import type { ICapabilityDriver } from '../driver-host';
import { customerError } from '../errors';
import { createEsignProvider } from '../pkcs11';
import type { CommandMessage } from '../protocol';

function resolvedPkcs11Lib(): string | undefined {
  const configured = loadConfig().esign?.pkcs11Lib?.trim();
  if (configured) return configured;
  return discoverPkcs11Lib() ?? undefined;
}

export const esignDriver: ICapabilityDriver = {
  id: 'pkcs11-esign',
  capability: 'signature.esign',
  label: 'Nitelikli e-imza (PKCS#11)',
  isAvailable: () => esignCapabilityPresentSync(),
  handle: async (cmd: CommandMessage) => {
    const action = String(cmd.action || 'sign');
    const lib = resolvedPkcs11Lib();

    if (action === 'list' || action === 'tokens') {
      invalidateEsignTokenCache();
      const provider = await createEsignProvider(lib);
      let tokens = await provider.listTokens();
      if (tokens.length === 0 && process.platform === 'win32') {
        tokens = await listWindowsEsignTokens();
      }
      return { payload: { tokens, pkcs11Lib: lib ?? null } };
    }

    if (!lib && process.platform !== 'win32') {
      return { error: customerError('esign_error', 'E-imza yapılandırılmamış.') };
    }

    if (action === 'sign') {
      const p = (cmd.payload ?? {}) as { tokenId?: string; pin?: string; base64?: string; mimeType?: string; digest?: string };
      if (!p.pin) return { error: customerError('esign_error', 'PIN gerekli.') };
      if (!p.base64) return { error: customerError('esign_error', 'İmzalanacak belge gerekli.') };
      const provider = await createEsignProvider(lib);
      try {
        const result = await provider.sign(p.tokenId ?? '0', p.pin, {
          base64: p.base64,
          mimeType: p.mimeType ?? 'application/pdf',
          ...(p.digest ? { digest: p.digest } : {}),
        });
        return { payload: result };
      } catch (e) {
        return { error: customerError('esign_error', (e as Error).message) };
      }
    }
    return { error: customerError('unsupported_action', `signature.esign.${action}`) };
  },
};
