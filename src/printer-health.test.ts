import { describe, expect, test } from 'bun:test';

import { aggregateHealth, decodeHealthByte, encodeHealthRequest, healthErrorKey } from './printer-health';

describe('printer-health', () => {
  test('encodeHealthRequest emits DLE EOT n', () => {
    const b = encodeHealthRequest('paper');
    expect(Array.from(b)).toEqual([0x10, 0x04, 2]);
  });

  test('decodeHealthByte online bit', () => {
    expect(decodeHealthByte('online', 0x12).online).toBe(true); // bit5 clear
    expect(decodeHealthByte('online', 0x36).online).toBe(false); // bit5 set
  });

  test('decodeHealthByte paper end', () => {
    expect(decodeHealthByte('paper', 0x12).paperOut).toBe(false);
    expect(decodeHealthByte('paper', 0x04).paperOut).toBe(true);
  });

  test('aggregateHealth picks worst state', () => {
    const h = aggregateHealth({ online: 0x12, paper: 0x04, error: 0x00 });
    expect(h.paperOut).toBe(true);
    expect(h.label).toBe('Kağıt bitti');
    expect(healthErrorKey(h)).toBe('printer_paper_out');
  });

  test('healthErrorKey null when healthy', () => {
    const h = aggregateHealth({ online: 0x12, paper: 0x12, error: 0x00 });
    expect(healthErrorKey(h)).toBeNull();
  });
});
