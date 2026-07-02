// Local config persistence. Stored in the user's home directory so a compiled
// binary keeps its pairing token across restarts. No secrets in env-only.
//
// The device token (roadmap §25) is stored via the OS keychain (see
// secret-store.ts) and is NOT persisted in config.json — config.json holds
// only non-secret fields. On load we fall back to a legacy token in config
// for one migration cycle, then move it into the keychain.

import { homedir } from 'node:os';
import { join } from 'node:path';

import { clearSecret, loadSecret, saveSecret } from './secret-store';

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
  /** Serve the loopback bridge over HTTPS/WSS (roadmap §24, enterprise §1).
   *  Default-on: the HTTPS panel cannot speak plain ws:// to a loopback endpoint
   *  without mixed-content errors. Set `tls: false` to opt out (e.g. for a
   *  dev panel served over http://). */
  tls?: boolean;
  /** Verified update staged for next restart. */
  pendingUpdate?: import('./update.js').PendingUpdate | null;
  // Phase 1 hardware devices
  barrier?: BarrierConfig | null;
  rfid?: RfidConfig | null;
  camera?: CameraConfig | null;
  signage?: SignageConfig | null;
  display?: DisplayConfig | null;
  wiegand?: WiegandConfig | null;
  biometric?: BiometricConfig | null;
  esign?: EsignConfig | null;
  /** Minimum milliseconds between polling iterations for a single device
   *  (roadmap §35 CPU throttling). 0 disables throttling. */
  pollMinIntervalMs?: number;
  /** Opt-in cloud crash reporting (roadmap §39). Default off; only metadata
   *  (version, OS, stack hash) is ever sent — never device/business data. */
  crashReporting?: boolean;
  /** User opted in to trust the localhost TLS cert in the OS store. */
  tlsCertTrusted?: boolean;
}

export interface PrinterConfig {
  host: string;
  port: number;
  /** ESC/POS character code page id (default 0). */
  codePage?: number;
}

/** Modbus barrier/relay device (roadmap §14). */
export interface BarrierConfig {
  host: string;
  port: number;
  /** Modbus slave unit id. */
  unit: number;
  /** Coil address that opens/closes the barrier. */
  coil: number;
}

/** UHF RFID reader (LLRP, roadmap §15). */
export interface RfidConfig {
  host: string;
  port: number;
}

/** ALPR / IP camera (RTSP + edge OCR, roadmap §13/28). */
export interface CameraConfig {
  /** rtsp://user:pass@host:port/path */
  rtspUrl: string;
  /** Optional ONVIF device service URL for discovery/capabilities. */
  onvifUrl?: string;
}

/** LED signage / tabela (roadmap signage.led). */
export interface SignageConfig {
  kind: 'tcp' | 'serial';
  /** host:port for tcp, COMx for serial. */
  endpoint: string;
  screen: number;
}

/** Customer-facing pole display (roadmap display.pole). */
export interface DisplayConfig {
  kind: 'serial' | 'tcp';
  endpoint: string;
}

/** Wiegand gate reader (roadmap rfid.gate). */
export interface WiegandConfig {
  /** USB-HID vid:pid of the Wiegand converter. */
  vidPid: string;
}

/** Biometric reader (roadmap §17). */
export interface BiometricConfig {
  /** 'mock' | 'zkteco' | 'suprema' — vendor plugin id. */
  plugin: string;
  /** Path to the vendor native SDK library (.node/.dll/.so). */
  libPath?: string;
}

/** PKCS#11 / NES e-imza (roadmap §16). */
export interface EsignConfig {
  /** Path to the PKCS#11 shared library (SoftHSM2 or vendor token). */
  pkcs11Lib: string;
}

const DEFAULT_API = 'https://api.ankarayazilim.org/v1';

/** Test-only config override (set then cleared by tests; null in production). */
let testConfigOverride: ConnectorConfig | null = null;

/** Test helper: override loadConfig() without touching the real config file. */
export function setConfigOverride(cfg: ConnectorConfig | null): void {
  testConfigOverride = cfg;
}

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
    pollMinIntervalMs: 250,
  };
}

export function loadConfig(): ConnectorConfig {
  if (testConfigOverride) return testConfigOverride;
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
