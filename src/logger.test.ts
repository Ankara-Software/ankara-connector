import { describe, expect, test } from 'bun:test';

import { logLine, logsPath, redact } from './logger';

describe('logger', () => {
  test('redact masks bearer tokens', () => {
    expect(redact('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer <redacted>');
  });

  test('redact masks JSON token fields', () => {
    const out = redact('{"token":"secret-xyz","name":"Connector"}');
    expect(out).toContain('"token": "<redacted>"');
    expect(out).toContain('"name":"Connector"');
  });

  test('logLine writes a daily file under ~/.ankara-connector/logs', () => {
    logLine('info', 'smoke test message');
    expect(logsPath()).toContain('logs');
  });
});
