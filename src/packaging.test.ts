import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

describe('packaging (Phase 6)', () => {
  it('cross-platform tray sources exist and are build-tagged', () => {
    const tray = join(ROOT, 'native', 'tray');
    expect(existsSync(join(tray, 'main.go'))).toBe(true);
    expect(existsSync(join(tray, 'open_windows.go'))).toBe(true);
    expect(existsSync(join(tray, 'open_unix.go'))).toBe(true);
    expect(existsSync(join(tray, 'go.mod'))).toBe(true);
    // main.go must not contain windows-only syscall imports at top level
    const main = readFileSync(join(tray, 'main.go'), 'utf8');
    expect(main).not.toContain('syscall');
    expect(main).not.toContain('user32');
    // platform hooks are referenced
    expect(main).toContain('openBrowser(');
    expect(main).toContain('showAboutDialog(');
    expect(main).toContain('applyHideWindow(');
    // build tags split correctly
    expect(readFileSync(join(tray, 'open_windows.go'), 'utf8')).toContain('//go:build windows');
    expect(readFileSync(join(tray, 'open_unix.go'), 'utf8')).toContain('//go:build !windows');
  });

  it('build scripts for macos, linux, and tray exist', () => {
    for (const f of ['build-macos.ts', 'build-linux.ts', 'build-tray.ts']) {
      expect(existsSync(join(ROOT, 'scripts', f))).toBe(true);
    }
  });

  it('macos build script has an EV/Developer ID cert swap point + notarize hook', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'build-macos.ts'), 'utf8');
    expect(src).toContain('CONNECTOR_MAC_CERT_ID');
    expect(src).toContain('CONNECTOR_NOTARIZE');
    expect(src).toContain('notarytool');
  });

  it('linux build script produces deb + rpm with systemd', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'build-linux.ts'), 'utf8');
    expect(src).toContain('dpkg-deb');
    expect(src).toContain('fpm');
    expect(src).toContain('ankara-connector.service');
    expect(src).toContain('postinst');
    expect(src).toContain('postrm');
  });

  it('windows build script has an Authenticode signing hook with env-var swap', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'build-windows.ts'), 'utf8');
    expect(src).toContain('CONNECTOR_AUTHENTICODE_PFX');
    expect(src).toContain('signtool');
  });

  it('install-daemon.sh supports --silent and --config', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'install-daemon.sh'), 'utf8');
    expect(src).toContain('--silent');
    expect(src).toContain('--config');
    expect(src).toContain('seed_config');
  });

  it('install-daemon-windows.ps1 supports -Silent and -Config', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'install-daemon-windows.ps1'), 'utf8');
    expect(src).toContain('[switch]$Silent');
    expect(src).toContain('[string]$Config');
  });

  it('CLI forwards --config to the install scripts', () => {
    const src = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
    expect(src).toContain("--config'");
    expect(src).toContain('configFile');
  });
});
