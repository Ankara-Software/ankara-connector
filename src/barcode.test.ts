import { describe, expect, test } from 'bun:test';

import { parseBarcode } from './barcode';

describe('parseBarcode', () => {
  test('strips AIM prefix and trailing CR/LF', () => {
    const r = parseBarcode(']C1HELLO\r\n');
    expect(r.code).toBe('HELLO');
    expect(r.symbology).toBe('code128');
    expect(r.rawLength).toBeGreaterThan(r.code.length);
  });

  test('detects EAN-13', () => {
    const r = parseBarcode('8691234567890');
    expect(r.symbology).toBe('ean13');
    expect(r.gs1).toBe(false);
  });

  test('detects EAN-8', () => {
    const r = parseBarcode('12345670');
    expect(r.symbology).toBe('ean8');
  });

  test('parses GS1 FNC1-first with AI 01 + AI 21', () => {
    const gs = String.fromCharCode(0x1d);
    const raw = String.fromCharCode(0x1d) + '0108691234567897' + gs + '21SERIAL123';
    const r = parseBarcode(raw);
    expect(r.gs1).toBe(true);
    expect(r.symbology).toBe('gs1-datatray');
    expect(r.fields['01']).toBe('08691234567897');
    expect(r.fields['21']).toBe('SERIAL123');
  });

  test('handles raw Uint8Array with NUL padding', () => {
    const bytes = new Uint8Array([0x41, 0x42, 0x43, 0x00, 0x00]);
    const r = parseBarcode(bytes);
    expect(r.code).toBe('ABC');
  });
});
