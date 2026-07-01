import { describe, expect, test } from 'bun:test';

import { defaultConfig } from './config';
import { buildHeartbeat } from './heartbeat';

describe('heartbeat', () => {
  test('buildHeartbeat is null when unpaired', () => {
    expect(buildHeartbeat(defaultConfig())).toBeNull();
  });

  test('buildHeartbeat includes device + version + capabilities', () => {
    const cfg = { ...defaultConfig(), token: 't', deviceId: 'dev-1' };
    const p = buildHeartbeat(cfg);
    expect(p).not.toBeNull();
    if (p) {
      expect(p.deviceId).toBe('dev-1');
      expect(p.capabilities).toContain('scanner.barcode');
      expect(p.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
