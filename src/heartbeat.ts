// Cloud heartbeat (roadmap §50).
//
// A lightweight "ping" the agent sends to the cloud every few minutes so the
// panel can show which Connectors are online, what capabilities they advertise,
// and whether they're on the current version. Revoked tokens surface as a 401,
// which the agent treats as a logout signal. Pure client — the server side
// lives in the fullstack server submodule (POST /v1/connector/heartbeat).

import { defaultConfig, loadConfig, saveConfig } from './config';
import { advertisedCapabilities, agentInfo } from './pair';
import { CONNECTOR_VERSION } from './version';

const HEARTBEAT_INTERVAL_MS = 1000 * 60 * 3; // 3 minutes

interface HeartbeatResponse {
  success?: boolean;
  data?: { revoked?: boolean; minVersion?: string };
  error?: { message?: string };
}

export interface HeartbeatPayload {
  deviceId: string;
  version: string;
  os: string;
  capabilities: readonly string[];
  apiBase: string;
  sentAt: string;
}

export function buildHeartbeat(cfg: ReturnType<typeof loadConfig>): HeartbeatPayload | null {
  if (!cfg.token || !cfg.deviceId) return null;
  return {
    deviceId: cfg.deviceId,
    version: CONNECTOR_VERSION,
    os: agentInfo().os,
    capabilities: advertisedCapabilities(cfg),
    apiBase: cfg.apiBase,
    sentAt: new Date().toISOString(),
  };
}

async function postHeartbeat(cfg: ReturnType<typeof loadConfig>): Promise<HeartbeatResponse | null> {
  const payload = buildHeartbeat(cfg);
  if (!payload) return null;
  const base = cfg.apiBase.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/connector/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as HeartbeatResponse | null;
    // Revocation is signalled either by HTTP 401 or by the server's
    // unauthorized detail (the v1 framework maps user errors to 400, so we
    // cannot rely on status alone).
    const revoked = res.status === 401 || json?.error?.message?.includes('iptal edilmiş') || false;
    if (revoked) {
      console.warn('Connector oturumu panelden kapatılmış. Yerel oturum sıfırlanıyor.');
      saveConfig({ ...defaultConfig(), apiBase: cfg.apiBase, statusPort: cfg.statusPort, printer: cfg.printer });
      return { success: false, data: { revoked: true } };
    }
    return json;
  } catch {
    return null; // network errors are non-fatal for heartbeat
  }
}

export function startHeartbeatLoop(cfg: ReturnType<typeof loadConfig>): void {
  const tick = () => {
    const current = loadConfig();
    if (current.token) void postHeartbeat(current);
  };
  setTimeout(tick, 15_000);
  setInterval(tick, HEARTBEAT_INTERVAL_MS);
}

export { postHeartbeat };
