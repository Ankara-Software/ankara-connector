#!/usr/bin/env bun
// macOS release build (roadmap §2, §49) — agent core + cross-platform tray +
// .pkg installer + ad-hoc code signing with a documented Apple Developer ID
// swap point.
//
// Signing:
//   - Default: `codesign --sign -` (ad-hoc) so the binary runs locally.
//   - Real release: set CONNECTOR_MAC_CERT_ID=<Apple Developer ID Application>
//     to sign with a real cert, and set CONNECTOR_NOTARIZE=1 to submit for
//     notarization (requires CONNECTOR_APPLE_ID / CONNECTOR_APPLE_PWD /
//     CONNECTOR_TEAM_ID). The single env-var swap point is the hook a future
//     EV/Developer ID cert drops into.
//
// Run on macOS (needs Xcode + pkgbuild/productbuild).

import { $ } from 'bun';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '1.1.6';
const ROOT = join(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, 'macos-stage');

const CORE_OUT = `ankara-connector-core-${VERSION}-macos`;
const TRAY_OUT = `ankara-connector-tray-${VERSION}-darwin`;
const PKG_OUT = `AnkaraConnector-${VERSION}.pkg`;

const CERT_ID = process.env.CONNECTOR_MAC_CERT_ID || '-'; // '-' = ad-hoc
const NOTARIZE = process.env.CONNECTOR_NOTARIZE === '1';

async function sign(path: string): Promise<void> {
  console.log(`codesign (${CERT_ID === '-' ? 'ad-hoc' : CERT_ID}): ${path}`);
  await $`codesign --sign ${CERT_ID} --force --deep --options runtime ${path}`.quiet();
}

await $`mkdir -p ${DIST}`;

console.log('Building headless agent core (macos)…');
await $`bun build src/index.ts --compile --minify --target bun-darwin-x64 --outfile ${join(DIST, CORE_OUT)}`;

console.log('Building tray (macos)…');
await $`bun run scripts/build-tray.ts darwin`.quiet().catch(() => {
  console.warn('Tray build skipped (needs Xcode/CGO). Continuing with core-only pkg.');
});

// Stage the .pkg payload: /usr/local/lib/ankara-connector/*
const APP_DIR = join(STAGE, 'usr', 'local', 'lib', 'ankara-connector');
const BIN_DIR = join(STAGE, 'usr', 'local', 'bin');
mkdirSync(APP_DIR, { recursive: true });
mkdirSync(BIN_DIR, { recursive: true });

copyFileSync(join(DIST, CORE_OUT), join(APP_DIR, 'ankara-connector-core'));
if (existsSync(join(DIST, TRAY_OUT))) {
  copyFileSync(join(DIST, TRAY_OUT), join(APP_DIR, 'AnkaraYazilimConnector'));
  await sign(join(APP_DIR, 'AnkaraYazilimConnector'));
}
await sign(join(APP_DIR, 'ankara-connector-core'));

// postinstall: install LaunchAgent + symlink into /usr/local/bin
const scriptsDir = join(STAGE, 'scripts');
mkdirSync(scriptsDir, { recursive: true });
const postinstall = join(scriptsDir, 'postinstall');
await Bun.write(
  postinstall,
  `#!/bin/sh
ln -sf /usr/local/lib/ankara-connector/ankara-connector-core /usr/local/bin/ankara-connector
chmod +x /usr/local/lib/ankara-connector/ankara-connector-core
su - "$SUDO_USER" -c 'sh /usr/local/lib/ankara-connector/install-daemon.sh install-daemon' 2>/dev/null || true
`,
);
await $`chmod +x ${postinstall}`;

console.log('Building .pkg…');
const COMPONENT_PLIST = join(STAGE, 'component.plist');
await Bun.write(
  COMPONENT_PLIST,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>BundleIsVersionChecked</key><true/>
  <key>BundleOverwriteAction</key><string>upgrade</string>
  <key>BundlePostInstallScriptPath</key><string>scripts/postinstall</string>
</dict></plist>`,
);

try {
  await $`pkgbuild --root ${join(STAGE, 'usr', 'local', 'lib', 'ankara-connector')} --identifier com.ankarayazilim.connector --version ${VERSION} --scripts ${scriptsDir} --install-location /usr/local/lib/ankara-connector ${join(DIST, 'AnkaraConnector-component.pkg')}`;
  await $`productbuild --package ${join(DIST, 'AnkaraConnector-component.pkg')} ${join(DIST, PKG_OUT)}`;
  console.log(`PKG: ${join(DIST, PKG_OUT)}`);
} catch (e) {
  console.warn('pkgbuild/productbuild failed (need Xcode tools):', (e as Error).message);
}

if (NOTARIZE && CERT_ID !== '-') {
  const appleId = process.env.CONNECTOR_APPLE_ID;
  const teamId = process.env.CONNECTOR_TEAM_ID;
  const pwd = process.env.CONNECTOR_APPLE_PWD;
  if (appleId && teamId && pwd) {
    console.log('Submitting for notarization…');
    try {
      await $`xcrun notarytool submit ${join(DIST, PKG_OUT)} --apple-id ${appleId} --team-id ${teamId} --password ${pwd} --wait`;
      await $`xcrun stapler staple ${join(DIST, PKG_OUT)}`;
      console.log('Notarization + stapling complete.');
    } catch (e) {
      console.warn('Notarization failed:', (e as Error).message);
    }
  } else {
    console.warn('Notarize requested but CONNECTOR_APPLE_ID/TEAM_ID/APPLE_PWD not set.');
  }
} else if (CERT_ID === '-') {
  console.log('Ad-hoc signing used. Set CONNECTOR_MAC_CERT_ID=<Developer ID> + CONNECTOR_NOTARIZE=1 for a distributable, notarized build.');
}

// Cleanup staging.
try { rmSync(STAGE, { recursive: true, force: true }); } catch {}

console.log('macOS build complete in dist/.');
