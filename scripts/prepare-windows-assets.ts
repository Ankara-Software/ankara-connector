// Download brand logo and emit tray/installer assets (multi-size ICO, sidebar BMP).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import toIco from 'to-ico';

const ROOT = join(import.meta.dir, '..');
const ASSETS = join(ROOT, 'windows', 'assets');
const GENERATED = join(ROOT, 'src', 'generated');
const WIDE_PNG = join(ASSETS, 'ankara-yazilim-wide.png');
const TRAY_PNG = join(ASSETS, 'connector-tray.png');
const LEGACY_PNG = join(ASSETS, 'ankara-yazilim.png');
const ICO = join(ASSETS, 'ankara-yazilim.ico');
const SIDEBAR_BMP = join(ASSETS, 'installer-sidebar.bmp');
const LOGO_URL = 'https://ankarayazilim.org/ankara-yazilim.png';

const BRAND_NAVY = { r: 0x00, g: 0x21, b: 0x47, a: 255 };

async function downloadLogo(): Promise<Buffer> {
  if (existsSync(WIDE_PNG)) return readFileSync(WIDE_PNG);
  if (existsSync(LEGACY_PNG)) return readFileSync(LEGACY_PNG);
  console.log(`Downloading ${LOGO_URL} …`);
  const res = await fetch(LOGO_URL);
  if (!res.ok) throw new Error(`Logo download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(WIDE_PNG, buf);
  writeFileSync(LEGACY_PNG, buf);
  return buf;
}

/** Letterbox a wide logo onto a square canvas (tray / notification area). */
function squareTrayPng(source: Buffer, size = 256): Buffer {
  const src = PNG.sync.read(source);
  const canvas = new PNG({ width: size, height: size });
  for (let i = 0; i < canvas.data.length; i += 4) {
    canvas.data[i] = BRAND_NAVY.r;
    canvas.data[i + 1] = BRAND_NAVY.g;
    canvas.data[i + 2] = BRAND_NAVY.b;
    canvas.data[i + 3] = BRAND_NAVY.a;
  }
  const scale = Math.min((size * 0.82) / src.width, (size * 0.82) / src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / w) * src.width));
      const sy = Math.min(src.height - 1, Math.floor((y / h) * src.height));
      const si = (sy * src.width + sx) << 2;
      const di = ((oy + y) * size + (ox + x)) << 2;
      const a = src.data[si + 3] / 255;
      canvas.data[di] = Math.round(src.data[si] * a + BRAND_NAVY.r * (1 - a));
      canvas.data[di + 1] = Math.round(src.data[si + 1] * a + BRAND_NAVY.g * (1 - a));
      canvas.data[di + 2] = Math.round(src.data[si + 2] * a + BRAND_NAVY.b * (1 - a));
      canvas.data[di + 3] = 255;
    }
  }
  return PNG.sync.write(canvas);
}

/** NSIS MUI sidebar bitmap: 164×314, 24-bit BMP (bottom-up row order). */
function installerSidebarBmp(source: Buffer): Buffer {
  const w = 164;
  const h = 314;
  const rowBytes = w * 3;
  const pad = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + pad;
  const pixels = Buffer.alloc(stride * h);
  const src = PNG.sync.read(source);
  const rowOffset = (y: number) => (h - 1 - y) * stride;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h;
      const r = Math.round(BRAND_NAVY.r * (1 - t * 0.35));
      const g = Math.round(BRAND_NAVY.g * (1 - t * 0.35));
      const b = Math.round(BRAND_NAVY.b * (1 - t * 0.35));
      const o = rowOffset(y) + x * 3;
      pixels[o] = b;
      pixels[o + 1] = g;
      pixels[o + 2] = r;
    }
  }
  const scale = Math.min((w * 0.75) / src.width, (h * 0.28) / src.height);
  const lw = Math.max(1, Math.round(src.width * scale));
  const lh = Math.max(1, Math.round(src.height * scale));
  const ox = Math.floor((w - lw) / 2);
  const oy = Math.floor(h * 0.08);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / lw) * src.width));
      const sy = Math.min(src.height - 1, Math.floor((y / lh) * src.height));
      const si = (sy * src.width + sx) << 2;
      const a = src.data[si + 3] / 255;
      if (a < 0.05) continue;
      const px = ox + x;
      const py = oy + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const o = rowOffset(py) + px * 3;
      const pb = pixels[o] ?? 0;
      const pg = pixels[o + 1] ?? 0;
      const pr = pixels[o + 2] ?? 0;
      pixels[o] = Math.round(src.data[si + 2]! * a + pb * (1 - a));
      pixels[o + 1] = Math.round(src.data[si + 1]! * a + pg * (1 - a));
      pixels[o + 2] = Math.round(src.data[si]! * a + pr * (1 - a));
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM');
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(w, 18);
  header.writeInt32LE(h, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  return Buffer.concat([header, pixels]);
}

const wide = await downloadLogo();
const tray = squareTrayPng(wide);
writeFileSync(TRAY_PNG, tray);
writeFileSync(SIDEBAR_BMP, installerSidebarBmp(wide));

mkdirSync(GENERATED, { recursive: true });
const ico = await toIco(tray, { resize: true, sizes: [16, 24, 32, 48, 64, 256] });
writeFileSync(ICO, ico);

writeFileSync(join(GENERATED, 'tray-logo.ts'), `/** Auto-generated by scripts/prepare-windows-assets.ts — do not edit. */
export const TRAY_LOGO_PNG = Buffer.from('${tray.toString('base64')}', 'base64');
`);

console.log(`Wrote ${ICO} (${ico.byteLength} bytes), ${TRAY_PNG}, ${SIDEBAR_BMP}, src/generated/tray-logo.ts`);
