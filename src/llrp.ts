// LLRP UHF RFID reader protocol (roadmap §15).
//
// Builds LLRP (Low Level Reader Protocol) message frames for the common
// commands: SET_READER_CONFIG, ADD_ROSPEC, ENABLE_ROSPEC, ENABLE_EVENTS.
// LLRP uses a 10-byte message header (version, type, length, message id)
// followed by a parameter/field body. Pure binary builder + decoder.

export type LlrpMessageType =
  | 1 // SET_READER_CONFIG
  | 20 // ADD_ROSPEC
  | 24 // ENABLE_ROSPEC
  | 63; // KEEPALIVE

export interface LlrpMessage {
  version: number;
  type: LlrpMessageType;
  messageId: number;
  data: Uint8Array;
}

const LLRP_VERSION = 1;

/** Build an LLRP message frame from a typed body. */
export function encodeLlrpMessage(type: LlrpMessageType, messageId: number, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  const total = 10 + body.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  // First 2 bytes: version (3 bits) + type (10 bits) + reserved (1 bit) ...
  // LLRP packs version<<10 | type into the first 16 bits (big-endian).
  view.setUint16(0, (LLRP_VERSION << 10) | (type & 0x3ff));
  view.setUint32(2, total); // message length
  view.setUint32(6, messageId); // message id
  out.set(body, 10);
  return out;
}

/** Parse an LLRP message frame (or null when too short). */
export function decodeLlrpMessage(buf: Uint8Array): LlrpMessage | null {
  if (buf.byteLength < 10) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const head = view.getUint16(0);
  const version = (head >> 10) & 0x07;
  const type = head & 0x3ff;
  const length = view.getUint32(2);
  const messageId = view.getUint32(6);
  if (buf.byteLength < length) return null;
  return { version, type: type as LlrpMessageType, messageId, data: buf.slice(10, length) };
}

/** Build a minimal ADD_ROSPEC body for inventory (antenna 1, EPC C1G2). */
export function buildAddRospecBody(rospecId: number): Uint8Array {
  // Simplified ROSpec: ROSpecID + state (disabled) + start trigger + stop trigger.
  const body = new Uint8Array(20);
  const view = new DataView(body.buffer);
  view.setUint32(0, rospecId); // ROSpecID
  view.setUint16(4, 1); // ROSpec state: Disabled
  view.setUint16(6, 0); // Start trigger: Null
  view.setUint16(8, 1); // Stop trigger: Duration
  view.setUint32(10, 10_000); // 10s inventory
  view.setUint16(14, 1); // Antenna count
  view.setUint16(16, 1); // Antenna id 1
  return body;
}

/** Parse a tag report (RO_ACCESS_REPORT) — extracts EPC hex strings. */
export function parseTagReport(data: Uint8Array): string[] {
  const tags: string[] = [];
  // Each EPC-96 tag is 12 bytes (24 hex chars). Scan in 12-byte strides.
  for (let i = 0; i + 12 <= data.byteLength; i += 12) {
    const tag = Array.from(data.slice(i, i + 12))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (/^[0-9a-f]{24}$/.test(tag) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}
