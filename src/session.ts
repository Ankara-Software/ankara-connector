/** Local session management — logout/login without restarting the agent process. */

import { cancelAllPendingAuth, waitForWebAuth } from './auth-flow';
import { defaultConfig, loadConfig, saveConfig, type ConnectorConfig } from './config';
import { logLine } from './logger';

let onSessionChanged: (() => void) | null = null;

export function registerSessionChangeHandler(fn: () => void): void {
  onSessionChanged = fn;
}

function notifySessionChanged(): void {
  onSessionChanged?.();
}

/** Clear pairing credentials; do not auto-open browser until user requests login. */
export function logoutSession(): { ok: true } {
  const cfg = loadConfig();
  cancelAllPendingAuth();
  saveConfig({
    ...defaultConfig(),
    apiBase: cfg.apiBase,
    statusPort: cfg.statusPort,
    printer: cfg.printer,
    tls: cfg.tls,
    sessionPaused: true,
  });
  notifySessionChanged();
  logLine('info', 'Yerel oturum kapatıldı.');
  return { ok: true };
}

/** Start web auth flow (opens browser). Returns when paired or throws on timeout. */
export async function loginSession(): Promise<{ ok: true; deviceId: string; tenantName?: string }> {
  const cfg = loadConfig();
  if (cfg.token && cfg.deviceId) {
    throw new Error('Zaten oturum açık.');
  }
  saveConfig({ ...cfg, sessionPaused: false });
  cancelAllPendingAuth();
  const auth = await waitForWebAuth(loadConfig());
  const next: ConnectorConfig = {
    ...loadConfig(),
    token: auth.token,
    deviceId: auth.deviceId,
    label: cfg.label || 'Connector',
    tenantName: auth.tenantName ?? cfg.tenantName,
    pairedAt: new Date().toISOString(),
    sessionPaused: false,
  };
  saveConfig(next);
  notifySessionChanged();
  logLine('info', `Oturum açıldı — cihaz ${auth.deviceId}.`);
  if (auth.tenantName) logLine('info', `Firma: ${auth.tenantName}`);
  return { ok: true, deviceId: auth.deviceId, tenantName: auth.tenantName };
}

export function shouldSkipAutoAuth(cfg: ConnectorConfig): boolean {
  return !!cfg.sessionPaused;
}

export function isSessionPaused(cfg: ConnectorConfig = loadConfig()): boolean {
  return !!cfg.sessionPaused && !cfg.token;
}
