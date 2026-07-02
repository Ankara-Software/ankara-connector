/**
 * Safe auto-update for Connector desktop agents.
 * - Polls GET /v1/public/releases/check
 * - Downloads only when sha256 is published
 * - Applies on next restart (never mid-command)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConnectorConfig } from './config';
import { configPath, loadConfig, saveConfig } from './config';
import { CONNECTOR_VERSION } from './version';

const CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6;
const WIN_TRAY_EXE = 'AnkaraYazilimConnector.exe';
const WIN_CORE_EXE = 'ankara-connector-core.exe';
const WIN_INSTALL_DIR = 'C:\\Program Files\\Ankara Yazilim\\Connector';

export interface PendingUpdate {
  version: string;
  path: string;
  sha256: string;
  filename: string;
}

interface CheckResponse {
  success?: boolean;
  data?: {
    updateAvailable?: boolean;
    mandatory?: boolean;
    latest?: string;
    downloadUrl?: string;
    sha256?: string;
    filename?: string;
    releaseNotesUrl?: string;
  };
}

export function connectorPlatformKey(): string {
  const p = process.platform;
  const arch = process.arch;
  if (p === 'win32') return 'windows-x64';
  if (p === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  return 'linux-x64';
}

/** True when the staged artifact is the NSIS installer (not a raw core binary). */
export function isWindowsSetupArtifact(pending: PendingUpdate): boolean {
  const name = pending.filename.toLowerCase();
  return name.includes('setup') || name.includes('ankaraconnector-setup');
}

function updatesDir(): string {
  const dir = join(require('node:path').dirname(configPath()), 'updates');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function apiOrigin(apiBase: string): string {
  return apiBase.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

export async function fetchUpdateCheck(apiBase: string, current = CONNECTOR_VERSION) {
  const origin = apiOrigin(apiBase);
  const platform = connectorPlatformKey();
  const url = `${origin}/v1/public/releases/check?product=connector&platform=${encodeURIComponent(platform)}&current=${encodeURIComponent(current)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as CheckResponse | null;
}

async function sha256File(path: string): Promise<string> {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

export async function downloadPendingUpdate(
  apiBase: string,
  current = CONNECTOR_VERSION,
): Promise<PendingUpdate | null> {
  const json = await fetchUpdateCheck(apiBase, current);
  const data = json?.data;
  if (!data?.updateAvailable || !data.downloadUrl || !data.sha256) return null;

  const filename = data.filename || `ankara-connector-${data.latest}`;
  const dest = join(updatesDir(), `${data.latest}-${filename}`);
  const res = await fetch(data.downloadUrl);
  if (!res.ok) throw new Error(`İndirme başarısız (${res.status})`);

  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);

  const hash = createHash('sha256').update(buf).digest('hex');
  if (hash.toLowerCase() !== data.sha256.toLowerCase()) {
    unlinkSync(dest);
    throw new Error('SHA-256 doğrulaması başarısız — güncelleme reddedildi.');
  }

  return {
    version: data.latest || CONNECTOR_VERSION,
    path: dest,
    sha256: data.sha256,
    filename,
  };
}

export async function stageUpdateIfAvailable(cfg: ConnectorConfig): Promise<PendingUpdate | null> {
  try {
    const pending = await downloadPendingUpdate(cfg.apiBase);
    if (!pending) return null;
    saveConfig({ ...loadConfig(), pendingUpdate: pending });
    console.log(`Güncelleme hazır: ${pending.version} (uygulamak için yeniden başlatın veya tray menüsünü kullanın).`);
    return pending;
  } catch (e) {
    console.error('Güncelleme kontrolü:', (e as Error).message);
    return null;
  }
}

function writeWindowsCoreApplyScript(targetExe: string, pendingPath: string): string {
  const scriptPath = join(updatesDir(), 'apply-update.cmd');
  const content = `@echo off\r\nping 127.0.0.1 -n 3 > nul\r\ntaskkill /F /IM ${WIN_TRAY_EXE} /T 2>nul\r\ntaskkill /F /IM ${WIN_CORE_EXE} /T 2>nul\r\ncopy /Y "${pendingPath}" "${targetExe}"\r\nstart "" "${join(WIN_INSTALL_DIR, WIN_TRAY_EXE)}"\r\ndel "%~f0"\r\n`;
  writeFileSync(scriptPath, content, 'utf8');
  return scriptPath;
}

function writeWindowsSetupApplyScript(pendingPath: string): string {
  const scriptPath = join(updatesDir(), 'apply-update.cmd');
  const trayPath = join(WIN_INSTALL_DIR, WIN_TRAY_EXE);
  const content = `@echo off\r\ntaskkill /F /IM ${WIN_TRAY_EXE} /T 2>nul\r\ntaskkill /F /IM ${WIN_CORE_EXE} /T 2>nul\r\nping 127.0.0.1 -n 2 > nul\r\n"${pendingPath}" /S\r\nping 127.0.0.1 -n 2 > nul\r\nstart "" "${trayPath}"\r\ndel "%~f0"\r\n`;
  writeFileSync(scriptPath, content, 'utf8');
  return scriptPath;
}

function writeUnixApplyScript(targetExe: string, pendingPath: string): string {
  const scriptPath = join(updatesDir(), 'apply-update.sh');
  const content = `#!/bin/sh\nsleep 2\ncp "${pendingPath}" "${targetExe}"\nchmod +x "${targetExe}"\nexec "${targetExe}" run\n`;
  writeFileSync(scriptPath, content, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

/** Apply a verified pending update and restart the agent process. */
export async function applyPendingUpdate(pending: PendingUpdate): Promise<boolean> {
  if (!existsSync(pending.path)) return false;
  const hash = await sha256File(pending.path);
  if (hash.toLowerCase() !== pending.sha256.toLowerCase()) {
    console.error('Bekleyen güncelleme SHA-256 uyuşmuyor — uygulanmadı.');
    return false;
  }

  const cfg = loadConfig();
  saveConfig({ ...cfg, pendingUpdate: null });

  let script: string;
  if (process.platform === 'win32' && isWindowsSetupArtifact(pending)) {
    script = writeWindowsSetupApplyScript(pending.path);
  } else if (process.platform === 'win32') {
    script = writeWindowsCoreApplyScript(process.execPath, pending.path);
  } else {
    script = writeUnixApplyScript(process.execPath, pending.path);
  }

  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
  }
  return true;
}

export function startAutoUpdateLoop(cfg: ConnectorConfig): void {
  const tick = () => {
    void stageUpdateIfAvailable(cfg);
  };
  setTimeout(tick, 30_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}

export async function tryApplyStoredUpdate(): Promise<boolean> {
  const cfg = loadConfig();
  const pending = cfg.pendingUpdate;
  if (!pending) return false;
  console.log(`Bekleyen güncelleme uygulanıyor: ${pending.version}`);
  const ok = await applyPendingUpdate(pending);
  if (ok) process.exit(0);
  return false;
}

export function pendingUpdateSummary(cfg: ConnectorConfig = loadConfig()): PendingUpdate | null {
  return cfg.pendingUpdate ?? null;
}
