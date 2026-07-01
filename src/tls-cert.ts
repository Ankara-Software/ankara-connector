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

import { configPath } from './config';

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
