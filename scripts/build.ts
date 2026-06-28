// Cross-compile the Connector agent into standalone binaries via `bun build --compile`.
// Produces a single self-contained executable per desktop target — no runtime install needed.

import { $ } from 'bun';

const ENTRY = 'src/index.ts';
const VERSION = '1.0.0';

interface Target {
  id: string;
  out: string;
}

const targets: Target[] = [
  { id: 'bun-windows-x64', out: `ankara-connector-${VERSION}-windows-x64.exe` },
  { id: 'bun-darwin-x64', out: `ankara-connector-${VERSION}-macos-x64` },
  { id: 'bun-darwin-arm64', out: `ankara-connector-${VERSION}-macos-arm64` },
  { id: 'bun-linux-x64', out: `ankara-connector-${VERSION}-linux-x64` },
];

await $`mkdir -p dist`;

for (const t of targets) {
  console.log(`Building ${t.id} → dist/${t.out}`);
  await $`bun build ${ENTRY} --compile --minify --target ${t.id} --outfile dist/${t.out}`;
}

console.log('All desktop targets built into dist/.');
