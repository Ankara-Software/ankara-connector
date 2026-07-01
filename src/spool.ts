// Transport wrapper that routes print/drawer commands through the local
// spooler (roadmap §31) and maps spooler outcomes to customer-facing errors.

import { sendRawBytes as directSendRawBytes } from './printer';
import { encodeJob, encodeDrawerKick } from './escpos';
import { enqueuePrint, resetPrintQueueState, type PrintQueueJob } from './print-queue';

function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `pj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SpoolResult {
  ok: boolean;
  bytes: number;
  error?: string;
  deadLettered?: boolean;
}

function spool(target: { host: string; port: number }, data: Uint8Array): Promise<SpoolResult> {
  const job: PrintQueueJob = {
    id: newId(),
    data,
    target,
    enqueuedAt: Date.now(),
    attempts: 0,
  };
  return enqueuePrint(job, (t, d) => directSendRawBytes(t, d), {
    maxAttempts: 4,
    baseDelayMs: 400,
    maxDelayMs: 5000,
  });
}

/** Spooled receipt print — encodes the job then queues the bytes per-host. */
export async function spooledPrint(
  target: { host: string; port: number },
  job: Parameters<typeof encodeJob>[0],
): Promise<SpoolResult> {
  return spool(target, encodeJob(job));
}

/** Spooled raw bytes (e.g. cash drawer kick) — queued per-host. */
export async function spooledRaw(
  target: { host: string; port: number },
  data: Uint8Array,
): Promise<SpoolResult> {
  return spool(target, data);
}

/** Spooled cash-drawer kick. */
export async function spooledDrawerKick(
  target: { host: string; port: number },
  pin: 0 | 1 = 1,
  onMs = 50,
  offMs = 50,
): Promise<SpoolResult> {
  return spool(target, encodeDrawerKick(pin, onMs, offMs));
}

export { resetPrintQueueState };
