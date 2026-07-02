// Self-signed localhost TLS cert (roadmap §24, enterprise §1).
//
// Browsers block `wss://`/`https://` to a cert that isn't trusted. To move the
// loopback bridge off plain `ws://` (mixed content from the HTTPS panel) we
// generate a self-signed cert for `localhost` / `127.0.0.1` on first launch
// and persist it under ~/.ankara-connector/tls/. The cert is also installable
// into the OS trust store via `ankara-connector trust-cert` (follow-up).
//
// Generation shells out to `openssl` (present on macOS/Linux and on Windows via
// Git Bash / Win32OpenSSL). When openssl is unavailable we leave TLS off and
// the agent keeps serving plain HTTP/WS — no regression to the working flow.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configPath, loadConfig, saveConfig } from './config';
import { logLine } from './logger';

export interface TlsCert {
  cert: string;
  key: string;
  certPath: string;
  keyPath: string;
}

function tlsDir(): string {
  return join(dirname(configPath()), 'tls');
}

function certPath(): string {
  return join(tlsDir(), 'localhost.crt');
}
function keyPath(): string {
  return join(tlsDir(), 'localhost.key');
}

function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Generate a self-signed cert for localhost + 127.0.0.1 (10-year validity). */
export function generateLocalhostCert(): TlsCert | null {
  if (!opensslAvailable()) return null;
  const dir = tlsDir();
  mkdirSync(dir, { recursive: true });
  const crt = certPath();
  const key = keyPath();
  const subj = '/C=TR/O=Ankara Yazilim/CN=localhost';
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', key, '-out', crt,
        '-days', '3650', '-subj', subj,
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
  } catch {
    return null;
  }
  return { cert: readFileSync(crt, 'utf8'), key: readFileSync(key, 'utf8'), certPath: crt, keyPath: key };
}

/** Load an existing localhost cert, or generate one on first launch. */
export function loadOrGenerateCert(): TlsCert | null {
  const crt = certPath();
  const key = keyPath();
  if (existsSync(crt) && existsSync(key)) {
    return { cert: readFileSync(crt, 'utf8'), key: readFileSync(key, 'utf8'), certPath: crt, keyPath: key };
  }
  return generateLocalhostCert();
}

/** Best-effort: write a small README next to the cert explaining trust. */
export function writeTrustReadme(): void {
  const dir = tlsDir();
  if (!existsSync(dir)) return;
  const readme = join(dir, 'README.txt');
  if (existsSync(readme)) return;
  writeFileSync(
    readme,
    'Connector localhost sertifikasi\n\n' +
      'Bu sertifika Connector ile panel arasindaki yerel baglantiyi sifreler.\n' +
      'Tarayicinin guvenmesi icin isletim sistemi sertifika deposuna ekleyin:\n' +
      '  Windows : certutil -addstore Root localhost.crt\n' +
      '  macOS   : sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain localhost.crt\n' +
      '  Linux   : sudo cp localhost.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates\n',
    'utf8',
  );
}

function certPathFile(): string {
  return join(tlsDir(), 'localhost.crt');
}

/** Windows: certutil first, then PowerShell Import-Certificate fallback. */
function installCertWindowsUserStore(certPath: string): boolean {
  try {
    execFileSync('certutil', ['-user', '-addstore', 'Root', certPath], { stdio: 'ignore' });
    return true;
  } catch {
    /* certutil may fail on some builds — try PowerShell */
  }
  try {
    const escaped = certPath.replace(/'/g, "''");
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Import-Certificate -FilePath '${escaped}' -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null`,
      ],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

/** True when config marks the localhost cert as user-trusted and the file exists. */
export function isCertTrusted(): boolean {
  const cfg = loadConfig();
  if (!cfg.tlsCertTrusted) return false;
  return existsSync(certPathFile());
}

/** Install the localhost cert into the OS trust store so the HTTPS panel can
 *  reach `https://127.0.0.1:{port}` without browser warnings (roadmap §24,
 *  enterprise §1). Best-effort: requires admin/root on macOS/Linux; on Windows
 *  `certutil -addstore Root` works for the current user without elevation for
 *  the user store. Returns true on success, false when the tool is missing or
 *  the operation needs elevation. */
export function installCertToTrustStore(certPath: string = certPathFile()): boolean {
  if (!existsSync(certPath)) return false;
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      if (installCertWindowsUserStore(certPath)) {
        logLine('info', 'tls: sertifika Windows kullanıcı kök deposuna eklendi.');
        return true;
      }
      return false;
    }
    if (platform === 'darwin') {
      execFileSync(
        'security',
        ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', certPath],
        { stdio: 'ignore' },
      );
      logLine('info', 'tls: sertifika macOS System keychain güven listesine eklendi.');
      return true;
    }
    // Linux: copy to the CA bundle dir and refresh.
    const caDir = '/usr/local/share/ca-certificates';
    if (!existsSync(caDir)) return false;
    execFileSync('cp', [certPath, `${caDir}/connector-localhost.crt`], { stdio: 'ignore' });
    execFileSync('update-ca-certificates', [], { stdio: 'ignore' });
    logLine('info', 'tls: sertifika Linux CA deposuna eklendi.');
    return true;
  } catch (e) {
    logLine('warn', `tls: sertifika güven deposuna eklenemedi (yönetici izni gerekebilir): ${(e as Error).message}`);
    return false;
  }
}

/** Opt-in: install cert to OS trust store and persist flag in config. */
export function trustLocalhostCert(): boolean {
  const cert = loadOrGenerateCert();
  if (!cert) return false;
  writeTrustReadme();
  const ok = installCertToTrustStore(cert.certPath);
  if (ok) {
    const cfg = loadConfig();
    saveConfig({ ...cfg, tlsCertTrusted: true });
  }
  return ok;
}
