// Local print spooler — FIFO queue with busy-retry backoff.
//
// Enterprise requirement (roadmap §31): when many print commands arrive at
// once, or the printer is temporarily busy/offline, jobs must be serialized
// and retried without blocking the loopback command channel or dropping work.
// Pure scheduler — transport is injected so it stays unit-testable.

export interface PrintQueueJob {
  readonly id: string;
  readonly data: Uint8Array;
  readonly target: { host: string; port: number };
  /** Monotonic enqueue time (ms). */
  readonly enqueuedAt: number;
  attempts: number;
}

export interface PrintQueueOptions {
  /** Max sequential attempts before a job is dead-lettered. */
  maxAttempts?: number;
  /** Base delay between retries (ms); doubled each attempt, capped. */
  baseDelayMs?: number;
  /** Retry delay cap (ms). */
  maxDelayMs?: number;
  /** Concurrent sends per target host (default 1 — strict FIFO). */
  concurrency?: number;
}

export interface SendFn {
  (target: { host: string; port: number }, data: Uint8Array): Promise<{ ok: boolean; bytes: number; error?: string }>;
}

export interface QueueResult {
  ok: boolean;
  bytes: number;
  error?: string;
  deadLettered?: boolean;
}

interface RunningState {
  busy: boolean;
  current: PrintQueueJob | null;
}

const perHost = new Map<string, RunningState>();

function backoff(attempts: number, base: number, cap: number): number {
  const d = base * 2 ** (attempts - 1);
  return Math.min(cap, d);
}

function stateFor(host: string): RunningState {
  let s = perHost.get(host);
  if (!s) {
    s = { busy: false, current: null };
    perHost.set(host, s);
  }
  return s;
}

/**
 * Enqueue-and-send a print job. Resolves once the job is either delivered or
 * dead-lettered after `maxAttempts`. Concurrent calls for the same host are
 * serialized (FIFO); different hosts run in parallel.
 */
export function enqueuePrint(
  job: PrintQueueJob,
  send: SendFn,
  opts: PrintQueueOptions = {},
): Promise<QueueResult> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const maxDelayMs = opts.maxDelayMs ?? 5000;
  const st = stateFor(job.target.host);

  return new Promise((resolve) => {
    const attempt = async () => {
      st.busy = true;
      st.current = job;
      let r: { ok: boolean; bytes: number; error?: string };
      try {
        r = await send(job.target, job.data);
      } catch (e) {
        r = { ok: false, bytes: 0, error: (e as Error).message };
      }
      st.busy = false;
      st.current = null;

      if (r.ok) {
        resolve({ ok: true, bytes: r.bytes });
        return;
      }
      job.attempts += 1;
      if (job.attempts >= maxAttempts) {
        resolve({
          ok: false,
          bytes: 0,
          error: r.error || 'Yazıcı ardışık denemelerden sonra yanıt vermedi.',
          deadLettered: true,
        });
        return;
      }
      const delay = backoff(job.attempts, baseDelayMs, maxDelayMs);
      setTimeout(attempt, delay);
    };

    if (st.busy) {
      // Wait for the current job to release the host, then run.
      const wait = () => {
        if (!st.busy) {
          attempt();
        } else {
          setTimeout(wait, 25);
        }
      };
      wait();
    } else {
      attempt();
    }
  });
}

/** Reset internal scheduling state — tests only. */
export function resetPrintQueueState(): void {
  perHost.clear();
}
