#!/usr/bin/env bun
// Memory footprint benchmark (roadmap §33, low-memory target).
//
// Runs the compiled Connector binary (or `bun run` fallback) idle and under a
// synthetic load, samples RSS via the OS, and asserts it stays under the
// configured target. Intended for CI; exits non-zero on breach so a regression
// in footprint fails the build.
//
// Usage:
//   bun run scripts/bench-memory.ts [--binary <path>] [--target-mb <n>] [--idle-sec <n>] [--load-events <n>]

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argv, exit } from 'node:process';

interface Args {
  binary: string | null;
  targetMb: number;
  idleSec: number;
  loadEvents: number;
}

function parseArgs(): Args {
  const a: Args = { binary: null, targetMb: 180, idleSec: 8, loadEvents: 500 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--binary') { a.binary = v ?? null; i += 1; }
    else if (k === '--target-mb') { a.targetMb = Number(v ?? 180); i += 1; }
    else if (k === '--idle-sec') { a.idleSec = Number(v ?? 8); i += 1; }
    else if (k === '--load-events') { a.loadEvents = Number(v ?? 500); i += 1; }
  }
  return a;
}

interface Sample { t: number; rssMb: number }

async function sampleRss(pid: number): Promise<number> {
  try {
    const plat = process.platform;
    if (plat === 'win32') {
      const out = await run('powershell', ['-NoProfile', '-Command',
        `Get-Process -Id ${pid} | Select-Object -ExpandProperty WorkingSet64`]);
      return Math.round(Number(out.trim()) / 1024 / 1024);
    }
    if (plat === 'darwin') {
      const out = await run('ps', ['-o', 'rss=', '-p', String(pid)]);
      return Math.round(Number(out.trim()) / 1024);
    }
    // linux
    const out = await run('ps', ['-o', 'rss=', '-p', String(pid)]);
    return Math.round(Number(out.trim()) / 1024);
  } catch {
    return 0;
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', () => {});
    p.on('error', reject);
    p.on('close', () => resolve(out));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseArgs();
  const bin = args.binary && existsSync(args.binary)
    ? args.binary
    : 'bun';
  const binArgs = args.binary && existsSync(args.binary)
    ? []
    : ['run', 'src/index.ts'];
  if (!args.binary) console.log('# bench-memory: using bun run fallback (no compiled binary given).');

  const child = spawn(bin, binArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, CONNECTOR_BENCH: '1' } });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});

  const samples: Sample[] = [];
  const start = Date.now();

  // Idle sampling.
  const idleEnd = start + args.idleSec * 1000;
  while (Date.now() < idleEnd) {
    const rss = await sampleRss(child.pid ?? 0);
    samples.push({ t: Date.now() - start, rssMb: rss });
    await sleep(1000);
  }

  // Synthetic load: fire N status/health pings to exercise the loopback surface.
  for (let i = 0; i < args.loadEvents; i += 1) {
    void fetch(`http://127.0.0.1:4781/health`).catch(() => {});
    if (i % 50 === 0) {
      const rss = await sampleRss(child.pid ?? 0);
      samples.push({ t: Date.now() - start, rssMb: rss });
    }
  }
  await sleep(2000);
  const peakAfterLoad = await sampleRss(child.pid ?? 0);
  samples.push({ t: Date.now() - start, rssMb: peakAfterLoad });

  child.kill('SIGTERM');

  const valid = samples.filter((s) => s.rssMb > 0);
  const idleSamples = valid.slice(0, Math.max(1, Math.floor(args.idleSec)));
  const idleAvg = Math.round(idleSamples.reduce((a, s) => a + s.rssMb, 0) / idleSamples.length);
  const peak = valid.reduce((m, s) => Math.max(m, s.rssMb), 0);

  console.log(`# bench-memory: idleAvg=${idleAvg}MB peak=${peak}MB target=${args.targetMb}MB samples=${valid.length}`);
  for (const s of valid) console.log(`  t=${s.t}ms rss=${s.rssMb}MB`);

  const ok = peak <= args.targetMb;
  if (!ok) {
    console.error(`bench-memory: FAIL — peak ${peak}MB exceeds target ${args.targetMb}MB`);
    exit(1);
  }
  console.log('bench-memory: PASS');
}

void main().catch((e) => {
  console.error('bench-memory: error', e);
  exit(2);
});
