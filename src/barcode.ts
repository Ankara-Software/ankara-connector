// Barcode / QR data normalization (roadmap §8, §30).
//
// HID barcode scanners emit raw key-wedge bytes that often carry hidden
// control characters (GS1 FNC1 separators, leading AIM identifiers, NUL
// padding). Before we surface a scanned code to the panel or persist it, we
// strip noise, detect the symbology where possible, and expose any GS1
// application-identifier fields. Pure — no I/O, fully unit-testable.

export type BarcodeSymbology =
  | 'ean13'
  | 'ean8'
  | 'upc-a'
  | 'code128'
  | 'code39'
  | 'gs1-datatray'
  | 'qr'
  | 'unknown';

export interface ParsedBarcode {
  /** Clean, printable code presented to the panel. */
  code: string;
  symbology: BarcodeSymbology;
  /** True when an FNC1-in-first-position (GS1) frame was detected. */
  gs1: boolean;
  /** GS1 application-identifier → value map, when applicable. */
  fields: Record<string, string>;
  /** Raw length before normalization. */
  rawLength: number;
}

/** FNC1 / GS1 group separator as emitted by many scanners (ASCII 29). */
const GS = 0x1d;
const RS = 0x1e;
const NUL = 0x00;

/** Strip AIM-style prefix (e.g. "]C1") that some scanners prepend. */
function stripAimPrefix(s: string): string {
  if (s.charCodeAt(0) === 0x5d /* ] */ && s.length >= 3) {
    // ]<modifier><symbology-char> — drop the 3-char AIM identifier.
    return s.slice(3);
  }
  return s;
}

function isAllDigits(s: string): boolean {
  return /^\d+$/.test(s);
}

function detectSymbology(clean: string, hadFnc1: boolean): BarcodeSymbology {
  if (hadFnc1) return 'gs1-datatray';
  if (/^\d{13}$/.test(clean)) return 'ean13';
  if (/^\d{8}$/.test(clean)) return 'ean8';
  if (/^\d{12}$/.test(clean)) return 'upc-a';
  // Code 39 uses start/stop '*' and may include -.+$/%; plain uppercase text
  // without those symbols is reported as the more general Code 128.
  if (/^\*[A-Z0-9\-. $/+%]*\*$/.test(clean)) return 'code39';
  if (clean.length > 0 && /[\x20-\x7e]/.test(clean)) return 'code128';
  return 'unknown';
}

/** GS1 application identifiers. Fixed-length AIs map to their byte length;
 *  everything else is variable-length terminated by GS (or end of data).
 *  This covers the common retail/shipping AIs; unknown AIs default to variable. */
const AI_FIXED_LENGTH: Record<string, number> = {
  '00': 18, // SSCC
  '01': 14, '02': 14, // GTIN
  '03': 14, '04': 14,
  '11': 6, '12': 6, '13': 6, '14': 6, '15': 6, '16': 6, '17': 6, // dates (YYMMDD)
  '20': 2, // internal
};

/** 3-digit AI prefixes that carry a fixed 6-digit measure (310x, 320x, ...). */
const AI_FIXED3 = new Set(['310', '311', '312', '313', '314', '315', '316', '317', '320', '321', '322', '323', '324', '325', '326', '327', '330', '331', '332', '333', '334', '335', '336', '337', '340', '341', '342', '343', '344', '345', '346', '347', '348', '349', '350', '351', '352', '353', '354', '355', '356', '357', '360', '361', '362', '363', '364', '365', '366', '367', '368', '369']);

const GS_CHAR = String.fromCharCode(GS);

function readAi(rest: string): string {
  // Longest-known-prefix match: 2, then 3, then 4 digits.
  if (rest.length >= 2 && isAllDigits(rest.slice(0, 2)) && rest.slice(0, 2) in AI_FIXED_LENGTH) {
    return rest.slice(0, 2);
  }
  if (rest.length >= 3 && isAllDigits(rest.slice(0, 3)) && AI_FIXED3.has(rest.slice(0, 3))) {
    return rest.slice(0, 3);
  }
  // Variable-length 2-digit AIs (10 = batch, 21 = serial, 22 = secondary, 23-29, 30-39, 40-49 ...).
  if (rest.length >= 2 && isAllDigits(rest.slice(0, 2))) {
    return rest.slice(0, 2);
  }
  if (rest.length >= 4 && isAllDigits(rest.slice(0, 4))) {
    return rest.slice(0, 4);
  }
  if (rest.length >= 3 && isAllDigits(rest.slice(0, 3))) {
    return rest.slice(0, 3);
  }
  return '';
}

function parseGs1Fields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let rest = body;
  while (rest.length > 0) {
    const ai = readAi(rest);
    if (!ai) break;
    rest = rest.slice(ai.length);
    const fixed = AI_FIXED_LENGTH[ai] ?? (AI_FIXED3.has(ai) ? 6 : undefined);
    let value: string;
    if (fixed != null) {
      value = rest.slice(0, fixed);
      rest = rest.slice(fixed);
    } else {
      const sep = rest.indexOf(GS_CHAR);
      if (sep < 0) {
        value = rest;
        rest = '';
      } else {
        value = rest.slice(0, sep);
        rest = rest.slice(sep + 1);
      }
    }
    // A GS separator may precede the next AI even after a fixed-length field.
    if (rest.startsWith(GS_CHAR)) rest = rest.slice(1);
    if (value) out[ai] = value;
  }
  return out;
}

/** Decode raw scanner bytes (string or Uint8Array) into a normalized barcode. */
export function parseBarcode(input: string | Uint8Array): ParsedBarcode {
  const rawBytes = typeof input === 'string' ? Array.from(new TextEncoder().encode(input)) : Array.from(input);
  const rawLength = rawBytes.length;

  // Drop NUL padding and trailing CR/LF.
  const trimmed = rawBytes.filter((b) => b !== NUL && b !== 0x0d && b !== 0x0a);
  const hadFnc1 = trimmed[0] === GS;
  // Replace remaining GS separators with a visible group separator for GS1.
  const visible = trimmed.map((b) => (b === GS || b === RS ? 0x1f : b));
  let text = new TextDecoder('utf8').decode(new Uint8Array(visible));
  text = stripAimPrefix(text);
  const cleanText = text.replace(/\x1f/g, String.fromCharCode(GS));

  // Build the printable code (replace GS with space for display).
  const displayCode = cleanText.replace(/\x1d/g, ' ').trim();

  let fields: Record<string, string> = {};
  if (hadFnc1) {
    fields = parseGs1Fields(cleanText.slice(1).replace(/\x1d/g, String.fromCharCode(GS)));
  }

  return {
    code: displayCode,
    symbology: detectSymbology(displayCode, hadFnc1),
    gs1: hadFnc1,
    fields,
    rawLength,
  };
}
