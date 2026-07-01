import { describe, expect, test } from 'bun:test';

import { encodeSignageFrame, verifySignageFrame } from './signage';

describe('signage', () => {
  test('encodeSignageFrame wraps text with STX/ETX + checksum', () => {
    const f = encodeSignageFrame({ screen: 1, mode: 1, speed: 5, dwell: 10, lines: ['HOSGELDINIZ'] });
    expect(f[0]).toBe(0x02);
    expect(f[f.byteLength - 2]).toBe(0x03);
    const text = new TextDecoder().decode(f.slice(7, f.byteLength - 2));
    expect(text).toBe('HOSGELDINIZ');
  });

  test('verifySignageFrame round-trips', () => {
    const f = encodeSignageFrame({ screen: 0, mode: 0, speed: 0, dwell: 0, lines: ['A'] });
    expect(verifySignageFrame(f)).toBe(true);
  });

  test('verifySignageFrame rejects tampered frame', () => {
    const f = encodeSignageFrame({ screen: 0, mode: 0, speed: 0, dwell: 0, lines: ['A'] });
    f[f.byteLength - 1] ^= 0xff;
    expect(verifySignageFrame(f)).toBe(false);
  });
});
