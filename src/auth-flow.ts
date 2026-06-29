/**
 * Web auth pairing — agent opens the Ankara Yazılım auth page; after the user
 * logs in and confirms, the browser POSTs the device token to loopback callback.
 */

import { openBrowser } from './browser';
import { agentInfo, advertisedCapabilities } from './pair';
import type { ConnectorConfig } from './config';

export const AUTH_SITE_BASE = 'https://ankarayazilim.org';
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface AuthCallbackPayload {
  state: string;
  token: string;
  deviceId: string;
  tenantId?: string;
  tenantName?: string;
}

type PendingAuth = {
  resolve: (payload: AuthCallbackPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingByState = new Map<string, PendingAuth>();

/** Called by the loopback status server when the browser delivers the token. */
export function deliverAuthCallback(payload: AuthCallbackPayload): boolean {
  const pending = pendingByState.get(payload.state);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingByState.delete(payload.state);
  pending.resolve(payload);
  return true;
}

export function cancelAllPendingAuth(reason = 'cancelled'): void {
  for (const [state, pending] of pendingByState) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    pendingByState.delete(state);
  }
}

function newState(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Open the web auth page and wait for localhost callback delivery.
 * @throws on timeout or user cancellation
 */
export function waitForWebAuth(cfg: ConnectorConfig): Promise<AuthCallbackPayload> {
  const state = newState();
  const info = agentInfo();
  const caps = advertisedCapabilities(cfg);
  const port = cfg.statusPort;

  const params = new URLSearchParams({
    state,
    port: String(port),
    os: info.os,
    v: info.version,
    caps: caps.join(','),
  });

  const authUrl = `${AUTH_SITE_BASE}/connector/baglan?${params.toString()}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingByState.delete(state);
      reject(new Error('Oturum açma süresi doldu. Connector’ı yeniden başlatın.'));
    }, AUTH_TIMEOUT_MS);

    pendingByState.set(state, { resolve, reject, timer });

    console.log('Tarayıcıda oturum açma sayfası açılıyor…');
    console.log(`  ${authUrl}`);
    try {
      openBrowser(authUrl);
    } catch (e) {
      clearTimeout(timer);
      pendingByState.delete(state);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
