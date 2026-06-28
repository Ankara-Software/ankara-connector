import { describe, expect, test } from 'bun:test';

import { encodeDrawerKick, encodeJob } from './escpos';

describe('encodeDrawerKick', () => {
  test('emits ESC p pin t1 t2 sequence', () => {
    const bytes = encodeDrawerKick(1, 50, 50);
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x70);
    expect(bytes[2]).toBe(1);
    expect(bytes.length).toBe(5);
  });
});

describe('encodeJob', () => {
  test('includes init and cut for a minimal receipt', () => {
    const bytes = encodeJob({ lines: [{ text: 'Test' }], cut: true });
    expect(bytes.byteLength).toBeGreaterThan(10);
    expect(bytes.includes(0x1b)).toBe(true);
  });
});
