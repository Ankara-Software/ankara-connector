// UHF RFID driver via LLRP (roadmap §15) — wires src/llrp.ts to a real TCP
// transport and exposes rfid.uhf as a capability driver.
//
// Panel commands: { action: 'inventory', durationMs? } → opens a TCP socket to
// the reader, sends ADD_ROSPEC + ENABLE_ROSPEC, collects RO_ACCESS_REPORT
// messages for the duration, dedups tags by EPC (TagDeduper, roadmap §29), and
// returns the unique tag list. Only tag EPCs (not raw RF data) leave the host
// (KVKK item 26).

import { loadConfig } from '../config';
import { customerError } from '../errors';
import type { ICapabilityDriver } from '../driver-host';
import { TagDeduper } from '../dedup';
import {
  buildAddRospecBody,
  decodeLlrpMessage,
  encodeLlrpMessage,
  parseTagReport,
} from '../llrp';
import type { CommandMessage } from '../protocol';
import { createTransport } from '../transports/registry';
import { runOnDevice } from '../device-queue';
import { throttlePoll } from '../throttle';

let msgId = 1;

function deviceKey(): string {
  const c = loadConfig().rfid;
  return c ? `rfid:${c.host}:${c.port}` : 'rfid:none';
}

export const rfidDriver: ICapabilityDriver = {
  id: 'llrp-uhf',
  capability: 'rfid.uhf',
  label: 'UHF RFID okuyucu (LLRP)',
  isAvailable: () => !!loadConfig().rfid,
  handle: async (cmd: CommandMessage) => runOnDevice(deviceKey(), () => runInventory(cmd)),
};

async function runInventory(cmd: CommandMessage) {
  const cfg = loadConfig().rfid;
  if (!cfg) return { error: customerError('not_configured') };
  const action = String(cmd.action || 'inventory');
  if (action !== 'inventory' && action !== 'read') {
    return { error: customerError('unsupported_action', `rfid.uhf.${action}`) };
  }
  const p = (cmd.payload ?? {}) as { durationMs?: number };
  const durationMs = Math.max(500, Math.min(30_000, Number(p.durationMs ?? 3000)));

  // CPU throttle (roadmap §35): bound the inventory poll rate per reader.
  await throttlePoll(deviceKey());

  const t = createTransport({ kind: 'tcp', endpoint: `${cfg.host}:${cfg.port}` });
  const opened = await t.open();
  if (!opened) {
    await t.close();
    return { error: customerError('rfid_error', 'RFID okuyucuya bağlanılamadı.') };
  }

  try {
    const rospecId = 1;
    const addFrame = encodeLlrpMessage(20, msgId++, buildAddRospecBody(rospecId));
    const enableFrame = encodeLlrpMessage(24, msgId++, new Uint8Array(8));
    if (!(await t.write(addFrame))) return { error: customerError('rfid_error', 'ADD_ROSPEC gönderilemedi.') };
    await t.read(500);
    if (!(await t.write(enableFrame))) return { error: customerError('rfid_error', 'ENABLE_ROSPEC gönderilemedi.') };

    const dedup = new TagDeduper(3000);
    const tags: string[] = [];
    const deadline = Date.now() + durationMs;
    while (Date.now() < deadline) {
      const buf = await t.read(500);
      if (!buf) continue;
      const msg = decodeLlrpMessage(buf);
      if (!msg) continue;
      for (const epc of parseTagReport(msg.data)) {
        if (dedup.accept(epc)) tags.push(epc);
      }
    }
    return { payload: { tags, count: tags.length, durationMs } };
  } finally {
    await t.close();
  }
}
