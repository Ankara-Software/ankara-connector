#!/usr/bin/env bun
// Linux release build (roadmap §2, §5) — agent core + .deb + .rpm packages
// with systemd integration, reusing scripts/install-daemon.sh as postinst/
// postrm hooks. Builds via dpkg-deb (always) and fpm or rpmbuild (when present).
//
// Run on Linux (or any host with dpkg-deb/fpm available).

import { $ } from 'bun';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '1.1.5';
const ROOT = join(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const CORE_OUT = `ankara-connector-core-${VERSION}-linux`;
const DEB_OUT = `ankara-connector_${VERSION}_amd64.deb`;
const RPM_OUT = `ankara-connector-${VERSION}.x86_64.rpm`;

await $`mkdir -p ${DIST}`;

console.log('Building headless agent core (linux)…');
await $`bun build src/index.ts --compile --minify --target bun-linux-x64 --outfile ${join(DIST, CORE_OUT)}`;

// ---- .deb ------------------------------------------------------------------
const DEB_STAGE = join(DIST, 'deb-stage');
const DEB_APP = join(DEB_STAGE, 'usr', 'lib', 'ankara-connector');
const DEB_BIN = join(DEB_STAGE, 'usr', 'bin');
const DEB_SYSVD = join(DEB_STAGE, 'etc', 'systemd', 'system');
const DEB_CTRL = join(DEB_STAGE, 'DEBIAN');
mkdirSync(DEB_APP, { recursive: true });
mkdirSync(DEB_BIN, { recursive: true });
mkdirSync(DEB_SYSVD, { recursive: true });
mkdirSync(DEB_CTRL, { recursive: true });

copyFileSync(join(DIST, CORE_OUT), join(DEB_APP, 'ankara-connector-core'));
copyFileSync(join(ROOT, 'scripts', 'install-daemon.sh'), join(DEB_APP, 'install-daemon.sh'));
chmodSync(join(DEB_APP, 'ankara-connector-core'), 0o755);
chmodSync(join(DEB_APP, 'install-daemon.sh'), 0o755);

// systemd unit (user-independent, runs at boot)
writeFileSync(
  join(DEB_SYSVD, 'ankara-connector.service'),
  `[Unit]
Description=Ankara Yazılım Connector
After=network-online.target

[Service]
ExecStart=/usr/lib/ankara-connector/ankara-connector-core run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`,
);

writeFileSync(join(DEB_CTRL, 'control'),
  `Package: ankara-connector
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Ankara Yazılım <dev@ankarayazilim.org>
Description: Ankara Yazılım Connector
 Bridge between physical hardware (printers, barriers, RFID, cameras) and the
 Ankara Yazılım web panel. Runs as a systemd service.
`);
writeFileSync(join(DEB_CTRL, 'postinst'),
  `#!/bin/sh
ln -sf /usr/lib/ankara-connector/ankara-connector-core /usr/bin/ankara-connector
systemctl daemon-reload >/dev/null 2>&1 || true
systemctl enable ankara-connector.service >/dev/null 2>&1 || true
systemctl start ankara-connector.service >/dev/null 2>&1 || true
`);
writeFileSync(join(DEB_CTRL, 'postrm'),
  `#!/bin/sh
systemctl stop ankara-connector.service >/dev/null 2>&1 || true
systemctl disable ankara-connector.service >/dev/null 2>&1 || true
rm -f /usr/bin/ankara-connector
`);
chmodSync(join(DEB_CTRL, 'postinst'), 0o755);
chmodSync(join(DEB_CTRL, 'postrm'), 0o755);

console.log('Building .deb…');
try {
  await $`dpkg-deb --build --root-owner-group ${DEB_STAGE} ${join(DIST, DEB_OUT)}`;
  console.log(`DEB: ${join(DIST, DEB_OUT)}`);
} catch (e) {
  console.warn('dpkg-deb failed (need dpkg-deb):', (e as Error).message);
}

// ---- .rpm (via fpm if present) --------------------------------------------
function has(cmd: string): boolean {
  try { Bun.spawnSync({ cmd: ['which', cmd], stdout: 'ignore', stderr: 'ignore' }); return true; } catch { return false; }
}

if (has('fpm')) {
  console.log('Building .rpm via fpm…');
  try {
    await $`fpm -s dir -t rpm -n ankara-connector -v ${VERSION} --architecture x86_64
      --maintainer "Ankara Yazılım <dev@ankarayazilim.org>"
      --description "Ankara Yazılım Connector"
      --url https://ankarayazilim.org
      --after-install ${join(DEB_CTRL, 'postinst')}
      --before-remove ${join(DEB_CTRL, 'postrm')}
      ${join(DEB_APP, 'ankara-connector-core')}=/usr/lib/ankara-connector/ankara-connector-core
      ${join(DEB_SYSVD, 'ankara-connector.service')}=/etc/systemd/system/ankara-connector.service
      -p ${join(DIST, RPM_OUT)}`;
    console.log(`RPM: ${join(DIST, RPM_OUT)}`);
  } catch (e) {
    console.warn('fpm rpm build failed:', (e as Error).message);
  }
} else if (has('rpmbuild')) {
  console.warn('rpmbuild present but a spec template is needed; using fpm is preferred. Skipping rpm.');
} else {
  console.warn('Neither fpm nor rpmbuild found — skipping .rpm. Install fpm (`gem install fpm`) to build rpm.');
}

try { rmSync(DEB_STAGE, { recursive: true, force: true }); } catch {}
void existsSync;
console.log('Linux build complete in dist/.');
