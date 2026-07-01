// OPOS / UPOS-compatible bridge (roadmap §12).
//
// True OPOS requires a vendor Windows COM CCO control (Common Control Objects)
// that is licensed per-vendor and cannot be vendored here. Instead we ship a
// "UPOS-compatible" abstraction that maps the same logical POS peripheral
// operations — print, drawer kick, pole display, scale read — onto our own
// drivers (ESC/POS, drawer, pole display). This gives panel code a single
// UPOS-style action surface regardless of the underlying transport, with the
// limitation documented plainly in the SDK docs (Phase 7).

import type { ICapabilityDriver } from '../driver-host';
import { customerError } from '../errors';
import type { CommandMessage } from '../protocol';
import { buildDriverHost } from './host';

export const oposDriver: ICapabilityDriver = {
  id: 'opos-bridge',
  capability: 'payment.device',
  label: 'POS çevre birimleri (UPOS-uyumlu köprü)',
  isAvailable: () => true,
  handle: async (cmd: CommandMessage) => {
    const action = String(cmd.action || 'print');
    // Map UPOS-style logical operations onto the matching capability driver.
    const host = buildDriverHost();
    const p = (cmd.payload ?? {}) as { device?: string; payload?: unknown };

    if (action === 'print' || action === 'receipt') {
      const h = host.handlerFor('printer.escpos');
      if (!h) return { error: customerError('not_configured', 'Yazıcı yapılandırılmamış.') };
      return h({ ...cmd, cap: 'printer.escpos', action: 'print', payload: p.payload ?? cmd.payload });
    }
    if (action === 'drawer') {
      const h = host.handlerFor('drawer.kick');
      if (!h) return { error: customerError('not_configured', 'Çekmece yapılandırılmamış.') };
      return h({ ...cmd, cap: 'drawer.kick', action: 'kick' });
    }
    if (action === 'display') {
      const h = host.handlerFor('display.pole');
      if (!h) return { error: customerError('not_configured', 'Müşteri ekranı yapılandırılmamış.') };
      return h({ ...cmd, cap: 'display.pole', action: 'display', payload: p.payload ?? cmd.payload });
    }
    if (action === 'health' || action === 'status') {
      const devices = await host.healthAll();
      return { payload: { opos: true, devices } };
    }
    return { error: customerError('unsupported_action', `payment.device.${action}`) };
  },
};
