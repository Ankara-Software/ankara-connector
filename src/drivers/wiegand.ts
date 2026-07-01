// Wiegand gate RFID driver (roadmap rfid.gate) — wires src/wiegand.ts to a
// USB-HID Wiegand converter. Panel commands: { action: 'read' } → reads a
// Wiegand frame from the converter, decodes facility/card, returns the payload.
// Cards are read on-demand here; continuous gate monitoring is delivered as
// unsolicited `rfid.gate` events (broadcastConnectorEvent) in a real deployment.

import { loadConfig } from '../config';
import type { ICapabilityDriver } from '../driver-host';
import { customerError } from '../errors';
import type { CommandMessage } from '../protocol';
import { createTransport } from '../transports/registry';
import { decodeWiegand26, decodeWiegand34, wiegandPayload } from '../wiegand';

export const wiegandDriver: ICapabilityDriver = {
  id: 'wiegand-gate',
  capability: 'rfid.gate',
  label: 'Wiegand kart okuyucu',
  isAvailable: () => !!loadConfig().wiegand,
  handle: async (cmd: CommandMessage) => {
    const cfg = loadConfig().wiegand;
    if (!cfg) return { error: customerError('not_configured') };
    const action = String(cmd.action || 'read');
    if (action !== 'read' && action !== 'capture') {
      return { error: customerError('unsupported_action', `rfid.gate.${action}`) };
    }
    const p = (cmd.payload ?? {}) as { format?: 26 | 34; bits?: number[] };
    // When the panel forwards raw bits (e.g. from a wedge listener), decode them.
    if (p.bits && p.bits.length > 0) {
      const bytes = new Uint8Array(p.bits);
      const card = p.format === 34 ? decodeWiegand34(bytes) : decodeWiegand26(bytes);
      if (!card.valid) return { error: customerError('rfid_error', 'Geçersiz Wiegand çerçevesi.') };
      return { payload: wiegandPayload(card) };
    }
    // Otherwise read from the USB-HID converter directly.
    const t = createTransport({ kind: 'usb-hid', endpoint: cfg.vidPid });
    const opened = await t.open();
    if (!opened) {
      await t.close();
      return { error: customerError('rfid_error', 'Wiegand dönüştürücüye bağlanılamadı.') };
    }
    try {
      const buf = await t.read(3000);
      if (!buf) return { error: customerError('rfid_error', 'Kart okunamadı (zaman aşımı).') };
      const card = (p.format ?? 26) === 34 ? decodeWiegand34(buf) : decodeWiegand26(buf);
      if (!card.valid) return { error: customerError('rfid_error', 'Geçersiz Wiegand çerçevesi.') };
      return { payload: wiegandPayload(card) };
    } finally {
      await t.close();
    }
  },
};
