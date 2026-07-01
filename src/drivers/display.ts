// Pole display driver (roadmap display.pole) — wires src/pole-display.ts to
// serial/TCP. Panel commands: { action: 'display', line1, line2 } → renders a
// two-line frame and sends it to the customer-facing LCD.

import { loadConfig } from '../config';
import type { ICapabilityDriver } from '../driver-host';
import { customerError } from '../errors';
import { poleFrame } from '../pole-display';
import type { CommandMessage } from '../protocol';
import { createTransport } from '../transports/registry';

export const displayDriver: ICapabilityDriver = {
  id: 'pole-display',
  capability: 'display.pole',
  label: 'Müşteri ekranı (pole display)',
  isAvailable: () => !!loadConfig().display,
  handle: async (cmd: CommandMessage) => {
    const cfg = loadConfig().display;
    if (!cfg) return { error: customerError('not_configured') };
    const action = String(cmd.action || 'display');
    if (action !== 'display' && action !== 'show') {
      return { error: customerError('unsupported_action', `display.pole.${action}`) };
    }
    const p = (cmd.payload ?? {}) as { line1?: string; line2?: string };
    const bytes = poleFrame(p.line1 ?? '', p.line2 ?? '');
    const t = createTransport({ kind: cfg.kind, endpoint: cfg.endpoint });
    const opened = await t.open();
    if (!opened) {
      await t.close();
      return { error: customerError('display_error', 'Müşteri ekranına bağlanılamadı.') };
    }
    try {
      const ok = await t.write(bytes);
      if (!ok) return { error: customerError('display_error', 'Ekran yazma başarısız.') };
      return { payload: { bytes: bytes.byteLength } };
    } finally {
      await t.close();
    }
  },
};
