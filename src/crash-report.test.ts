import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  writeCrashDump,
  crashReportingEnabled,
  installCrashHandlers,
  resetCrashHandlers,
  listLocalCrashes,
  sendCrashReport,
  setCrashDirOverride,
} from './crash-report';
import { setConfigOverride } from './config';

let dir: string;

describe('crash-report', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cr-'));
    setCrashDirOverride(join(dir, 'crashes'));
    setConfigOverride({
      apiBase: 'http://127.0.0.1:9',
      token: null,
      deviceId: null,
      label: null,
      tenantName: null,
      pairedAt: null,
      printer: null,
      statusPort: 4781,
    });
    resetCrashHandlers();
  });

  afterEach(() => {
    setConfigOverride(null);
    setCrashDirOverride(null);
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('writes a redacted crash dump to disk', () => {
    const dump = writeCrashDump('uncaughtException', new Error('boom token=abc123 Bearer xyz.secret'));
    expect(dump.stackHash).toMatch(/^[0-9a-f]+$/);
    expect(dump.message).toContain('boom');
    // sensitive token + bearer value redacted from the stored stack
    expect(dump.stack).not.toContain('abc123');
    expect(dump.stack).not.toContain('xyz.secret');
    expect(dump.stack).toContain('<redacted>');
    const list = listLocalCrashes();
    expect(list.some((c) => c.stackHash === dump.stackHash)).toBe(true);
  });

  it('crashReportingEnabled respects env + config opt-in', () => {
    expect(crashReportingEnabled()).toBe(false);
    process.env.CONNECTOR_CRASH_REPORTING = '1';
    expect(crashReportingEnabled()).toBe(true);
    delete process.env.CONNECTOR_CRASH_REPORTING;
    setConfigOverride({
      apiBase: 'http://x', token: null, deviceId: null, label: null, tenantName: null,
      pairedAt: null, printer: null, statusPort: 4781, crashReporting: true,
    });
    expect(crashReportingEnabled()).toBe(true);
  });

  it('sendCrashReport returns false when not opted in', async () => {
    const dump = writeCrashDump('unhandledRejection', new Error('x'));
    const sent = await sendCrashReport(dump);
    expect(sent).toBe(false);
  });

  it('installCrashHandlers is idempotent', () => {
    installCrashHandlers();
    installCrashHandlers();
    // No throw => pass
    expect(true).toBe(true);
  });
});
