// Biometric capability driver (roadmap §17) — wires the native-plugin loader
// to the biometric.fingerprint capability. Panel commands: { action: 'capture'
// | 'match' | 'enroll', userId?, template? }. Templates never leave the host;
// only match results (userId + score) are returned (KVKK item 26).

import { loadConfig } from '../config';
import { customerError } from '../errors';
import type { ICapabilityDriver } from '../driver-host';
import { loadBiometricProvider } from '../biometric-loader';
import type { BiometricTemplate } from '../biometric';
import type { CommandMessage } from '../protocol';

export const biometricDriver: ICapabilityDriver = {
  id: 'biometric-fingerprint',
  capability: 'biometric.fingerprint',
  label: 'Parmak izi okuyucu',
  isAvailable: () => !!loadConfig().biometric,
  handle: async (cmd: CommandMessage) => {
    const cfg = loadConfig().biometric;
    if (!cfg) return { error: customerError('not_configured') };
    const action = String(cmd.action || 'capture');
    const provider = await loadBiometricProvider(cfg.plugin, cfg.libPath);
    try {
      if (action === 'capture') {
        const tpl = await provider.capture();
        // Return only metadata + a non-reversible handle, never the raw template.
        return { payload: { format: tpl.format, quality: tpl.quality, capturedAt: tpl.capturedAt, handle: hashHandle(tpl.template) } };
      }
      if (action === 'match') {
        const p = (cmd.payload ?? {}) as { template?: BiometricTemplate };
        if (!p.template) return { error: customerError('biometric_error', 'Şablon gerekli.') };
        const m = await provider.match(p.template);
        return { payload: { matched: m.matched, userId: m.userId, score: m.score } };
      }
      if (action === 'enroll') {
        const p = (cmd.payload ?? {}) as { userId?: string; template?: BiometricTemplate };
        if (!p.userId || !p.template) return { error: customerError('biometric_error', 'Kullanıcı ve şablon gerekli.') };
        const ok = await provider.enroll(p.userId, p.template);
        return { payload: { enrolled: ok, userId: p.userId } };
      }
      return { error: customerError('unsupported_action', `biometric.fingerprint.${action}`) };
    } catch (e) {
      return { error: customerError('biometric_error', (e as Error).message) };
    }
  },
};

/** Non-reversible handle so a template id can be referenced without exposing bytes. */
function hashHandle(template: string): string {
  let h = 0;
  for (let i = 0; i < template.length; i += 1) {
    h = (h * 31 + template.charCodeAt(i)) | 0;
  }
  return `bio-${(h >>> 0).toString(16)}`;
}
