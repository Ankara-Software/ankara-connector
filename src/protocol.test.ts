import { describe, expect, test } from 'bun:test';

import { decode, parseMessage } from './protocol';

describe('protocol decode', () => {
  test('decode parses JSON command wire string', () => {
    const wire = JSON.stringify({
      kind: 'command',
      v: 1,
      id: 'cmd-1',
      cap: 'printer.escpos',
      action: 'print',
      payload: { lines: [{ text: 'Test' }] },
    });
    const r = decode(wire);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe('command');
      if (r.value.kind === 'command') {
        expect(r.value.cap).toBe('printer.escpos');
        expect(r.value.action).toBe('print');
      }
    }
  });

  test('parseMessage rejects raw string', () => {
    const r = parseMessage('not-an-object');
    expect(r.ok).toBe(false);
  });
});
