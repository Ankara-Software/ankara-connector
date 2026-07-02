// Build Rust v2 Windows binary (single AnkaraConnector.exe).

import { $ } from 'bun';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '2.0.0';
const ROOT = join(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const ICO = join(ROOT, 'windows', 'assets', 'ankara-yazilim.ico');
const TARGET = process.env.CONNECTOR_RUST_TARGET || 'x86_64-pc-windows-gnu';

mkdirSync(DIST, { recursive: true });

console.log(`Building Connector v2 (Rust, ${TARGET})…`);
await $`cargo build --release -p connector-app --target ${TARGET}`;
const built = join(ROOT, 'target', TARGET, 'release', 'AnkaraConnector.exe');
if (!existsSync(built)) {
  throw new Error('Rust build failed — AnkaraConnector.exe not found');
}

const out = join(DIST, 'AnkaraConnector.exe');
copyFileSync(built, out);
copyFileSync(built, join(DIST, `AnkaraConnector-${VERSION}-windows-x64.exe`));
if (existsSync(ICO)) copyFileSync(ICO, join(DIST, 'ankara-yazilim.ico'));

console.log(`Wrote ${out}`);
