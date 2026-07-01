import { describe, expect, test } from 'bun:test';

import { PlateDeduper, normalizePlate, parseTurkishPlate } from './alpr';

describe('alpr', () => {
  test('normalizePlate strips non-alnum + uppercases + turcifies', () => {
    expect(normalizePlate(' 06 abc-123 ')).toBe('06ABC123');
    expect(normalizePlate('çğüöşü')).toBe('CGUOSU');
  });

  test('parseTurkishPlate parses a valid plate', () => {
    const p = parseTurkishPlate('06 ABC 1234');
    expect(p.valid).toBe(true);
    expect(p.cityCode).toBe('06');
    expect(p.letters).toBe('ABC');
    expect(p.number).toBe('1234');
    expect(p.plate).toBe('06 ABC 1234');
  });

  test('parseTurkishPlate rejects garbage', () => {
    const p = parseTurkishPlate('hello world');
    expect(p.valid).toBe(false);
  });

  test('PlateDeduer suppresses repeats within window', () => {
    const d = new PlateDeduper(1000);
    expect(d.accept('06 ABC 1234', 0)).toBe(true);
    expect(d.accept('06 ABC 1234', 500)).toBe(false);
    expect(d.accept('06 ABC 1234', 1500)).toBe(true); // 1500 - 500 = 1000 >= window
  });
});
