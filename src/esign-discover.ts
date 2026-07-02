// E-imza auto-discovery — PKCS#11 middleware paths + Windows certificate store.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, saveConfig, type ConnectorConfig } from './config';
import { logLine } from './logger';

/** Common Turkish e-imza / smart card PKCS#11 libraries on Windows. */
export const WINDOWS_PKCS11_CANDIDATES: readonly string[] = [
  'C:\\Windows\\System32\\akisp11.dll',
  'C:\\Windows\\SysWOW64\\akisp11.dll',
  'C:\\Windows\\System32\\eTPKCS11.dll',
  'C:\\Windows\\SysWOW64\\eTPKCS11.dll',
  'C:\\Windows\\System32\\gclib.dll',
  'C:\\Windows\\System32\\aetpkss1.dll',
  'C:\\Windows\\System32\\siecap11.dll',
  'C:\\Program Files\\SafeSign Identity Client\\Classic\\PKCS11\\siecap11.dll',
  'C:\\Program Files (x86)\\SafeSign Identity Client\\Classic\\PKCS11\\siecap11.dll',
  'C:\\Program Files\\Akis\\pkcs11\\akisp11.dll',
  'C:\\Program Files (x86)\\Akis\\pkcs11\\akisp11.dll',
  'C:\\Program Files\\e-Tugra\\eTPKCS11\\eTPKCS11.dll',
  'C:\\Program Files (x86)\\e-Tugra\\eTPKCS11\\eTPKCS11.dll',
  'C:\\Program Files\\U-NET\\UNET_P11.dll',
  'C:\\Program Files (x86)\\U-NET\\UNET_P11.dll',
];

export interface EsignTokenInfo {
  id: string;
  label: string;
  certSubject: string | null;
  source: 'pkcs11' | 'windows-cert';
}

let cachedWindowsTokens: EsignTokenInfo[] | null = null;
let cacheAt = 0;
const CACHE_MS = 30_000;

/** First PKCS#11 DLL that exists on disk. */
export function discoverPkcs11Lib(): string | null {
  const configured = loadConfig().esign?.pkcs11Lib?.trim();
  if (configured && existsSync(configured)) return configured;
  if (process.platform !== 'win32') return configured || null;
  for (const path of WINDOWS_PKCS11_CANDIDATES) {
    if (existsSync(path)) return path;
  }
  return configured || null;
}

/** Persist discovered PKCS#11 path when not yet configured. */
export function ensureEsignConfigured(cfg: ConnectorConfig = loadConfig()): ConnectorConfig {
  if (cfg.esign?.pkcs11Lib?.trim() && existsSync(cfg.esign.pkcs11Lib.trim())) return cfg;
  const lib = discoverPkcs11Lib();
  if (!lib) return cfg;
  const next = { ...cfg, esign: { pkcs11Lib: lib } };
  saveConfig(next);
  logLine('info', `E-imza: PKCS#11 kütüphanesi algılandı — ${lib}`);
  return next;
}

/** List signing certificates on smart card / hardware KSP (Windows). */
export async function listWindowsEsignTokens(): Promise<EsignTokenInfo[]> {
  if (process.platform !== 'win32') return [];
  const now = Date.now();
  if (cachedWindowsTokens && now - cacheAt < CACHE_MS) return cachedWindowsTokens;

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$items = @()
Get-ChildItem Cert:\\CurrentUser\\My | ForEach-Object {
  try {
    $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($_.Thumbprint)
    if (-not $cert.HasPrivateKey) { return }
    $hardware = $false
    try {
      $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
      if ($rsa -and $rsa.GetType().Name -eq 'RSACng') {
        $key = [System.Security.Cryptography.CngKey]::Open($rsa.Key.UniqueName)
        if ($key.IsHardwareDevice) { $hardware = $true }
      }
    } catch {}
    $subj = $cert.Subject
    $looksQualified = $hardware -or ($subj -match 'SERIALNUMBER=|TCKN|VKN|KAMU SM|MERSIS')
    if (-not $looksQualified) { return }
    $label = if ($subj -match 'CN=([^,]+)') { $matches[1] } else { $subj }
    $items += [PSCustomObject]@{
      id = $cert.Thumbprint
      label = $label
      certSubject = $subj
      source = 'windows-cert'
    }
  } catch {}
}
if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress -AsArray }
`;

  try {
    const proc = Bun.spawn(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) {
      cachedWindowsTokens = [];
      cacheAt = now;
      return [];
    }
    const raw = stdout.trim();
    if (!raw || raw === '[]') {
      cachedWindowsTokens = [];
      cacheAt = now;
      return [];
    }
    const parsed = JSON.parse(raw) as Array<{ id: string; label: string; certSubject: string; source?: string }>;
    const list = (Array.isArray(parsed) ? parsed : [parsed]).map((t) => ({
      id: t.id,
      label: t.label,
      certSubject: t.certSubject ?? null,
      source: 'windows-cert' as const,
    }));
    cachedWindowsTokens = list;
    cacheAt = now;
    return list;
  } catch {
    cachedWindowsTokens = [];
    cacheAt = now;
    return [];
  }
}

export function invalidateEsignTokenCache(): void {
  cachedWindowsTokens = null;
  cacheAt = 0;
}

/** Whether e-imza should be advertised to the panel. */
export async function esignCapabilityPresent(): Promise<boolean> {
  const lib = discoverPkcs11Lib();
  if (lib && existsSync(lib)) return true;
  if (process.platform === 'win32') {
    const tokens = await listWindowsEsignTokens();
    return tokens.length > 0;
  }
  return false;
}

/** Sync check for DriverHost.isAvailable (uses cache + PKCS#11 path). */
export function esignCapabilityPresentSync(): boolean {
  const lib = discoverPkcs11Lib();
  if (lib && existsSync(lib)) return true;
  if (cachedWindowsTokens && cachedWindowsTokens.length > 0) return true;
  // Windows: always advertise — token enumeration runs at startup and on list.
  if (process.platform === 'win32') return true;
  return false;
}

/** Warm token cache at agent startup (Windows). */
export async function warmEsignDetection(): Promise<void> {
  ensureEsignConfigured();
  if (process.platform === 'win32') {
    const tokens = await listWindowsEsignTokens();
    if (tokens.length > 0) {
      logLine('info', `E-imza: ${tokens.length} nitelikli sertifika algılandı (Windows).`);
    }
  }
}

/** Resolve install-adjacent native module path (compiled binary layout). */
export function pkcs11NativePath(): string | null {
  const base = join(process.execPath, '..');
  const candidates = [
    join(base, 'pkcs11.node'),
    join(base, 'native', 'pkcs11.node'),
    join(base, 'node_modules', 'pkcs11js', 'build', 'Release', 'pkcs11.node'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
