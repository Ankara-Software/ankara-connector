// Windows release: agent core + systray host + NSIS installer + PE version resources.

import { $ } from 'bun';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rcedit } from 'rcedit';

const VERSION = '1.1.1';
const ROOT = join(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const ASSETS = join(ROOT, 'windows', 'assets');
const ICO = join(ASSETS, 'ankara-yazilim.ico');
const TRAY_DIR = join(ROOT, 'windows', 'tray');

const CORE_OUT = `ankara-connector-core-${VERSION}-windows-x64.exe`;
const TRAY_OUT = 'AnkaraYazilimConnector.exe';
const SETUP_OUT = `AnkaraConnector-Setup-${VERSION}.exe`;
const LEGACY_OUT = `ankara-connector-${VERSION}-windows-x64.exe`;

const versionInfo = {
  'file-version': `${VERSION}.0`,
  'product-version': `${VERSION}.0`,
  'version-string': {
    FileDescription: 'Ankara Yazılım Connector',
    ProductName: 'Ankara Yazılım Connector',
    CompanyName: 'Ankara Yazılım',
    LegalCopyright: 'Copyright © Ankara Yazılım',
    OriginalFilename: 'AnkaraYazilimConnector.exe',
  },
  icon: ICO,
};

await $`bun run scripts/prepare-windows-assets.ts`;
await $`mkdir -p ${DIST}`;

console.log('Building headless agent core…');
await $`bun build src/index.ts --compile --minify --target bun-windows-x64 --outfile ${join(DIST, CORE_OUT)}`;

await rcedit(join(DIST, CORE_OUT), {
  ...versionInfo,
  'version-string': { ...versionInfo['version-string'], OriginalFilename: 'ankara-connector-core.exe' },
});

copyFileSync(join(DIST, CORE_OUT), join(DIST, 'ankara-connector-core.exe'));
copyFileSync(ICO, join(DIST, 'ankara-yazilim.ico'));
copyFileSync(join(TRAY_DIR, 'AnkaraYazilimConnector.ps1'), join(DIST, 'AnkaraYazilimConnector.ps1'));

console.log('Building systray host…');
const trayExe = join(DIST, TRAY_OUT);
let trayBuilt = false;

if (process.platform === 'win32' && which('go')) {
  try {
    copyFileSync(ICO, join(TRAY_DIR, 'ankara-yazilim.ico'));
    Bun.spawnSync({ cmd: ['go', 'mod', 'tidy'], cwd: TRAY_DIR, stdout: 'ignore', stderr: 'inherit' });
    const build = Bun.spawn(['go', 'build', '-ldflags=-H=windowsgui', '-o', trayExe, '.'], {
      cwd: TRAY_DIR,
      env: { ...process.env, CGO_ENABLED: '1' },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    trayBuilt = (await build.exited) === 0 && existsSync(trayExe);
  } catch (e) {
    console.warn('Go tray build failed:', (e as Error).message);
  }
}

if (!trayBuilt && process.platform === 'win32') {
  console.warn('Go/CGO tray build unavailable — dev fallback: AnkaraYazilimConnector.cmd + .ps1');
  await Bun.write(
    join(DIST, 'AnkaraYazilimConnector.cmd'),
    '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0AnkaraYazilimConnector.ps1"\r\n',
  );
}

if (existsSync(trayExe)) {
  await rcedit(trayExe, versionInfo);
}

if (which('makensis')) {
  console.log('Building NSIS installer…');
  try {
    await $`makensis /V2 connector.nsi`.cwd(join(ROOT, 'windows', 'installer'));
  } catch (e) {
    console.warn('NSIS build failed:', (e as Error).message);
  }
} else {
  console.warn('makensis not found — skipping installer.');
}

if (existsSync(trayExe)) {
  copyFileSync(trayExe, join(DIST, LEGACY_OUT));
  await rcedit(join(DIST, LEGACY_OUT), versionInfo);
} else {
  copyFileSync(join(DIST, CORE_OUT), join(DIST, LEGACY_OUT));
  await rcedit(join(DIST, LEGACY_OUT), versionInfo);
}

console.log('Windows build complete in dist/');

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
