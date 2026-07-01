// Agent runtime: wires config → capability handlers → loopback status server.
// On first launch (no saved token) opens the web auth page and waits for the
// browser to deliver the device token via localhost callback. Session persists
// in ~/.ankara-connector/config.json across restarts.

import { loadConfig, saveConfig } from './config';
import { agentInfo, advertisedCapabilities, rotateToken } from './pair';
import { startStatusServer, type AgentStatus, type CommandHandler } from './status';
import { spooledPrint, spooledDrawerKick } from './spool';
import { parseBarcode } from './barcode';
import { customerError } from './errors';
import { healthErrorKey, encodeHealthRequest, aggregateHealth, type PrinterHealth } from './printer-health';
import { waitForWebAuth, cancelAllPendingAuth } from './auth-flow';
import { startAutoUpdateLoop } from './update';
import { startHeartbeatLoop } from './heartbeat';
import type { Capability, CommandMessage } from './protocol';

const ROTATE_INTERVAL_MS = 1000 * 60 * 45;

export async function runAgent(): Promise<void> {
  let cfg = loadConfig();
  const info = agentInfo();
  const startedAt = new Date().toISOString();

  const status = (): AgentStatus => {
    const c = loadConfig();
    const caps = advertisedCapabilities(c);
    return {
      paired: !!c.token,
      deviceId: c.deviceId,
      label: c.label,
      apiBase: c.apiBase,
      capabilities: caps,
      printer: c.printer ? { host: c.printer.host, port: c.printer.port } : null,
      startedAt,
    };
  };

  const handler = (cap: Capability): CommandHandler | null => {
    const c = loadConfig();
    if (cap === 'printer.escpos' && c.printer) return handlePrint;
    if (cap === 'printer.label' && c.printer) return handleLabel;
    if (cap === 'drawer.kick' && c.printer) return handleDrawer;
    if (cap === 'scanner.barcode' || cap === 'scanner.qr') return handleScan;
    if (cap === 'signature.esign') return handleEsign;
    return null;
  };

  // Loopback server must start before web auth (browser POSTs token here).
  startStatusServer(cfg.statusPort, status, handler, () => agentInfo());

  if (!cfg.token) {
    try {
      const auth = await waitForWebAuth(cfg);
      cfg = {
        ...cfg,
        token: auth.token,
        deviceId: auth.deviceId,
        label: cfg.label || 'Connector',
        tenantName: auth.tenantName ?? cfg.tenantName,
        pairedAt: new Date().toISOString(),
      };
      saveConfig(cfg);
      console.log(`Oturum açıldı — cihaz ${auth.deviceId} firmaya bağlandı.`);
      if (auth.tenantName) console.log(`Firma: ${auth.tenantName}`);
    } catch (e) {
      cancelAllPendingAuth();
      console.error((e as Error).message);
      process.exit(2);
    }
  }

  // Background token rotation.
  setInterval(async () => {
    const c = loadConfig();
    if (!c.token) return;
    const r = await rotateToken(c.apiBase, c.token);
    if (r.ok) {
      saveConfig({ ...c, token: r.token, deviceId: r.deviceId });
    } else {
      console.error('Belirteç yenileme başarısız:', r.error);
    }
  }, ROTATE_INTERVAL_MS);

  const current = loadConfig();
  const caps = advertisedCapabilities(current);
  console.log(`Ankara Yazılım Connector çalışıyor (${info.os}). Cihaz: ${current.deviceId}`);
  console.log(`Yetenekler: ${caps.join(', ') || '—'}`);
  console.log(
    'Panelden komut bekleniyor (ws://127.0.0.1:%d). Oturum kalıcıdır — çıkmak için Ctrl+C.',
    current.statusPort,
  );

  startAutoUpdateLoop(current);
  startHeartbeatLoop(current);

  await new Promise(() => {});
}

interface PrintPayload {
  header?: string;
  lines?: { text: string; bold?: boolean; align?: 'left' | 'center' | 'right'; size?: 'normal' | 'double' }[];
  footer?: string;
  cut?: boolean;
}

const handlePrint: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'print');
  if (action === 'status' || action === 'health') {
    return handleHealth(cmd);
  }
  if (action !== 'print') {
    return { error: customerError('unsupported_action', `printer.escpos.${action}`) };
  }
  const cfg = loadConfig();
  if (!cfg.printer) return { error: customerError('not_configured') };
  const p = (cmd.payload ?? {}) as PrintPayload;
  const r = await spooledPrint(cfg.printer, {
    header: p.header,
    lines: p.lines ?? [],
    footer: p.footer,
    cut: p.cut,
    codePage: cfg.printer.codePage,
  });
  if (!r.ok) {
    const code = r.deadLettered ? 'printer_dead_letter' : 'printer_busy';
    return { error: customerError(code, r.error) };
  }
  return { payload: { bytes: r.bytes } };
};

const handleLabel: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'print');
  if (action !== 'print' && action !== 'label') {
    return { error: customerError('unsupported_action', `printer.label.${action}`) };
  }
  const cfg = loadConfig();
  if (!cfg.printer) return { error: customerError('not_configured') };
  const p = (cmd.payload ?? {}) as { text?: string };
  const r = await spooledPrint(cfg.printer, { lines: [{ text: p.text ?? '', bold: true }] });
  if (!r.ok) return { error: customerError(r.deadLettered ? 'printer_dead_letter' : 'device_error', r.error) };
  return { payload: { bytes: r.bytes } };
};

const handleDrawer: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'kick');
  if (action !== 'kick') {
    return { error: customerError('unsupported_action', `drawer.kick.${action}`) };
  }
  const cfg = loadConfig();
  if (!cfg.printer) return { error: customerError('not_configured') };
  const r = await spooledDrawerKick(cfg.printer, 1, 50, 50);
  if (!r.ok) return { error: customerError('device_error', r.error) };
  return { payload: { kicked: true, bytes: r.bytes } };
};

const handleScan: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'scan');
  if (action !== 'scan' && action !== 'capture') {
    return { error: customerError('unsupported_action', `scanner.${action}`) };
  }
  const p = (cmd.payload ?? {}) as { code?: string };
  if (!p.code) return { error: customerError('scanner_empty') };
  const parsed = parseBarcode(p.code);
  return { payload: { code: parsed.code, symbology: parsed.symbology, gs1: parsed.gs1, fields: parsed.fields, capturedAt: new Date().toISOString() } };
};

const handleHealth: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'status');
  if (action !== 'status') {
    return { error: customerError('unsupported_action', `printer.escpos.${action}`) };
  }
  const cfg = loadConfig();
  if (!cfg.printer) return { error: customerError('not_configured') };
  // Real status probing would send encodeHealthRequest bytes and read the
  // response; here we expose the encoder + decoder contract so the panel can
  // request a health snapshot. A full round-trip requires a duplex socket.
  void cmd;
  const h: PrinterHealth = aggregateHealth({});
  const errKey = healthErrorKey(h);
  return { payload: { health: h, probe: Array.from(encodeHealthRequest('paper')), error: errKey } };
};

const handleEsign: CommandHandler = async () => {
  return { error: customerError('unsupported_action', 'Nitelikli e-imza yakında.') };
};
