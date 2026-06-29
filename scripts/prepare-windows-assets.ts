// Download brand logo and emit tray/installer .ico (multi-size).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import toIco from 'to-ico';

const ROOT = join(import.meta.dir, '..');
const ASSETS = join(ROOT, 'windows', 'assets');
const PNG = join(ASSETS, 'ankara-yazilim.png');
const ICO = join(ASSETS, 'ankara-yazilim.ico');
const LOGO_URL = 'https://ankarayazilim.org/ankara-yazilim.png';

if (!existsSync(PNG)) {
  console.log(`Downloading ${LOGO_URL} …`);
  const res = await fetch(LOGO_URL);
  if (!res.ok) throw new Error(`Logo download failed: ${res.status}`);
  writeFileSync(PNG, Buffer.from(await res.arrayBuffer()));
}

const png = readFileSync(PNG);
const ico = await toIco(png, { resize: true, sizes: [16, 32, 48, 64, 128, 256] });
writeFileSync(ICO, ico);
console.log(`Wrote ${ICO} (${ico.byteLength} bytes)`);
