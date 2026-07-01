import { describe, expect, test } from 'bun:test';

import { renderEpl, renderLabel, renderTspl, renderZpl } from './label';

const spec = {
  width: 800,
  height: 600,
  copies: 2,
  fields: [
    { kind: 'text' as const, x: 20, y: 20, text: 'Ankara', h: 40 },
    { kind: 'barcode' as const, x: 20, y: 80, text: '123456', symbology: 'code128' as const, h: 100 },
    { kind: 'qrcode' as const, x: 20, y: 220, text: 'https://ankarayazilim.org' },
    { kind: 'box' as const, x: 20, y: 400, w: 300, h: 120 },
  ],
};

describe('label engine', () => {
  test('zpl renders header + fields + end', () => {
    const z = renderZpl(spec);
    expect(z.startsWith('^XA')).toBe(true);
    expect(z).toContain('^FDAnkara^FS');
    expect(z).toContain('^BCN,100');
    expect(z).toContain('^BQN,2,');
    expect(z).toContain('^GB300,120,2,B');
    expect(z.endsWith('^XZ')).toBe(true);
  });

  test('epl renders clear + fields + print count', () => {
    const e = renderEpl(spec);
    expect(e.startsWith('N')).toBe(true);
    expect(e).toContain('A20,20,');
    expect(e).toContain('B20,80,0,1,100,100,2,N,"123456"');
    expect(e).toContain('P2,1');
  });

  test('tspl renders size + cls + print', () => {
    const t = renderTspl(spec);
    expect(t.startsWith('SIZE ')).toBe(true);
    expect(t).toContain('CLS');
    expect(t).toContain('BARCODE 20,80,"CODE128",100,123456');
    expect(t).toContain('PRINT 2,1');
  });

  test('renderLabel returns bytes per dialect', () => {
    const z = renderLabel(spec, 'zpl');
    const e = renderLabel(spec, 'epl');
    const t = renderLabel(spec, 'tspl');
    expect(z.byteLength).toBeGreaterThan(20);
    expect(e.byteLength).toBeGreaterThan(20);
    expect(t.byteLength).toBeGreaterThan(20);
    expect(new TextDecoder().decode(z)).toContain('^XA');
  });
});
