// Compute worker entry (roadmap §34, enterprise §5).
//
// Runs CPU-bound tasks off the main event loop. Receives a { kind, data }
// message, runs the named compute, and posts back { ok, data? } or { ok:false,
// error? }. Keep this script dependency-free so it cross-compiles into the
// single-binary build without pulling native addons into the worker.

import { parentPort } from 'node:worker_threads';

interface ComputeTask {
  kind: 'hash' | 'sleep';
  data: Record<string, unknown>;
}

function hashBytes(input: string, mod: number): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  void mod;
  return `h${(h >>> 0).toString(16)}`;
}

function compute(task: ComputeTask): unknown {
  switch (task.kind) {
    case 'hash':
      return hashBytes(String(task.data.input ?? ''), Number(task.data.mod ?? 0x100000000));
    case 'sleep':
      return { sleptMs: Number(task.data.ms ?? 0) };
    default:
      throw new Error(`unknown compute task: ${task.kind}`);
  }
}

if (parentPort) {
  parentPort.on('message', (task: ComputeTask) => {
    try {
      const data = compute(task);
      parentPort!.postMessage({ ok: true, data });
    } catch (e) {
      parentPort!.postMessage({ ok: false, error: (e as Error).message });
    }
  });
}
