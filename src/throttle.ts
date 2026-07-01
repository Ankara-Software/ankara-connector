// CPU throttling for polling-heavy device loops (roadmap §35).
//
// Camera capture, LLRP inventory, and signage refresh loops can spin fast enough
// to pin a CPU. This module enforces a per-device minimum interval between
// iterations (configurable via `pollMinIntervalMs`), with an async sleep so the
// event loop stays free for other devices. Different devices keep independent
// gates so a slow camera does not stall a fast scanner.

import { loadConfig } from './config';

const lastRun = new Map<string, number>();

/**
 * Await until at least `minMs` has elapsed since the previous call with the
 * same `key`. Returns the waited milliseconds (0 if no wait was needed).
 */
export async function throttlePoll(key: string, minMs?: number): Promise<number> {
  const min = minMs ?? loadConfig().pollMinIntervalMs ?? 0;
  if (min <= 0) return 0;
  const now = Date.now();
  const last = lastRun.get(key) ?? 0;
  const elapsed = now - last;
  if (elapsed >= min) {
    lastRun.set(key, now);
    return 0;
  }
  const wait = min - elapsed;
  await sleep(wait);
  lastRun.set(key, Date.now());
  return wait;
}

/** Plain async sleep that yields the event loop. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

/** Test helper: reset all gates. */
export function resetThrottle(): void {
  lastRun.clear();
}
