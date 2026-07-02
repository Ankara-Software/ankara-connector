// Cross-compile the Connector agent into standalone binaries via `bun build --compile`.
// Windows also builds systray host + NSIS installer via scripts/build-windows.ts.

import { $ } from 'bun';

const ENTRY = 'src/index.ts';
const VERSION = '1.1.8';

interface Target {
  id: string;
  out: string;
  windowsPack?: boolean;
}

const targets: Target[] = [
  {
    id: 'bun-windows-x64',
    out: `ankara-connector-${VERSION}-windows-x64.exe`,
    windowsPack: true,
  },
  { id: 'bun-darwin-x64', out: `ankara-connector-${VERSION}-macos-x64` },
  { id: 'bun-darwin-arm64', out: `ankara-connector-${VERSION}-macos-arm64` },
  { id: 'bun-linux-x64', out: `ankara-connector-${VERSION}-linux-x64` },
];

await $`mkdir -p dist`;

for (const t of targets) {
  if (t.windowsPack) {
    console.log('Building Windows pack (core + tray + installer)…');
    await $`bun run scripts/build-windows.ts`;
    continue;
  }
  console.log(`Building ${t.id} → dist/${t.out}`);
  await $`bun build ${ENTRY} --compile --minify --target ${t.id} --outfile dist/${t.out}`;
}

console.log('All desktop targets built into dist/.');
