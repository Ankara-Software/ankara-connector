#!/usr/bin/env bun
// Cross-platform systray build (roadmap §4) — builds the Go tray for Windows,
// macOS, and Linux from native/tray. Reuses github.com/getlantern/systray which
// supports all three OSes. Output goes to dist/.
//
// Usage:
//   bun run scripts/build-tray.ts [windows|darwin|linux]...
//   (no args = build for the current host OS)

import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '1.1.3';
const ROOT = join(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const TRAY_DIR = join(ROOT, 'native', 'tray');

const targets = process.argv.slice(2);
const goTargets: { goos: string; goarch: string; out: string; ldflags?: string }[] = [];
function add(goos: string, out: string, ldflags?: string) {
  goTargets.push({ goos, goarch: 'amd64', out, ldflags });
}
if (targets.length === 0) {
  // current host
  const host = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  add(host, host === 'windows' ? 'AnkaraYazilimConnector.exe' : `ankara-connector-tray-${VERSION}-${host}`);
} else {
  for (const t of targets) {
    if (t === 'windows') add('windows', 'AnkaraYazilimConnector.exe', '-H=windowsgui');
    else add(t, `ankara-connector-tray-${VERSION}-${t}`);
  }
}

await $`mkdir -p ${DIST}`;

let built = 0;
for (const t of goTargets) {
  const outPath = join(DIST, t.out);
  console.log(`Building tray for ${t.goos}/${t.goarch} → ${t.out}…`);
  try {
    const env = { ...process.env, CGO_ENABLED: '1', GOOS: t.goos, GOARCH: t.goarch };
    const args = ['go', 'build', '-o', outPath, '.'];
    if (t.ldflags) args.splice(2, 0, `-ldflags=${t.ldflags}`);
    const child = Bun.spawn(args, { cwd: TRAY_DIR, env, stdout: 'inherit', stderr: 'inherit' });
    const code = await child.exited;
    if (code === 0 && existsSync(outPath)) {
      built += 1;
      console.log(`  OK: ${outPath}`);
    } else {
      console.warn(`  tray build failed for ${t.goos} (exit ${code}) — systray needs CGO/GTK on Linux, Xcode on macOS.`);
    }
  } catch (e) {
    console.warn(`  tray build error for ${t.goos}:`, (e as Error).message);
  }
}

console.log(`Tray build complete: ${built}/${goTargets.length} targets.`);
