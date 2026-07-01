import { describe, expect, test } from 'bun:test';

import { decodeWiegand26, decodeWiegand34, wiegandPayload } from './wiegand';

describe('wiegand', () => {
  test('decodeWiegand26 extracts facility + card', () => {
    // Facility 0x07 (7), card 0x1234 (4660): packed as 0x07_12_34 in top 24 bits.
    const buf = new Uint8Array([0x07, 0x12, 0x34, 0x00]);
    const c = decodeWiegand26(buf);
    expect(c.format).toBe(26);
    expect(c.facilityCode).toBe(7);
    expect(c.cardNumber).toBe(0x1234);
    expect(c.valid).toBe(true);
  });

  test('decodeWiegand34 extracts facility + card', () => {
    const buf = new Uint8Array([0x00, 0x07, 0x12, 0x34, 0x00]);
    const c = decodeWiegand34(buf);
    expect(c.format).toBe(34);
    expect(c.valid).toBe(true);
    expect(c.cardNumber).toBeGreaterThan(0);
  });

  test('wiegandPayload formats canonical payload', () => {
    const p = wiegandPayload({ format: 26, facilityCode: 7, cardNumber: 4660, valid: true });
    expect(p.format).toBe('wiegand-26');
    expect(p.raw).toBe('7:4660');
  });

  test('short buffer returns invalid', () => {
    expect(decodeWiegand26(new Uint8Array([1, 2])).valid).toBe(false);
  });
});
