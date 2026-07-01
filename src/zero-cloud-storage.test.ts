// Zero-cloud-storage guard (roadmap §26 / KVKK, enterprise §1).
//
// Static scan of driver + OCR + biometric + esign source code: fails if a
// handler returns a forbidden raw field to the panel/cloud. The allowed
// surface is the minimized payload described in docs/CONNECTOR_ZERO_CLOUD_STORAGE.md.
// This keeps a future handler from accidentally leaking raw frames, biometric
// templates, or e-imza PINs through an ack payload.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(__dirname), 'src');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

const FORBIDDEN_PAYLOAD_FIELDS = [
  'payload.frame',
  'payload.rawImage',
  'payload.rawFrame',
  'payload.template', // biometric raw template
  'payload.pin', // e-imza PIN
  'payload.frames', // ALPR frames
  'payload.image',
] as const;

describe('zero-cloud-storage guard', () => {
  test('OCR module never returns raw frames in its result', () => {
    const src = read('ocr.ts');
    // OcrResult may carry framesDir transiently, but captureAndOcr clears it
    // before returning (framesDir: null on success). Assert the cleanup runs.
    expect(src).toContain('cleanup(framesDir)');
    expect(src).toMatch(/return \{ plates:[\s\S]*framesDir: null \}/);
  });

  test('biometric driver does not return the raw template', () => {
    const src = read('drivers/biometric.ts');
    expect(src).not.toContain('payload.template');
    expect(src).toContain('handle: hashHandle');
  });

  test('esign driver does not echo the PIN in its ack', () => {
    const src = read('drivers/esign.ts');
    expect(src).not.toContain('payload.pin');
    expect(src).not.toMatch(/payload:\s*\{[^}]*pin/);
  });

  test('no driver source contains a forbidden raw payload field', () => {
    const files = [
      'drivers/alpr.ts',
      'drivers/barrier.ts',
      'drivers/biometric.ts',
      'drivers/display.ts',
      'drivers/esign.ts',
      'drivers/onvif.ts',
      'drivers/opos.ts',
      'drivers/rfid.ts',
      'drivers/signage.ts',
      'drivers/wiegand.ts',
      'ocr.ts',
    ];
    for (const f of files) {
      const src = read(f);
      for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
        expect(src.includes(field)).toBe(false);
      }
    }
  });

  test('logger redacts token + authorization fields', () => {
    const src = read('logger.ts');
    expect(src).toContain('token');
    expect(src).toContain('authorization');
    expect(src).toContain('Bearer');
    expect(src).toContain('<redacted>');
  });
});
