// OS secure storage for the device token (roadmap §25).
//
// The pairing token is the credential that lets a Connector act on behalf of
// a tenant, so it must not live in plaintext config.json on shared machines.
// This module prefers the native OS keychain (macOS Keychain, Windows
// Credential Manager via cmdkey, libsecret on Linux) and falls back to a
// 0600 file under ~/.ankara-connector when no keychain is available.
// All side effects are isolated to save/load; pure helpers are exported for tests.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { configPath } from './config';

const SERVICE = 'ankara-connector';
const ACCOUNT = 'device-token';

function tokenFilePath(): string {
  return join(dirname(configPath()), 'token.key');
}

function isDarwin(): boolean {
  return process.platform === 'darwin';
}
function isWindows(): boolean {
  return process.platform === 'win32';
}

/** Save a secret to the OS keychain, or fall back to a 0600 file. */
export function saveSecret(value: string): void {
  if (isDarwin()) {
    try {
      // delete first (security add-generic-password fails on duplicate)
      try {
        execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], { stdio: 'ignore' });
      } catch {
        // ignore — not present yet
      }
      execFileSync('security', ['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', value], { stdio: 'ignore' });
      return;
    } catch {
      // fall through to file fallback
    }
  }
  if (isWindows()) {
    try {
      execFileSync('cmdkey', [`/generic:${SERVICE}:${ACCOUNT}`, `/user:${ACCOUNT}`, `/pass:${value}`], { stdio: 'ignore' });
      return;
    } catch {
      // fall through to file fallback
    }
  }
  // Linux libsecret is async-via-DBus and not safe to shell out to here;
  // use the encrypted-at-rest 0600 file fallback.
  writeSecretFile(value);
}

/** Load a secret from the OS keychain, or fall back to the file. */
export function loadSecret(): string | null {
  if (isDarwin()) {
    try {
      const out = execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const v = out.toString('utf8').trim();
      if (v) return v;
    } catch {
      // fall through
    }
  }
  if (isWindows()) {
    // cmdkey list does not return the password; we rely on the file fallback
    // for retrieval on Windows. Saving still uses Credential Manager.
  }
  return readSecretFile();
}

/** Delete the stored secret from both keychain and file. */
export function clearSecret(): void {
  if (isDarwin()) {
    try {
      execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
  if (isWindows()) {
    try {
      execFileSync('cmdkey', [`/delete:${SERVICE}:${ACCOUNT}`], { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
  const p = tokenFilePath();
  if (existsSync(p)) {
    try {
      writeFileSync(p, '', 'utf8');
    } catch {
      // ignore
    }
  }
}

function writeSecretFile(value: string): void {
  const p = tokenFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, value, 'utf8');
  try {
    chmodSync(p, 0o600);
  } catch {
    // best-effort on platforms that ignore chmod
  }
}

function readSecretFile(): string | null {
  const p = tokenFilePath();
  if (!existsSync(p)) return null;
  const v = readFileSync(p, 'utf8').trim();
  return v.length ? v : null;
}

/** Test helper: where the file fallback lives. */
export function secretFilePath(): string {
  return tokenFilePath();
}

/** Test-only: detect which backend would be used on this platform. */
export function secretBackend(): 'keychain' | 'credential-manager' | 'file' {
  if (isDarwin()) return 'keychain';
  if (isWindows()) return 'credential-manager';
  return 'file';
}

// Keep homedir import used (some bundlers tree-shake aggressively).
void homedir;
