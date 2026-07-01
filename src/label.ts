// ZPL/EPL/TSPL label command engine (roadmap §11).
//
// Generates Zebra Programming Language (ZPL II), Eltron (EPL), and TSPL
// command streams for label printers. The panel sends a small structured
// label spec; the agent renders it to the right dialect for the bound printer.
// Pure byte builder — no native deps, cross-compiles, unit-testable.

export type LabelDialect = 'zpl' | 'epl' | 'tspl';

export interface LabelField {
  /** Field type. */
  kind: 'text' | 'barcode' | 'qrcode' | 'box' | 'line';
  /** X position in dots. */
  x: number;
  /** Y position in dots. */
  y: number;
  /** Text content (for text/barcode/qrcode). */
  text?: string;
  /** Font: zpl font identifier ('0'-'9','A'-'Z') or point size for epl/tspl. */
  font?: string;
  /** Height in dots (barcode/box/line). */
  h?: number;
  /** Width in dots (barcode/box/line). */
  w?: number;
  /** Barcode symbology for kind='barcode'. */
  symbology?: 'code128' | 'code39' | 'ean13' | 'ean8' | 'upc';
}

export interface LabelSpec {
  /** Label width in dots. */
  width: number;
  /** Label height in dots. */
  height: number;
  /** Print density (dpmm). ZPL default 8. */
  dpmm?: number;
  /** Number of labels to print. */
  copies?: number;
  fields: LabelField[];
}

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

/** Render a label spec to ZPL II. */
export function renderZpl(spec: LabelSpec): string {
  const dpmm = spec.dpmm ?? 8;
  const out: string[] = [];
  out.push(`^XA`);
  out.push(`^PW${spec.width}`);
  out.push(`^LL${spec.height}`);
  out.push(`^MNN`); // continuous
  out.push(`^MTD`); // direct thermal
  out.push(`^PQ${spec.copies ?? 1}`);
  out.push(`^DFR:LABEL.ZPL`); // form storage
  out.push(`^FS`);

  for (const f of spec.fields) {
    switch (f.kind) {
      case 'text': {
        const font = f.font ?? '0';
        const h = f.h ?? 30;
        out.push(`^FO${f.x},${f.y}`);
        out.push(`^A${font}N,${h},${Math.round(h * 0.6)}`);
        out.push(`^FD${f.text ?? ''}^FS`);
        break;
      }
      case 'barcode': {
        const h = f.h ?? 100;
        switch (f.symbology ?? 'code128') {
          case 'code128':
            out.push(`^FO${f.x},${f.y}^BY2`);
            out.push(`^BCN,${h},Y,N,N`);
            out.push(`^FD${f.text ?? ''}^FS`);
            break;
          case 'code39':
            out.push(`^FO${f.x},${f.y}^BY2`);
            out.push(`^B3N,Y,${h},Y,N`);
            out.push(`^FD${f.text ?? ''}^FS`);
            break;
          case 'ean13':
            out.push(`^FO${f.x},${f.y}^BY2`);
            out.push(`^BEN,${h},Y,N`);
            out.push(`^FD${digits(f.text ?? '').slice(0, 13)}^FS`);
            break;
          case 'ean8':
            out.push(`^FO${f.x},${f.y}^BY2`);
            out.push(`^B8N,${h},Y,N`);
            out.push(`^FD${digits(f.text ?? '').slice(0, 8)}^FS`);
            break;
          default:
            out.push(`^FO${f.x},${f.y}^BY2`);
            out.push(`^B2N,${h},Y,N,N`);
            out.push(`^FD${f.text ?? ''}^FS`);
        }
        break;
      }
      case 'qrcode': {
        out.push(`^FO${f.x},${f.y}`);
        out.push(`^BQN,2,${f.h ?? 4}`);
        out.push(`^FDMA,${f.text ?? ''}^FS`);
        break;
      }
      case 'box': {
        out.push(`^FO${f.x},${f.y}^GB${f.w ?? 100},${f.h ?? 50},2,B^FS`);
        break;
      }
      case 'line': {
        out.push(`^FO${f.x},${f.y}^GB${f.w ?? 100},${f.h ?? 2},2,B^FS`);
        break;
      }
    }
  }
  out.push(`^XZ`);
  void dpmm;
  return out.join('\n');
}

/** Render a label spec to EPL (Eltron). */
export function renderEpl(spec: LabelSpec): string {
  const out: string[] = [];
  out.push('N'); // clear image buffer
  out.push(`q${spec.width}`);
  out.push(`Q${spec.height},${(spec.copies ?? 1) - 1}`);
  for (const f of spec.fields) {
    switch (f.kind) {
      case 'text': {
        const font = (f.font ?? '3').slice(0, 1);
        const h = f.h ?? 8;
        out.push(`A${f.x},${f.y},${0},${font},${h},${h},N,"${f.text ?? ''}"`);
        break;
      }
      case 'barcode': {
        const h = f.h ?? 60;
        const sym = f.symbology ?? 'code128';
        const eplSym = sym === 'code128' ? '1' : sym === 'code39' ? '3' : sym === 'ean13' ? 'E80' : sym === 'ean8' ? 'E30' : '1';
        out.push(`B${f.x},${f.y},0,${eplSym},${h},${h},${f.w ?? 2},N,"${f.text ?? ''}"`);
        break;
      }
      case 'qrcode': {
        out.push(`b${f.x},${f.y},Q,${f.h ?? 4},"${f.text ?? ''}"`);
        break;
      }
      case 'box': {
        out.push(`BOX${f.x},${f.y},${f.x + (f.w ?? 100)},${f.y + (f.h ?? 50)},2`);
        break;
      }
      case 'line': {
        out.push(`L${f.x},${f.y},${f.x + (f.w ?? 100)},${f.y},2`);
        break;
      }
    }
  }
  out.push(`P${spec.copies ?? 1},1`);
  return out.join('\n');
}

/** Render a label spec to TSPL. */
export function renderTspl(spec: LabelSpec): string {
  const out: string[] = [];
  out.push('SIZE ' + (spec.width / (spec.dpmm ?? 8)).toFixed(1) + ' mm,' + (spec.height / (spec.dpmm ?? 8)).toFixed(1) + ' mm');
  out.push('DIRECTION 1,0');
  out.push('CLS');
  for (const f of spec.fields) {
    switch (f.kind) {
      case 'text': {
        const h = f.h ?? 30;
        out.push(`TEXT ${f.x},${f.y},"TSS24.BF2",0,${h},${h},"${f.text ?? ''}"`);
        break;
      }
      case 'barcode': {
        const h = f.h ?? 100;
        const sym = (f.symbology ?? 'code128').toUpperCase();
        out.push(`BARCODE ${f.x},${f.y},"${sym}",${h},${f.text ?? ''}`);
        break;
      }
      case 'qrcode': {
        out.push(`QRCODE ${f.x},${f.y},H,${f.h ?? 4},A,0,"${f.text ?? ''}"`);
        break;
      }
      case 'box': {
        out.push(`BOX ${f.x},${f.y},${f.x + (f.w ?? 100)},${f.y + (f.h ?? 50)},2`);
        break;
      }
      case 'line': {
        out.push(`BAR ${f.x},${f.y},${f.w ?? 100},${f.h ?? 2}`);
        break;
      }
    }
  }
  out.push(`PRINT ${spec.copies ?? 1},1`);
  return out.join('\n');
}

/** Render a label spec to the requested dialect. */
export function renderLabel(spec: LabelSpec, dialect: LabelDialect): Uint8Array {
  const text = dialect === 'zpl' ? renderZpl(spec) : dialect === 'epl' ? renderEpl(spec) : renderTspl(spec);
  return new TextEncoder().encode(text);
}
