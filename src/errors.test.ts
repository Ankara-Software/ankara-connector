import { describe, it, expect } from 'bun:test';

import { ERROR_ENCYCLOPEDIA, describeError, customerError } from './errors';

describe('error encyclopedia (Phase 7)', () => {
  it('covers every newly-wired module', () => {
    const required = [
      'driver_module_missing',
      'transport_offline',
      'serial_error',
      'usb_error',
      'barrier_error',
      'rfid_error',
      'camera_error',
      'ocr_error',
      'esign_error',
      'biometric_error',
      'signage_error',
      'display_error',
      'wiegand_error',
      'discovery_error',
      'offline_buffer_error',
    ];
    for (const code of required) {
      expect(ERROR_ENCYCLOPEDIA[code]).toBeDefined();
      const e = ERROR_ENCYCLOPEDIA[code];
      expect(e.code).toMatch(/^E\d{2}$/);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.hint.length).toBeGreaterThan(0);
    }
  });

  it('wiegand + discovery + offline_buffer have distinct codes', () => {
    const codes = [
      ERROR_ENCYCLOPEDIA.wiegand_error.code,
      ERROR_ENCYCLOPEDIA.discovery_error.code,
      ERROR_ENCYCLOPEDIA.offline_buffer_error.code,
    ];
    expect(new Set(codes).size).toBe(3);
  });

  it('describeError falls back to E99 for unknown codes', () => {
    expect(describeError('nope').code).toBe('E99');
  });

  it('customerError formats a customer-facing message', () => {
    const e = customerError('printer_paper_out');
    expect(e.code).toBe('E05');
    expect(e.message).toContain('E05');
    expect(e.message).toContain('kağıd');
  });
});
