// E-imza capability driver (roadmap §16) — wires the real PKCS#11 client to
// the signature.esign capability. The driver is available when an esign config
// (pkcs11Lib path) is set. The PIN arrives in the command payload and is used
// only for the sign call — never stored, never logged (KVKK item 26).

import { loadConfig } from '../config';
import type { ICapabilityDriver } from '../driver-host';
import { customerError } from '../errors';
import { createEsignProvider } from '../pkcs11';
import type { CommandMessage } from '../protocol';

export const esignDriver: ICapabilityDriver = {
  id: 'pkcs11-esign',
  capability: 'signature.esign',
  label: 'Nitelikli e-imza (PKCS#11)',
  isAvailable: () => !!loadConfig().esign,
  handle: async (cmd: CommandMessage) => {
    const cfg = loadConfig().esign;
    if (!cfg) return { error: customerError('esign_error', 'E-imza yapılandırılmamış.') };
    const action = String(cmd.action || 'sign');
    if (action === 'list' || action === 'tokens') {
      const provider = await createEsignProvider(cfg.pkcs11Lib);
      const tokens = await provider.listTokens();
      return { payload: { tokens } };
    }
    if (action === 'sign') {
      const p = (cmd.payload ?? {}) as { tokenId?: string; pin?: string; base64?: string; mimeType?: string; digest?: string };
      if (!p.pin) return { error: customerError('esign_error', 'PIN gerekli.') };
      if (!p.base64) return { error: customerError('esign_error', 'İmzalanacak belge gerekli.') };
      const provider = await createEsignProvider(cfg.pkcs11Lib);
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
