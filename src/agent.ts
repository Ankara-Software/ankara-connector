// Agent runtime: wires config → capability handlers → loopback status server.
// Also runs a background token-rotation tick so long-running agents keep a
// valid device token without operator intervention.

import { loadConfig, saveConfig } from './config';
import { agentInfo, advertisedCapabilities, rotateToken } from './pair';
import { startStatusServer, type AgentStatus, type CommandHandler } from './status';
import { printJob, sendRawBytes } from './printer';
import { encodeDrawerKick } from './escpos';
import type { Capability, CommandMessage } from './protocol';

const ROTATE_INTERVAL_MS = 1000 * 60 * 45; // rotate before typical 1h expiry

export async function runAgent(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.token) {
    console.error('Bağlayıcı henüz eşleştirilmemiş. Önce `ankara-connector pair <kod>` çalıştırın.');
    process.exit(2);
  }

  const info = agentInfo();
  const caps = advertisedCapabilities(cfg);
  const startedAt = new Date().toISOString();

  const status = (): AgentStatus => ({
    paired: !!cfg.token,
    deviceId: cfg.deviceId,
    label: cfg.label,
    apiBase: cfg.apiBase,
    capabilities: caps,
    printer: cfg.printer ? { host: cfg.printer.host, port: cfg.printer.port } : null,
    startedAt,
  });

  const handler = (cap: Capability): CommandHandler | null => {
    if (cap === 'printer.escpos' && cfg.printer) return handlePrint;
    if (cap === 'printer.label' && cfg.printer) return handleLabel;
    if (cap === 'drawer.kick' && cfg.printer) return handleDrawer;
    if (cap === 'scanner.barcode' || cap === 'scanner.qr') return handleScan;
    if (cap === 'signature.esign') return handleEsign;
    return null;
  };

  startStatusServer(cfg.statusPort, status, handler, () => info);

  // Background token rotation.
  setInterval(async () => {
    const r = await rotateToken(cfg.apiBase, cfg.token!);
    if (r.ok) {
      cfg.token = r.token;
      saveConfig(cfg);
    } else {
      console.error('Belirteç yenileme başarısız:', r.error);
    }
  }, ROTATE_INTERVAL_MS);

  console.log(`Ankara Yazılım Bağlayıcı çalışıyor (${info.os}). Cihaz: ${cfg.deviceId}`);
  console.log(`Yetenekler: ${caps.join(', ')}`);
  console.log('Panelden komut bekleniyor (ws://127.0.0.1:%d). Çıkmak için Ctrl+C.', cfg.statusPort);

  // Keep alive.
  await new Promise(() => {});
}

interface PrintPayload {
  header?: string;
  lines?: { text: string; bold?: boolean; align?: 'left' | 'center' | 'right'; size?: 'normal' | 'double' }[];
  footer?: string;
  cut?: boolean;
}

const handlePrint: CommandHandler = async (cmd: CommandMessage) => {
  const cfg = loadConfig();
  if (!cfg.printer) return { error: { code: 'device_error', message: 'Yazıcı yapılandırılmamış.' } };
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
  const cfg = loadConfig();
  if (!cfg.printer) return { error: { code: 'device_error', message: 'Yazıcı yapılandırılmamış.' } };
  const p = (cmd.payload ?? {}) as { text?: string };
  const r = await printJob(cfg.printer, { lines: [{ text: p.text ?? '', bold: true }] });
  if (!r.ok) return { error: { code: 'device_error', message: r.error || 'Etiket yazdırma başarısız' } };
  return { payload: { bytes: r.bytes } };
};

const handleDrawer: CommandHandler = async () => {
  const cfg = loadConfig();
  if (!cfg.printer) return { error: { code: 'device_error', message: 'Yazıcı yapılandırılmamış.' } };
  const r = await sendRawBytes(cfg.printer, encodeDrawerKick(1, 50, 50));
  if (!r.ok) return { error: { code: 'device_error', message: r.error || 'Para çekmecesi açılamadı' } };
  return { payload: { kicked: true, bytes: r.bytes } };
};

const handleScan: CommandHandler = async (cmd: CommandMessage) => {
  // Scanners feed events into the agent (serial/USB HID) — in v1 we accept a
  // scan payload from the panel for testing and echo it back as a confirmed
  // event. Real HID polling is wired per-platform in a later release.
  const p = (cmd.payload ?? {}) as { code?: string };
  if (!p.code) return { error: { code: 'bad_message', message: 'Tarama verisi (code) gerekli.' } };
  return { payload: { code: p.code, capturedAt: new Date().toISOString() } };
};

const handleEsign: CommandHandler = async () => {
  // Nitelikli e-imza (NES) donanım entegrasyonu henüz yok (operatör: SDK).
  return { error: { code: 'unsupported_action', message: 'Nitelikli e-imza yakında.' } };
};
