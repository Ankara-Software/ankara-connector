// Cloud polling fallback (roadmap §21) + immediate revocation (roadmap §27).
//
// When the loopback WebSocket to the panel has no connected clients (browser
// closed, tab slept) OR the cloud heartbeat is failing, the agent polls the
// cloud's `POST /v1/connector/pending-jobs` endpoint to drain hardware work
// the panel queued for it (print jobs, barrier commands, signage updates). Each
// pulled job is dispatched through the DriverHost just like a live WS command,
// so behavior is identical whether the panel is connected or not.
//
// Revocation (§27): on every poll, if the cloud signals an unauthorized/revoked
// token, the agent wipes its local session immediately — no waiting for the
// 3-minute heartbeat tick. This makes a panel-side revoke take effect within
// the poll interval (default 20s) instead of up to 3 minutes.

import { defaultConfig, loadConfig, saveConfig, type ConnectorConfig } from './config';
import { logLine } from './logger';
import { advertisedCapabilities } from './pair';
import type { CommandMessage, Capability } from './protocol';
import type { DriverHost } from './driver-host';
import { isCapability } from './protocol';

const DEFAULT_POLL_INTERVAL_MS = 1000 * 20;

export interface PollFallbackOptions {
  /** Returns true when a panel WS client is currently connected (skip polling). */
  isPanelConnected?: () => boolean;
  /** Poll interval (ms). */
  intervalMs?: number;
}

interface PendingJobsResponse {
  success?: boolean;
  data?: { ok?: boolean; deviceId?: string; jobs?: RawPendingJob[] };
  error?: { message?: string };
}

interface RawPendingJob {
  id: string;
  cap: string;
  action: string;
  payload?: unknown;
}

/**
 * Fetch pending jobs from the cloud for this device. Returns the job list or
 * null on network failure. Throws { revoked: true } when the token is revoked.
 */
export async function fetchPendingJobs(cfg: ConnectorConfig): Promise<RawPendingJob[] | null> {
  if (!cfg.token) return null;
  const base = cfg.apiBase.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/connector/pending-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ limit: 25 }),
    });
    if (res.status === 401) throw new RevokedError();
    const json = (await res.json().catch(() => null)) as PendingJobsResponse | null;
    if (!json) return null;
    if (json.error?.message?.includes('iptal edilmiş')) throw new RevokedError();
    return json.data?.jobs ?? [];
  } catch (e) {
    if (e instanceof RevokedError) throw e;
    return null; // network errors are non-fatal
  }
}

export class RevokedError extends Error {
  readonly revoked = true;
  constructor() {
    super('Connector oturumu panelden kapatılmış.');
  }
}

/** Dispatch a single pending job through the DriverHost command router. */
export async function dispatchPendingJob(host: DriverHost, job: RawPendingJob): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  if (!isCapability(job.cap)) {
    return { ok: false, error: { code: 'unknown_capability', message: `Bilinmeyen yetenek: ${job.cap}` } };
  }
  const handler = host.handlerFor(job.cap as Capability);
  if (!handler) {
    return { ok: false, error: { code: 'unknown_capability', message: 'Bu yetenek bu cihazda yok.' } };
  }
  const cmd: CommandMessage = {
    kind: 'command',
    v: 1,
    id: job.id,
    cap: job.cap as Capability,
    action: job.action,
    ...(job.payload !== undefined ? { payload: job.payload } : {}),
  };
  try {
    const r = await handler(cmd);
    if (r.error) return { ok: false, error: r.error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: { code: 'device_error', message: (e as Error).message } };
  }
}

/**
 * Start the polling fallback loop. Activates only when the panel WS is
 * disconnected (or always, when no `isPanelConnected` is supplied). Drains
 * pending jobs and dispatches them through the host. Wipes the local session
 * on revocation.
 */
export function startPollFallback(host: DriverHost, opts: PollFallbackOptions = {}): void {
  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const isPanelConnected = opts.isPanelConnected ?? (() => false);

  const tick = async () => {
    const cfg = loadConfig();
    if (!cfg.token) return;
    // Skip polling when the panel is live — WS handles commands in real time.
    if (isPanelConnected()) return;

    try {
      const jobs = await fetchPendingJobs(cfg);
      if (!jobs || jobs.length === 0) return;
      logLine('info', `poll-fallback: ${jobs.length} bekleyen iş bulundu, işleniyor.`);
      for (const job of jobs) {
        const r = await dispatchPendingJob(host, job);
        if (!r.ok) {
          logLine('warn', `poll-fallback: iş ${job.id} (${job.cap}) başarısız — ${r.error?.message ?? 'bilinmeyen'}`);
        }
      }
    } catch (e) {
      if (e instanceof RevokedError) {
        logLine('warn', 'poll-fallback: oturum kapatılmış, yerel oturum sıfırlanıyor.');
        const c = loadConfig();
        saveConfig({ ...defaultConfig(), apiBase: c.apiBase, statusPort: c.statusPort, printer: c.printer });
      } else {
        // network error — silent, will retry next tick
      }
    }
  };

  setTimeout(tick, 10_000);
  setInterval(tick, intervalMs);
}

/** Probe revocation on demand (e.g. on a WS reconnect). Returns true when revoked. */
export async function probeRevocation(cfg: ConnectorConfig): Promise<boolean> {
  try {
    await fetchPendingJobs(cfg);
    return false;
  } catch (e) {
    if (e instanceof RevokedError) {
      return true;
    }
    return false;
  }
}

// Keep advertisedCapabilities referenced for future telemetry enrichment.
void advertisedCapabilities;
