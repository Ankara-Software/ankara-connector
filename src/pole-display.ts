// Pole display (customer-facing LCD, 2x20) serial driver (roadmap §12).
//
// Most pole displays (Epson DM-D, Bixolon BCD-1100, Aclas) speak a simple
// ESC/POS-ish serial protocol over RS232/USB-CDC: clear, move cursor, write.
// This module builds the command bytes; the agent sends them via the serial
// transport. Pure — no I/O.

const ESC = 0x1b;
const LF = 0x0a;
const CR = 0x0d;

/** Clear the display. */
export function poleClear(): Uint8Array {
  return new Uint8Array([ESC, 0x5b, 0x4a, 0x00]); // ESC [ J 0  (clear)
}

/** Home cursor to row 1, col 1. */
export function poleHome(): Uint8Array {
  return new Uint8Array([ESC, 0x5b, 0x48, 0x00]); // ESC [ H 0
}

/** Move cursor to row (1-2) and column (1-20). */
export function poleMoveTo(row: 1 | 2, col: number): Uint8Array {
  const c = Math.max(1, Math.min(20, Math.round(col)));
  // ESC [ row col  — vendor-pole move uses ESC L r c on many displays.
  return new Uint8Array([ESC, 0x4c, row, c]);
}

/** Write text at the current cursor position (padded/truncated to width). */
export function poleWrite(text: string, width = 20): Uint8Array {
  const cleaned = text.replace(/[\r\n]/g, '').slice(0, width);
  const padded = cleaned.padEnd(width, ' ');
  return new TextEncoder().encode(padded);
}

/** Render a two-line display frame (clear, home, line1, move row2, line2). */
export function poleFrame(line1: string, line2: string, width = 20): Uint8Array {
  const parts = [poleClear(), poleHome(), poleWrite(line1, width), poleMoveTo(2, 1), poleWrite(line2, width), new Uint8Array([CR, LF])];
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}
