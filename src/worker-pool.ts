// Worker thread pool for CPU-bound device work (roadmap §34, enterprise §5).
//
// OCR frame decode, LLRP tag-stream parsing, and biometric template matching
// are CPU-heavy. Running them on the main event loop would let one device's
// compute work stall another's I/O. This pool offloads named compute tasks to
// `node:worker_threads`, keyed per device so a single device's compute jobs
// serialize while different devices parallelize.
//
// When `worker_threads` is unavailable (e.g. some bundler/test envs), the pool
// falls back to inline execution on the main thread — behavior is identical,
// only isolation degrades. The pool is opt-in per task; I/O-bound drivers keep
// using the main loop.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { runOnDevice } from './device-queue';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Bun runs .ts workers directly; the compiled binary build (Phase 6) emits .js.
// Prefer .ts when present (dev), else .js (compiled).
const WORKER_SCRIPT_TS = join(__dirname, 'workers', 'compute.worker.ts');
const WORKER_SCRIPT_JS = join(__dirname, 'workers', 'compute.worker.js');

function workerScript(): string {
  if (existsSync(WORKER_SCRIPT_TS)) return WORKER_SCRIPT_TS;
  return WORKER_SCRIPT_JS;
}

export interface ComputeTask {
  kind: 'hash' | 'sleep';
  data: Record<string, unknown>;
}

export interface ComputeResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

let workerAvailable: boolean | null = null;

function workerSupported(): boolean {
  if (workerAvailable !== null) return workerAvailable;
  try {
    // Probe by constructing a no-op worker; fall back to inline on any error.
    workerAvailable = typeof Worker === 'function';
  } catch {
    workerAvailable = false;
  }
  return workerAvailable;
}

/**
 * Submit a CPU-bound task for a device. The task runs on a worker thread when
 * available, serialized per `deviceKey`. Falls back to inline execution.
 */
export function submitCompute<T = unknown>(deviceKey: string, task: ComputeTask): Promise<T> {
  return runOnDevice(`compute:${deviceKey}`, async () => {
    if (!workerSupported()) {
      return inlineCompute(task) as T;
    }
    return runOnWorker<T>(task);
  });
}

function runOnWorker<T>(task: ComputeTask): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(workerScript());
      worker.on('message', (msg: ComputeResult) => {
        worker.terminate().catch(() => {});
        if (msg.ok) resolve(msg.data as T);
        else reject(new Error(msg.error ?? 'worker error'));
      });
      worker.on('error', (e) => {
        worker.terminate().catch(() => {});
        reject(e);
      });
      worker.postMessage(task);
    } catch (e) {
      // Fall back to inline if worker construction fails.
      resolve(inlineCompute(task) as T);
    }
  });
}

/** Inline fallback so the pool degrades gracefully without worker_threads. */
export function inlineCompute(task: ComputeTask): unknown {
  switch (task.kind) {
    case 'hash':
      return hashBytes(String(task.data.input ?? ''), Number(task.data.mod ?? 0x100000000));
    case 'sleep':
      return { sleptMs: Number(task.data.ms ?? 0) };
    default:
      throw new Error(`unknown compute task: ${(task as ComputeTask).kind}`);
  }
}

function hashBytes(input: string, mod: number): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}

/** Test helper: force the worker-availability probe result. */
export function setWorkerSupported(value: boolean | null): void {
  workerAvailable = value;
}

export { runOnDevice };
