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

export type LoginStartResult =
  | { ok: true; started: true }
  | { ok: false; error: string };

let loginInProgress = false;

/** Open web auth in browser immediately; pairing completes asynchronously via callback. */
export function startLoginSession(): LoginStartResult {
  const cfg = loadConfig();
  if (cfg.token && cfg.deviceId) {
    return { ok: false, error: 'Zaten oturum açık.' };
  }
  if (loginInProgress) {
    return { ok: true, started: true };
  }
  loginInProgress = true;
  saveConfig({ ...cfg, sessionPaused: false });
  cancelAllPendingAuth();

  void (async () => {
    try {
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
    } catch (e) {
      logLine('warn', (e as Error).message);
    } finally {
      loginInProgress = false;
    }
  })();

  return { ok: true, started: true };
}

export function shouldSkipAutoAuth(cfg: ConnectorConfig): boolean {
  return !!cfg.sessionPaused;
}

export function isSessionPaused(cfg: ConnectorConfig = loadConfig()): boolean {
  return !!cfg.sessionPaused && !cfg.token;
}
