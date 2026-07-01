// ESC/POS realtime printer health probing (roadmap §37).
//
// ESC/POS exposes `DLE EOT n` to read printer status (online, paper, cover,
// error). This module builds the request bytes and decodes the response byte
// into a typed health snapshot surfaced to the panel. Pure — no transport.

export interface PrinterHealth {
  online: boolean;
  paperOut: boolean;
  coverOpen: boolean;
  error: boolean;
  /** Human label for the panel. */
  label: string;
}

const DLE = 0x10;
const EOT = 0x04;

/** n values for DLE EOT n (printer status, paper, error, ink). */
export const HEALTH_PROBES = {
  online: 1,
  paper: 2,
  error: 3,
} as const;

export type HealthProbeKind = keyof typeof HEALTH_PROBES;

/** Build a `DLE EOT n` status-request byte sequence. */
export function encodeHealthRequest(kind: HealthProbeKind): Uint8Array {
  return new Uint8Array([DLE, EOT, HEALTH_PROBES[kind]]);
}

/**
 * Decode a single status byte returned by `DLE EOT n`.
 * Bit semantics follow the ESC/POS reference (bit 3 = error/offline, etc.).
 */
export function decodeHealthByte(kind: HealthProbeKind, b: number): PrinterHealth {
  if (kind === 'online') {
    // bit 5: printer online when 0
    const online = (b & 0x20) === 0;
    return { online, paperOut: false, coverOpen: false, error: !online, label: online ? 'Çevrimiçi' : 'Çevrimdışı' };
  }
  if (kind === 'paper') {
    // bit 2: paper end when 1; bit 3: paper near end
    const paperOut = (b & 0x04) !== 0;
    return { online: !paperOut, paperOut, coverOpen: false, error: paperOut, label: paperOut ? 'Kağıt bitti' : 'Kağıt var' };
  }
  // error probe: bit 6 cover open, bit 3 unrecoverable error
  const coverOpen = (b & 0x40) !== 0;
  const err = (b & 0x08) !== 0;
  return {
    online: !coverOpen && !err,
    paperOut: false,
    coverOpen,
    error: err || coverOpen,
    label: coverOpen ? 'Kapak açık' : err ? 'Donanım hatası' : 'Sorun yok',
  };
}

/** Aggregate a full health snapshot from a set of probe responses. */
export function aggregateHealth(responses: Partial<Record<HealthProbeKind, number>>): PrinterHealth {
  const online = responses.online != null ? decodeHealthByte('online', responses.online) : null;
  const paper = responses.paper != null ? decodeHealthByte('paper', responses.paper) : null;
  const error = responses.error != null ? decodeHealthByte('error', responses.error) : null;

  const paperOut = paper?.paperOut ?? false;
  const coverOpen = error?.coverOpen ?? false;
  const err = error?.error ?? false;
  const isOnline = online?.online ?? false;

  let label = 'Çevrimiçi';
  if (paperOut) label = 'Kağıt bitti';
  else if (coverOpen) label = 'Kapak açık';
  else if (err) label = 'Donanım hatası';
  else if (!isOnline) label = 'Çevrimdışı';

  return { online: isOnline && !paperOut && !coverOpen && !err, paperOut, coverOpen, error: err || paperOut || coverOpen, label };
}

/** Map a health snapshot to an error-code-encyclopedia key (roadmap §47). */
export function healthErrorKey(h: PrinterHealth): string | null {
  if (h.paperOut) return 'printer_paper_out';
  if (h.coverOpen) return 'printer_cover_open';
  if (!h.online) return 'printer_offline';
  return null;
}
