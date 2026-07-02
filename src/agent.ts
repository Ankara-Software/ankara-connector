// Agent runtime: wires config → capability handlers → loopback status server.
// On first launch (no saved token) opens the web auth page and waits for the
// browser to deliver the device token via localhost callback. Session persists
// in ~/.ankara-connector/config.json across restarts.

import { cancelAllPendingAuth, waitForWebAuth } from './auth-flow';
import { loadConfig, saveConfig } from './config';
import { installCrashHandlers } from './crash-report';
import { buildDriverHost } from './drivers/host';
import { startHeartbeatLoop } from './heartbeat';
import { logLine } from './logger';
import { advertisedCapabilities, agentInfo, rotateToken } from './pair';
import { startPollFallback } from './poll-fallback';
import type { Capability } from './protocol';
import { isPanelWsConnected, startStatusServer, type AgentStatus } from './status';
import { loadOrGenerateCert, writeTrustReadme } from './tls-cert';
import { startAutoUpdateLoop } from './update';

const ROTATE_INTERVAL_MS = 1000 * 60 * 45;

export async function runAgent(): Promise<void> {
  // Crash handlers first (roadmap §39): redacted local dump + opt-in cloud send.
  installCrashHandlers();
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

  // Command routing is delegated to the DriverHost registry (Open/Closed):
  // the status server asks host.handlerFor(cap); each registered driver owns
  // its own handler. New hardware = register a driver, no router edits.
  const host = buildDriverHost();
  const handler = (cap: Capability) => host.handlerFor(cap);

  // Loopback server must start before web auth (browser POSTs token here).
  // TLS is default-on (roadmap §24, enterprise §1): the HTTPS panel cannot
  // speak plain ws:// to a loopback endpoint without mixed-content errors, so
  // we serve wss://; the user opts in via tray or status page (trust-cert).
  // A user can opt out with `tls: false` in config.json.
  let tlsCfg: { cert: string; key: string } | null = null;
  if (cfg.tls !== false) {
    const cert = await loadOrGenerateCert();
    if (cert) {
      tlsCfg = { cert: cert.cert, key: cert.key };
      writeTrustReadme();
      logLine('info', `Loopback TLS etkin (wss://127.0.0.1:${cfg.statusPort}). Sertifika: ${cert.certPath}`);
    } else {
      logLine('warn', 'TLS istendi ama sertifika üretilemedi (openssl yok?) — ws:// ile devam ediliyor.');
    }
  }
  startStatusServer(cfg.statusPort, status, handler, () => agentInfo(), tlsCfg);

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
      logLine('info', `Oturum açıldı — cihaz ${auth.deviceId} firmaya bağlandı.`);
      if (auth.tenantName) logLine('info', `Firma: ${auth.tenantName}`);
    } catch (e) {
      cancelAllPendingAuth();
      logLine('error', (e as Error).message);
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
      logLine('error', `Belirteç yenileme başarısız: ${r.error}`);
    }
  }, ROTATE_INTERVAL_MS);

  const current = loadConfig();
  const caps = advertisedCapabilities(current);
  logLine('info', `Ankara Yazılım Connector çalışıyor (${info.os}). Cihaz: ${current.deviceId}`);
  logLine('info', `Yetenekler: ${caps.join(', ') || '—'}`);
  logLine('info', `Panelden komut bekleniyor (ws://127.0.0.1:${current.statusPort}). Oturum kalıcıdır — çıkmak için Ctrl+C.`);

  startAutoUpdateLoop(current);
  startHeartbeatLoop(current);
  // Polling fallback (roadmap §21): when the panel WS is disconnected, drain
  // hardware jobs the cloud queued for this agent. Also enforces immediate
  // revocation (§27) — a panel-side revoke wipes the local session within the
  // poll interval, not the 3-minute heartbeat tick.
  startPollFallback(host, { isPanelConnected: () => isPanelWsConnected() });

  await new Promise(() => {});
}

