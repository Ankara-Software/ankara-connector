// LED signage / display protocol adapter (roadmap signage.led).
//
// Common LED ticker/tabela controllers (Hero, Tas, Karo) accept a simple
// serial/IP frame: a header with screen id + mode, the text payload in a
// configurable code page, and a checksum. This module builds the frame; the
// agent sends it over TCP/serial. Pure — testable.

export interface SignageFrame {
  /** Screen id (0-255). */
  screen: number;
  /** Display mode: 0=immediate, 1=scroll-left, 2=blink, 3=snow. */
  mode: 0 | 1 | 2 | 3;
  /** Speed (0-15). */
  speed: number;
  /** dwell time in seconds (0-99). */
  dwell: number;
  /** Text lines. */
  lines: string[];
}

const STX = 0x02;
const ETX = 0x03;
const ESC = 0x1b;

/** Build a signage frame for a Hero/Tas-class LED controller. */
export function encodeSignageFrame(frame: SignageFrame): Uint8Array {
  const out: number[] = [];
  out.push(STX, ESC, 0x41); // header: STX ESC A (command)
  out.push(frame.screen & 0xff);
  out.push(frame.mode & 0xff);
  out.push(Math.max(0, Math.min(15, frame.speed)) & 0xff);
  out.push(Math.max(0, Math.min(99, frame.dwell)) & 0xff);
  const text = frame.lines.join('\n');
  const bytes = Array.from(new TextEncoder().encode(text));
  out.push(...bytes);
  out.push(ETX);
  // Simple XOR checksum over screen..text.
  let cksum = 0;
  for (let i = 2; i < out.length; i += 1) cksum ^= out[i]!;
  out.push(cksum & 0xff);
  return new Uint8Array(out);
}

/** Validate a signage frame's checksum (round-trip). */
export function verifySignageFrame(buf: Uint8Array): boolean {
  if (buf.byteLength < 4 || buf[buf.byteLength - 2] !== ETX) return false;
  let cksum = 0;
  for (let i = 2; i < buf.byteLength - 1; i += 1) cksum ^= buf[i]!;
  return cksum === buf[buf.byteLength - 1];
}
