import { describe, expect, test } from 'bun:test';

import { buildAddRospecBody, decodeLlrpMessage, encodeLlrpMessage, parseTagReport } from './llrp';

describe('llrp', () => {
  test('encodeLlrpMessage packs version+type+length+msgid', () => {
    const f = encodeLlrpMessage(20, 42, new Uint8Array([1, 2, 3]));
    expect(f.byteLength).toBe(13); // 10 header + 3 body
    const view = new DataView(f.buffer);
    const head = view.getUint16(0);
    expect((head >> 10) & 0x07).toBe(1); // version
    expect(head & 0x3ff).toBe(20); // type
    expect(view.getUint32(2)).toBe(13); // length
    expect(view.getUint32(6)).toBe(42); // message id
  });

  test('decodeLlrpMessage round-trips', () => {
    const body = buildAddRospecBody(123);
    const f = encodeLlrpMessage(20, 7, body);
    const m = decodeLlrpMessage(f);
    expect(m).not.toBeNull();
    if (m) {
      expect(m.type).toBe(20);
      expect(m.messageId).toBe(7);
      expect(m.data.byteLength).toBe(body.byteLength);
    }
  });

  test('decodeLlrpMessage returns null on short buffer', () => {
    expect(decodeLlrpMessage(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test('parseTagReport extracts EPC hex strings', () => {
    const data = new Uint8Array(Array.from({ length: 12 }, (_, i) => i));
    const tags = parseTagReport(data);
    expect(tags.length).toBeGreaterThanOrEqual(1);
    expect(tags[0]).toMatch(/^[0-9a-f]{24}$/);
  });
});
