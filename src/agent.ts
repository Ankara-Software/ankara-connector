// Agent runtime: wires config → capability handlers → loopback status server.
// On first launch (no saved token) opens the web auth page and waits for the
// browser to deliver the device token via localhost callback. Session persists
// in ~/.ankara-connector/config.json across restarts.

import { cancelAllPendingAuth, waitForWebAuth } from './auth-flow';
import { loadConfig, saveConfig } from './config';
import { installCrashHandlers } from './crash-report';
import { buildDriverHost } from './drivers/host';
import { warmEsignDetection } from './esign-discover';
import { startHeartbeatLoop } from './heartbeat';
import { logLine } from './logger';
import { advertisedCapabilities, agentInfo, rotateToken } from './pair';
import { startPollFallback } from './poll-fallback';
import type { Capability } from './protocol';
import {
  isSessionPaused,
  loginSession,
  logoutSession,
  registerSessionChangeHandler,
  shouldSkipAutoAuth,
} from './session';
import { isPanelWsConnected, startStatusServer, type AgentStatus } from './status';
import { loadOrGenerateCert, writeTrustReadme } from './tls-cert';
import { CONNECTOR_VERSION } from './version';
import { startAutoUpdateLoop } from './update';

const ROTATE_INTERVAL_MS = 1000 * 60 * 45;

export async function runAgent(): Promise<void> {
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
      tenantName: c.tenantName,
      pairedAt: c.pairedAt,
      apiBase: c.apiBase,
      capabilities: caps,
      printer: c.printer ? { host: c.printer.host, port: c.printer.port } : null,
      startedAt,
      version: CONNECTOR_VERSION,
      sessionPaused: isSessionPaused(c),
    };
  };

  await warmEsignDetection();
  const host = buildDriverHost();
  const handler = (cap: Capability) => host.handlerFor(cap);

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

  registerSessionChangeHandler(() => {
    cfg = loadConfig();
  });

  startStatusServer(cfg.statusPort, status, handler, () => agentInfo(), tlsCfg, {
    onLogout: () => logoutSession(),
    onLogin: () => loginSession(),
    onApplyUpdate: async () => {
      const { applyPendingUpdate, pendingUpdateSummary } = await import('./update');
      const pending = pendingUpdateSummary();
      if (!pending) return { ok: false, error: 'Bekleyen güncelleme yok.' };
      const ok = await applyPendingUpdate(pending);
      if (ok) process.exit(0);
      return { ok: false, error: 'Güncelleme uygulanamadı.' };
    },
  });

  if (!cfg.token && !shouldSkipAutoAuth(cfg)) {
    try {
      const auth = await waitForWebAuth(cfg);
      cfg = {
        ...cfg,
        token: auth.token,
        deviceId: auth.deviceId,
        label: cfg.label || 'Connector',
        tenantName: auth.tenantName ?? cfg.tenantName,
        pairedAt: new Date().toISOString(),
        sessionPaused: false,
      };
      saveConfig(cfg);
      logLine('info', `Oturum açıldı — cihaz ${auth.deviceId} firmaya bağlandı.`);
      if (auth.tenantName) logLine('info', `Firma: ${auth.tenantName}`);
    } catch (e) {
      cancelAllPendingAuth();
      logLine('error', (e as Error).message);
      process.exit(2);
    }
  } else if (!cfg.token && shouldSkipAutoAuth(cfg)) {
    logLine('info', 'Oturum kapalı — durum sayfasından veya tray menüsünden oturum açabilirsiniz.');
  }

  let rotateTimer: ReturnType<typeof setInterval> | null = setInterval(async () => {
    const c = loadConfig();
    if (!c.token) return;
    const r = await rotateToken(c.apiBase, c.token);
    if (r.ok) {
      saveConfig({ ...c, token: r.token, deviceId: r.deviceId });
    } else {
      logLine('error', `Belirteç yenileme başarısız: ${r.error}`);
    }
  }, ROTATE_INTERVAL_MS);

  registerSessionChangeHandler(() => {
    cfg = loadConfig();
    if (!cfg.token && rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = null;
    } else if (cfg.token && !rotateTimer) {
      rotateTimer = setInterval(async () => {
        const c = loadConfig();
        if (!c.token) return;
        const r = await rotateToken(c.apiBase, c.token);
        if (r.ok) saveConfig({ ...c, token: r.token, deviceId: r.deviceId });
      }, ROTATE_INTERVAL_MS);
    }
  });

  const current = loadConfig();
  const caps = advertisedCapabilities(current);
  logLine('info', `Ankara Yazılım Connector çalışıyor (${info.os}). Cihaz: ${current.deviceId ?? '—'}`);
  logLine('info', `Yetenekler: ${caps.join(', ') || '—'}`);
  logLine(
    'info',
    `Panelden komut bekleniyor (${tlsCfg ? 'wss' : 'ws'}://127.0.0.1:${current.statusPort}).`,
  );

  startAutoUpdateLoop(current);
  startHeartbeatLoop(current);
  startPollFallback(host, { isPanelConnected: () => isPanelWsConnected() });

  await new Promise(() => {});
}
