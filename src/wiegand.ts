// Wiegand RFID gate protocol decoder (roadmap §rfid.gate).
//
// Decodes Wiegand 26-bit and 34-bit card data frames (the standard format for
// access-control readers). 26-bit: facility code (8) + card number (16) + 2
// parity bits. 34-bit: facility (8..16) + card (16..24) + parity. Pure decoder
// — the agent reads the data lines from a USB/Wiegand converter.

export interface WiegandCard {
  format: 26 | 34;
  facilityCode: number;
  cardNumber: number;
  valid: boolean;
}

/** Decode a 26-bit Wiegand frame. Layout: facility code (1 byte) + card
 *  number (2 bytes) + 2 parity bits packed around them. We surface the
 *  facility/card fields; full parity validation runs server-side. */
export function decodeWiegand26(bits: Uint8Array): WiegandCard {
  if (bits.byteLength < 3) return { format: 26, facilityCode: 0, cardNumber: 0, valid: false };
  const facility = bits[0]! & 0xff;
  const card = ((bits[1]! & 0xff) << 8) | (bits[2]! & 0xff);
  return { format: 26, facilityCode: facility, cardNumber: card, valid: true };
}

/** Decode a 34-bit Wiegand frame. */
export function decodeWiegand34(bits: Uint8Array): WiegandCard {
  if (bits.byteLength < 5) return { format: 34, facilityCode: 0, cardNumber: 0, valid: false };
  const facility = ((bits[0]! & 0xff) << 6) | ((bits[1]! & 0xff) >> 2);
  const card = (((bits[1]! & 0x03) << 16) | ((bits[2]! & 0xff) << 8) | (bits[3]! & 0xff));
  return { format: 34, facilityCode: facility, cardNumber: card, valid: true };
}

/** Format a decoded card as the canonical wire payload. */
export function wiegandPayload(card: WiegandCard): { format: string; facilityCode: number; cardNumber: number; raw: string } {
  return {
    format: `wiegand-${card.format}`,
    facilityCode: card.facilityCode,
    cardNumber: card.cardNumber,
    raw: `${card.facilityCode}:${card.cardNumber}`,
  };
}
