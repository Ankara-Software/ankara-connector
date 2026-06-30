// Agent runtime: wires config → capability handlers → loopback status server.
// On first launch (no saved token) opens the web auth page and waits for the
// browser to deliver the device token via localhost callback. Session persists
// in ~/.ankara-connector/config.json across restarts.

import { loadConfig, saveConfig } from './config';
import { agentInfo, advertisedCapabilities, rotateToken } from './pair';
import { startStatusServer, type AgentStatus, type CommandHandler } from './status';
import { printJob, sendRawBytes } from './printer';
import { encodeDrawerKick } from './escpos';
import { waitForWebAuth, cancelAllPendingAuth } from './auth-flow';
import { startAutoUpdateLoop } from './update';
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
  if (action !== 'print') {
    return { error: { code: 'unsupported_action', message: `printer.escpos.${action} desteklenmiyor.` } };
  }
  const cfg = loadConfig();
  if (!cfg.printer) return { error: { code: 'device_error', message: 'Yazıcı yapılandırılmamış. Panelden tanımlayın.' } };
  const p = (cmd.payload ?? {}) as PrintPayload;
  const r = await printJob(cfg.printer, {
    header: p.header,
    lines: p.lines ?? [],
    footer: p.footer,
    cut: p.cut,
    codePage: cfg.printer.codePage,
  });
  if (!r.ok) return { error: { code: 'device_error', message: r.error || 'Yazdırma başarısız' } };
  return { payload: { bytes: r.bytes } };
};

const handleLabel: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'print');
  if (action !== 'print' && action !== 'label') {
    return { error: { code: 'unsupported_action', message: `printer.label.${action} desteklenmiyor.` } };
  }
  const cfg = loadConfig();
  if (!cfg.printer) return { error: { code: 'device_error', message: 'Yazıcı yapılandırılmamış. Panelden tanımlayın.' } };
  const p = (cmd.payload ?? {}) as { text?: string };
  const r = await printJob(cfg.printer, { lines: [{ text: p.text ?? '', bold: true }] });
  if (!r.ok) return { error: { code: 'device_error', message: r.error || 'Etiket yazdırma başarısız' } };
  return { payload: { bytes: r.bytes } };
};

const handleDrawer: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'kick');
  if (action !== 'kick') {
    return { error: { code: 'unsupported_action', message: `drawer.kick.${action} desteklenmiyor.` } };
  }
  const cfg = loadConfig();
  if (!cfg.printer) return { error: { code: 'device_error', message: 'Yazıcı yapılandırılmamış. Panelden tanımlayın.' } };
  const r = await sendRawBytes(cfg.printer, encodeDrawerKick(1, 50, 50));
  if (!r.ok) return { error: { code: 'device_error', message: r.error || 'Para çekmecesi açılamadı' } };
  return { payload: { kicked: true, bytes: r.bytes } };
};

const handleScan: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'scan');
  if (action !== 'scan' && action !== 'capture') {
    return { error: { code: 'unsupported_action', message: `scanner.${action} desteklenmiyor.` } };
  }
  const p = (cmd.payload ?? {}) as { code?: string };
  if (!p.code) return { error: { code: 'bad_message', message: 'Tarama verisi (code) gerekli.' } };
  return { payload: { code: p.code, capturedAt: new Date().toISOString() } };
};

const handleEsign: CommandHandler = async () => {
  return { error: { code: 'unsupported_action', message: 'Nitelikli e-imza yakında.' } };
};
