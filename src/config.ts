// Local config persistence. Stored in the user's home directory so a compiled
// binary keeps its pairing token across restarts. No secrets in env-only.

import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ConnectorConfig {
  apiBase: string;
  token: string | null;
  deviceId: string | null;
  label: string | null;
  printer: PrinterConfig | null;
  statusPort: number;
}

export interface PrinterConfig {
  host: string;
  port: number;
  /** ESC/POS character code page id (default 0). */
  codePage?: number;
}

const DEFAULT_API = 'https://api.ankarayazilim.org/v1';

export function configPath(): string {
  return join(homedir(), '.ankara-connector', 'config.json');
}

export function defaultConfig(): ConnectorConfig {
  return {
    apiBase: DEFAULT_API,
    token: null,
    deviceId: null,
    label: null,
    printer: null,
    statusPort: 4781,
  };
}

export function loadConfig(): ConnectorConfig {
  const fs = require('node:fs');
  let text = '';
  try {
    text = fs.readFileSync(configPath(), 'utf8');
  } catch {
    return defaultConfig();
  }
  try {
    const parsed = JSON.parse(text) as Partial<ConnectorConfig>;
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg: ConnectorConfig): void {
  const fs = require('node:fs');
  const path = configPath();
  fs.mkdirSync(require('node:path').dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
  try {
    fs.chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms that ignore chmod
  }
}
