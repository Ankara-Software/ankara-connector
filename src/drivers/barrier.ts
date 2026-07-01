// Modbus barrier/relay driver (roadmap §14) — wires src/modbus.ts to a real
// TCP transport and exposes barrier.relay as a capability driver.
//
// Panel commands: { action: 'open' | 'close' | 'read' } → coil write/read over
// Modbus TCP (function 05/01). The driver opens a fresh transport per command
// (barrier commands are rare and short-lived) and maps failures to the
// customer-facing E21 barrier_error code.

import { loadConfig } from '../config';
import { customerError } from '../errors';
import type { ICapabilityDriver, DeviceHealth } from '../driver-host';
import {
  barrierCommand,
  decodeModbusFrame,
  encodeReadCoils,
} from '../modbus';
import type { CommandMessage } from '../protocol';
import { createTransport } from '../transports/registry';
import { runOnDevice } from '../device-queue';

let txCounter = 1;

function deviceKey(): string {
  const c = loadConfig().barrier;
  return c ? `barrier:${c.host}:${c.port}:${c.unit}` : 'barrier:none';
}

export const barrierDriver: ICapabilityDriver = {
  id: 'modbus-barrier',
  capability: 'barrier.relay',
  label: 'Bariyer röle (Modbus TCP)',
  isAvailable: () => !!loadConfig().barrier,
  handle: async (cmd: CommandMessage) =>
    runOnDevice(deviceKey(), () => runBarrier(cmd)),
  health: async (): Promise<DeviceHealth[]> => {
    const cfg = loadConfig().barrier;
    if (!cfg) return [];
    const online = await runOnDevice(deviceKey(), async () => {
      const t = createTransport({ kind: 'tcp', endpoint: `${cfg.host}:${cfg.port}` });
      const ok = await t.open();
      await t.close();
      return ok;
    });
    return [{
      online,
      error: !online,
      label: online ? 'Bariyer çevrimiçi' : 'Bariyer çevrimdışı',
      detail: { host: cfg.host, port: cfg.port, unit: cfg.unit, coil: cfg.coil },
    }];
  },
};

async function runBarrier(cmd: CommandMessage) {
  const cfg = loadConfig().barrier;
  if (!cfg) return { error: customerError('not_configured') };
  const action = String(cmd.action || 'open');
  const t = createTransport({ kind: 'tcp', endpoint: `${cfg.host}:${cfg.port}` });
  const opened = await t.open();
  if (!opened) {
    await t.close();
    return { error: customerError('barrier_error', 'Bariyer cihazına bağlanılamadı.') };
  }
  try {
    if (action === 'open' || action === 'close') {
      const frame = barrierCommand(txCounter++, cfg.unit, cfg.coil, action === 'open');
      const ok = await t.write(frame);
      if (!ok) return { error: customerError('barrier_error', 'Modbus yazma başarısız.') };
      const resp = await t.read(2000);
      const parsed = resp ? decodeModbusFrame(resp) : null;
      if (!parsed) return { error: customerError('barrier_error', 'Bariyer yanıt vermedi.') };
      return { payload: { state: action, coil: cfg.coil } };
    }
    if (action === 'read') {
      const frame = encodeReadCoils(txCounter++, cfg.unit, cfg.coil, 1);
      const ok = await t.write(frame);
      if (!ok) return { error: customerError('barrier_error', 'Modbus okuma başarısız.') };
      const resp = await t.read(2000);
      const parsed = resp ? decodeModbusFrame(resp) : null;
      if (!parsed) return { error: customerError('barrier_error', 'Bariyer yanıt vermedi.') };
      const on = (parsed.data[1] ?? 0) & 1;
      return { payload: { coil: cfg.coil, on: on === 1 } };
    }
    return { error: customerError('unsupported_action', `barrier.relay.${action}`) };
  } finally {
    await t.close();
  }
}
