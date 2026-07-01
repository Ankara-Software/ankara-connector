// Local config persistence. Stored in the user's home directory so a compiled
// binary keeps its pairing token across restarts. No secrets in env-only.
//
// The device token (roadmap §25) is stored via the OS keychain (see
// secret-store.ts) and is NOT persisted in config.json — config.json holds
// only non-secret fields. On load we fall back to a legacy token in config
// for one migration cycle, then move it into the keychain.

import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadSecret, saveSecret, clearSecret } from './secret-store';

export interface ConnectorConfig {
  apiBase: string;
  token: string | null;
  deviceId: string | null;
  label: string | null;
  /** Tenant display name from web auth (informational). */
  tenantName: string | null;
  /** ISO timestamp when this device was paired via web auth. */
  pairedAt: string | null;
  printer: PrinterConfig | null;
  statusPort: number;
  /** Verified update staged for next restart. */
  pendingUpdate?: import('./update.js').PendingUpdate | null;
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
    tenantName: null,
    pairedAt: null,
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
    const merged = { ...defaultConfig(), ...parsed };
    // Token is now stored in the OS keychain; fall back to legacy config token
    // for one migration cycle only.
    const keychainToken = loadSecret();
    if (keychainToken) {
      merged.token = keychainToken;
    } else if (parsed.token) {
      // Migrate legacy plaintext token into the keychain, then strip it.
      saveSecret(parsed.token);
      merged.token = parsed.token;
    }
    return merged;
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg: ConnectorConfig): void {
  const fs = require('node:fs');
  const path = configPath();
  // Persist the token to the keychain (never to config.json).
  if (cfg.token) {
    saveSecret(cfg.token);
  } else {
    clearSecret();
  }
  const { token: _omit, ...persist } = cfg;
  fs.mkdirSync(require('node:path').dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(persist, null, 2), 'utf8');
  try {
    fs.chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms that ignore chmod
  }
}
