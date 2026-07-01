// Crash reporting (roadmap §39) — local redacted crash dumps + opt-in cloud send.
//
// Registers `uncaughtException` / `unhandledRejection` handlers that write a
// redacted crash dump to disk (no device/business data — only version, OS,
// stack hash, and a redacted stack). An opt-in `sendCrashReport()` posts a
// metadata-only payload to `POST /v1/connector/crash-report` (fullstack) so the
// team can see crash rates without ever receiving sensitive data — consistent
// with the zero-cloud-storage policy (roadmap §26).
//
// Reporting is OFF by default; it activates only when the user opts in via
// `cfg.crashReporting === true` or the `CONNECTOR_CRASH_REPORTING=1` env var.

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

import { configPath, loadConfig } from './config';
import { CONNECTOR_VERSION } from './version';
import { agentInfo } from './pair';
import { logLine } from './logger';

export interface CrashDump {
  id: string;
  version: string;
  os: string;
  arch?: string;
  kind: 'uncaughtException' | 'unhandledRejection';
  message: string;
  stackHash: string;
  stack: string;
  occurredAt: string;
}

export interface CrashReportPayload {
  /** Anonymous crash id (random per process, not the device id). */
  crashId: string;
  version: string;
  os: string;
  arch?: string;
  kind: CrashDump['kind'];
  stackHash: string;
  occurredAt: string;
  // Intentionally NO stack text, NO device id, NO payload data.
}

let crashId = Math.random().toString(36).slice(2);

let crashDirOverride: string | null = null;
/** Test helper: redirect crash dumps to a temp dir. */
export function setCrashDirOverride(dir: string | null): void {
  crashDirOverride = dir;
}

function crashDir(): string {
  if (crashDirOverride) return crashDirOverride;
  return join(dirname(configPath()), 'crashes');
}

function crashPath(d: CrashDump): string {
  return join(crashDir(), `${d.occurredAt.replace(/[:.]/g, '-')}-${d.stackHash}.json`);
}

/** Redact anything that looks like a token, path under the user home, or IP. */
function redactStack(stack: string): string {
  const home = homedir();
  let s = stack.split(home).join('<home>');
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>');
  s = s.replace(/\btoken["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+/gi, 'token=<redacted>');
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>');
  return s;
}

function hashStack(stack: string): string {
  // Hash the first 5 frames so logically-identical crashes share a hash.
  const frames = stack.split('\n').filter((l) => l.includes('at ')).slice(0, 5).join('\n');
  return createHash('sha256').update(frames || stack).digest('hex').slice(0, 12);
}

export function writeCrashDump(kind: CrashDump['kind'], err: unknown): CrashDump {
  const e = err as Error;
  const stack = redactStack(e?.stack ?? String(err));
  const dump: CrashDump = {
    id: crashId,
    version: CONNECTOR_VERSION,
    os: agentInfo().os,
    arch: agentInfo().arch,
    kind,
    message: String(e?.message ?? String(err)).slice(0, 500),
    stackHash: hashStack(e?.stack ?? String(err)),
    stack,
    occurredAt: new Date().toISOString(),
  };
  try {
    mkdirSync(crashDir(), { recursive: true });
    appendFileSync(crashPath(dump), JSON.stringify(dump, null, 2) + '\n');
  } catch {
    // best-effort
  }
  logLine('error', `crash: ${dump.kind} ${dump.stackHash} ${dump.message}`);
  return dump;
}

/** Whether the user has opted into cloud crash reporting. */
export function crashReportingEnabled(): boolean {
  if (process.env.CONNECTOR_CRASH_REPORTING === '1') return true;
  try {
    return loadConfig().crashReporting === true;
  } catch {
    return false;
  }
}

/** Post a metadata-only crash report to the cloud (opt-in). */
export async function sendCrashReport(dump: CrashDump): Promise<boolean> {
  if (!crashReportingEnabled()) return false;
  const cfg = loadConfig();
  const base = cfg.apiBase.replace(/\/$/, '');
  const payload: CrashReportPayload = {
    crashId: dump.id,
    version: dump.version,
    os: dump.os,
    arch: dump.arch,
    kind: dump.kind,
    stackHash: dump.stackHash,
    occurredAt: dump.occurredAt,
  };
  try {
    const res = await fetch(`${base}/connector/crash-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Install global crash handlers. Safe to call once. */
let installed = false;
export function installCrashHandlers(): void {
  if (installed) return;
  installed = true;
  process.on('uncaughtException', (e) => {
    const dump = writeCrashDump('uncaughtException', e);
    void sendCrashReport(dump).catch(() => {});
    // Do not exit immediately — let the watchdog restart logic handle it, but
    // avoid an infinite crash loop by exiting after a short delay.
    setTimeout(() => process.exit(1), 500).unref?.();
  });
  process.on('unhandledRejection', (e) => {
    const dump = writeCrashDump('unhandledRejection', e);
    void sendCrashReport(dump).catch(() => {});
  });
}

/** Read recent local crash dumps (for the selftest CLI / status page). */
export function listLocalCrashes(): CrashDump[] {
  const dir = crashDir();
  if (!existsSync(dir)) return [];
  const fs = require('node:fs');
  const files = fs.readdirSync(dir) as string[];
  const dumps: CrashDump[] = [];
  for (const f of files.slice(-20)) {
    try {
      const text = readFileSync(join(dir, f), 'utf8');
      dumps.push(JSON.parse(text));
    } catch {
      // skip malformed
    }
  }
  return dumps;
}

/** Test helper: reset the installed flag + crash id. */
export function resetCrashHandlers(): void {
  installed = false;
  crashId = Math.random().toString(36).slice(2);
}
