import { describe, expect, test } from 'bun:test';

import { poleClear, poleFrame, poleMoveTo, poleWrite } from './pole-display';

describe('pole-display', () => {
  test('poleClear emits ESC sequence', () => {
    const b = poleClear();
    expect(b[0]).toBe(0x1b);
    expect(b.byteLength).toBeGreaterThan(2);
  });

  test('poleWrite pads to width 20', () => {
    const b = poleWrite('Merhaba');
    expect(b.byteLength).toBe(20);
    const s = new TextDecoder().decode(b);
    expect(s.startsWith('Merhaba')).toBe(true);
    expect(s.length).toBe(20);
  });

  test('poleWrite truncates overflow', () => {
    const b = poleWrite('A'.repeat(30));
    expect(b.byteLength).toBe(20);
  });

  test('poleFrame combines clear + 2 lines', () => {
    const b = poleFrame('TOPLAM', '250,00 TL');
    expect(b.byteLength).toBeGreaterThan(40);
    const s = new TextDecoder().decode(b);
    expect(s).toContain('TOPLAM');
    expect(s).toContain('250,00 TL');
  });

  test('poleMoveTo clamps column to 1-20', () => {
    const b = poleMoveTo(2, 50);
    expect(b[b.byteLength - 1]).toBe(20);
  });
});
