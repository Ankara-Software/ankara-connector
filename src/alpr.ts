// Edge ALPR — license-plate detection + normalization (roadmap §28).
//
// The actual OCR runs in a downstream model (ffmpeg frame → tesseract/ONNX);
// this module owns plate-text normalization and Turkish plate validation so
// the agent can filter noise before ingesting. Pure — no I/O, testable.

/** Turkish plate format: 2 digits city (01-81), up to 3 letters, up to 4 digits. */
const TR_PLATE = /^(\d{2})\s*([A-Z]{1,3})\s*(\d{2,4})$/;

export interface ParsedPlate {
  /** Normalized plate, no spaces, uppercase. */
  plate: string;
  cityCode: string | null;
  letters: string | null;
  number: string | null;
  valid: boolean;
}

/** Normalize a raw OCR string into a plate candidate (uppercase, alnum only). */
export function normalizePlate(raw: string): string {
  return raw
    // Turcify lowercase Turkish letters first, before the alnum filter strips them.
    .replace(/ç/gi, 'C').replace(/ğ/gi, 'G').replace(/ı/gi, 'I').replace(/i̇/gi, 'I')
    .replace(/ö/gi, 'O').replace(/ş/gi, 'S').replace(/ü/gi, 'U')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
}

/** Parse + validate a Turkish plate. */
export function parseTurkishPlate(raw: string): ParsedPlate {
  const normalized = normalizePlate(raw);
  const m = normalized.match(TR_PLATE);
  if (!m) {
    return { plate: normalized, cityCode: null, letters: null, number: null, valid: false };
  }
  const cityCode = m[1]!;
  const letters = m[2]!;
  const number = m[3]!;
  // Full city-code validation lives server-side (PBS ingest); the agent only
  // checks the shape so newer city codes are not dropped at the edge.
  const cityNum = Number(cityCode);
  const valid = cityNum >= 1 && cityNum <= 81;
  return { plate: `${cityCode} ${letters} ${number}`, cityCode, letters, number, valid };
}

/** Time-window dedup for repeated plate reads (roadmap §29, applied to ALPR). */
export class PlateDeduper {
  private readonly seen = new Map<string, number>();
  constructor(private readonly windowMs = 5_000) {}

  /** Returns true when the plate is new within the window. */
  accept(plate: string, now = Date.now()): boolean {
    const last = this.seen.get(plate);
    if (last != null && now - last < this.windowMs) {
      this.seen.set(plate, now);
      return false;
    }
    this.seen.set(plate, now);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}
