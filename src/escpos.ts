// Minimal ESC/POS command encoder for thermal receipt printers.
// Pure byte builder — no native deps, cross-compiles into the agent binary.
// Targets Epson TM-T20-compatible printers (the common POS thermal class).

export type EscposChunk = number[] | Uint8Array;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Code page table id → ESC t n. Default 0 (PC437). Add more as needed. */
const CODE_PAGES: Record<number, number> = {
  0: 0, // PC437
  20: 20, // PC860 (Portuguese)
  852: 2, // PC852 (Central European) — varies by printer; left as 2
  1254: 100, // Windows Turkish (printer-dependent)
};

function strBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

export interface PrintLine {
  text: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  size?: 'normal' | 'double';
}

export interface PrintJob {
  header?: string;
  lines: PrintLine[];
  footer?: string;
  cut?: boolean;
  codePage?: number;
}

export function encodeJob(job: PrintJob): Uint8Array {
  const out: number[] = [];
  const push = (bytes: EscposChunk) => {
    if (bytes instanceof Uint8Array) out.push(...bytes);
    else out.push(...bytes);
  };

  // Init + select code page
  out.push(ESC, 0x40);
  const cp = CODE_PAGES[job.codePage ?? 0] ?? 0;
  out.push(ESC, 0x74, cp);

  const emit = (line: PrintLine) => {
    // align
    const a = line.align === 'center' ? 1 : line.align === 'right' ? 2 : 0;
    out.push(ESC, 0x61, a);
    // bold
    out.push(ESC, 0x45, line.bold ? 1 : 0);
    // size
    if (line.size === 'double') out.push(GS, 0x21, 0x11);
    else out.push(GS, 0x21, 0x00);
    push(strBytes(line.text));
    out.push(LF);
    // reset
    out.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0x00);
  };

  if (job.header) emit({ text: job.header, bold: true, align: 'center', size: 'double' });
  for (const line of job.lines) emit(line);
  if (job.footer) emit({ text: job.footer, align: 'center' });

  if (job.cut !== false) {
    // Feed 3 lines then partial cut
    out.push(ESC, 0x64, 3, GS, 0x56, 0x42, 0x00);
  }

  return new Uint8Array(out);
}
