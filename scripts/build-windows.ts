// Windows release v2: single Rust binary + NSIS installer.

import { $ } from 'bun';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rcedit } from 'rcedit';

const VERSION = '2.0.1';
const ROOT = join(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const ICO = join(ROOT, 'windows', 'assets', 'ankara-yazilim.ico');
const APP_EXE = 'AnkaraConnector.exe';
const SETUP_OUT = `AnkaraConnector-Setup-${VERSION}.exe`;
const LEGACY_OUT = `AnkaraConnector-${VERSION}-windows-x64.exe`;

const versionInfo = {
  'file-version': `${VERSION}.0`,
  'product-version': `${VERSION}.0`,
  'version-string': {
    FileDescription: 'Ankara Yazılım Connector',
    ProductName: 'Ankara Yazılım Connector',
    CompanyName: 'Ankara Yazılım',
    LegalCopyright: 'Copyright © Ankara Yazılım',
    OriginalFilename: APP_EXE,
  },
  icon: ICO,
};

await $`bun run scripts/prepare-windows-assets.ts`;
await $`mkdir -p ${DIST}`;

console.log('Building Connector v2 (Rust)…');
await $`bun run scripts/build-rust-windows.ts`;

const appPath = join(DIST, APP_EXE);
if (!existsSync(appPath)) {
  throw new Error(`${APP_EXE} missing after Rust build`);
}

await rcedit(appPath, versionInfo);
copyFileSync(appPath, join(DIST, LEGACY_OUT));
await rcedit(join(DIST, LEGACY_OUT), versionInfo);

if (which('makensis')) {
  console.log('Building NSIS installer…');
  await $`makensis /INPUTCHARSET UTF8 /V2 connector.nsi`.cwd(join(ROOT, 'windows', 'installer'));
} else {
  console.warn('makensis not found — skipping installer.');
}

async function signWindowsBinaries(): Promise<void> {
  const pfx = process.env.CONNECTOR_AUTHENTICODE_PFX;
  if (!pfx || !existsSync(pfx)) {
    console.log('Authenticode: CONNECTOR_AUTHENTICODE_PFX not set — skipping signing.');
    return;
  }
  const pwd = process.env.CONNECTOR_AUTHENTICODE_PWD ?? '';
  const ts = process.env.CONNECTOR_AUTHENTICODE_TS ?? 'http://timestamp.digicert.com';
  if (!which('signtool')) {
    console.warn('Authenticode: signtool not found — skipping signing.');
    return;
  }
  for (const name of [APP_EXE, SETUP_OUT, LEGACY_OUT]) {
    const p = join(DIST, name);
    if (!existsSync(p)) continue;
    try {
      await $`signtool sign /f ${pfx} /p ${pwd} /tr ${ts} /td sha256 /fd sha256 ${p}`.quiet();
      console.log(`Authenticode signed: ${name}`);
    } catch (e) {
      console.warn(`Authenticode sign failed for ${name}:`, (e as Error).message);
    }
  }
}

await signWindowsBinaries();
console.log('Windows v2 build complete in dist/');

function which(cmd: string): boolean {
  try {
    Bun.spawnSync({ cmd: ['where', cmd], stdout: 'ignore', stderr: 'ignore' });
    return true;
  } catch {
    try {
      Bun.spawnSync({ cmd: ['which', cmd], stdout: 'ignore', stderr: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
