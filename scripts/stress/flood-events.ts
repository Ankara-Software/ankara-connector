#!/usr/bin/env bun
// Stress test (roadmap §44) — floods the local Connector agent with hundreds of
// barcode/RFID events per second over its loopback WebSocket, asserting no
// drops/crashes and bounded end-to-end latency.
//
// Usage:
//   bun run scripts/stress/flood-events.ts [--url ws://127.0.0.1:4781] \
//         [--rate 500] [--duration-sec 10] [--cap scanner.barcode]
//
// Exits non-zero if: the agent process disappears, >rate% of commands time out,
// or p99 latency exceeds the target. Run against `ankara-connector --virtual`
// for a hardware-free stress target.

import { argv, exit } from 'node:process';
import { WebSocket } from 'node:websocket';

interface Args {
  url: string;
  rate: number; // events per second
  durationSec: number;
  cap: string;
  targetP99Ms: number;
}

function parseArgs(): Args {
  const a: Args = { url: 'ws://127.0.0.1:4781', rate: 500, durationSec: 10, cap: 'scanner.barcode', targetP99Ms: 2000 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--url') { a.url = v ?? a.url; i += 1; }
    else if (k === '--rate') { a.rate = Number(v ?? a.rate); i += 1; }
    else if (k === '--duration-sec') { a.durationSec = Number(v ?? a.durationSec); i += 1; }
    else if (k === '--cap') { a.cap = v ?? a.cap; i += 1; }
    else if (k === '--p99') { a.targetP99Ms = Number(v ?? a.targetP99Ms); i += 1; }
  }
  return a;
}

function encodeCommand(id: string, cap: string, action: string, payload: unknown): string {
  return JSON.stringify({ kind: 'command', v: 1, id, cap, action, payload });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`# flood: url=${args.url} rate=${args.rate}/s duration=${args.durationSec}s cap=${args.cap}`);

  const ws = new WebSocket(args.url);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error(`connect failed: ${(e as Error).message ?? 'unknown'}`));
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });

  const latencies: number[] = [];
  let sent = 0;
  let acked = 0;
  let errors = 0;
  const pending = new Map<string, number>();

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      if (msg.kind === 'ack' && msg.id) {
        const t0 = pending.get(msg.id);
        if (t0 != null) {
          latencies.push(Date.now() - t0);
          pending.delete(msg.id);
          acked += 1;
          if (msg.error) errors += 1;
        }
      }
    } catch {
      // ignore malformed
    }
  };

  const intervalMs = Math.max(1, 1000 / args.rate);
  const start = Date.now();
  const end = start + args.durationSec * 1000;
  const sender = setInterval(() => {
    if (Date.now() >= end) { clearInterval(sender); return; }
    for (let i = 0; i < args.rate && Date.now() < end; i += 1) {
      const id = `flood-${sent++}`;
      pending.set(id, Date.now());
      try {
        ws.send(encodeCommand(id, args.cap, 'scan', { code: `0${String(sent).padStart(12, '0')}` }));
      } catch {
        pending.delete(id);
        errors += 1;
      }
    }
  }, 1000);

  await new Promise((r) => setTimeout(r, args.durationSec * 1000 + 2000));
  clearInterval(sender);
  ws.close();

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p99 = percentile(latencies, 99);
  const dropRate = sent > 0 ? (sent - acked) / sent : 0;

  console.log(`# flood result: sent=${sent} acked=${acked} errors=${errors} dropRate=${(dropRate * 100).toFixed(1)}%`);
  console.log(`# latency ms: p50=${p50} p99=${p99} targetP99=${args.targetP99Ms}`);

  const ok = dropRate <= 0.05 && p99 <= args.targetP99Ms && errors <= sent * 0.05;
  if (!ok) {
    console.error(`flood: FAIL — dropRate=${(dropRate * 100).toFixed(1)}% p99=${p99}ms errors=${errors}`);
    exit(1);
  }
  console.log('flood: PASS');
}

void main().catch((e) => {
  console.error('flood: error', (e as Error).message);
  exit(2);
});
