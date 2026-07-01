// LED signage driver (roadmap signage.led) — wires src/signage.ts to TCP/serial.
//
// Panel commands: { action: 'display', lines: string[], mode?, speed?, dwell? }
// → encodes a signage frame and sends it to the configured screen over TCP or
// serial. Pure encoder reuse; the transport is chosen by config.

import { loadConfig } from '../config';
import type { ICapabilityDriver } from '../driver-host';
import { customerError } from '../errors';
import type { CommandMessage } from '../protocol';
import { encodeSignageFrame, type SignageFrame } from '../signage';
import { createTransport } from '../transports/registry';

export const signageDriver: ICapabilityDriver = {
  id: 'led-signage',
  capability: 'signage.led',
  label: 'LED tabela',
  isAvailable: () => !!loadConfig().signage,
  handle: async (cmd: CommandMessage) => {
    const cfg = loadConfig().signage;
    if (!cfg) return { error: customerError('not_configured') };
    const action = String(cmd.action || 'display');
    if (action !== 'display' && action !== 'send') {
      return { error: customerError('unsupported_action', `signage.led.${action}`) };
    }
    const p = (cmd.payload ?? {}) as { lines?: string[]; mode?: SignageFrame['mode']; speed?: number; dwell?: number };
    const frame: SignageFrame = {
      screen: cfg.screen,
      mode: p.mode ?? 1,
      speed: Number(p.speed ?? 5),
      dwell: Number(p.dwell ?? 3),
      lines: p.lines ?? [],
    };
    const bytes = encodeSignageFrame(frame);
    const t = createTransport({ kind: cfg.kind, endpoint: cfg.endpoint });
    const opened = await t.open();
    if (!opened) {
      await t.close();
      return { error: customerError('signage_error', 'LED tablaya bağlanılamadı.') };
    }
    try {
      const ok = await t.write(bytes);
      if (!ok) return { error: customerError('signage_error', 'Tabela yazma başarısız.') };
      return { payload: { bytes: bytes.byteLength, screen: cfg.screen } };
    } finally {
      await t.close();
    }
  },
};
