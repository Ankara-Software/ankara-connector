// Watchdog process (enterprise §4).
//
// A minimal supervisor that spawns the agent and restarts it when it exits
// unexpectedly. Runs as a separate process so an agent crash (segfault, OOM,
// unhandled rejection) cannot leave the user without hardware bridging. The
// watchdog itself is intentionally tiny — it only spawns, watches, and logs.
//
// Usage: ankara-connector watchdog  (runs forever; Ctrl+C exits both)

import { spawn } from 'node:child_process';
import { logLine } from './logger';

const MIN_UPTIME_MS = 10_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

export interface WatchdogOptions {
  /** Agent entry argv (excluding node/bun). */
  argv?: string[];
  maxRestarts?: number;
}

export async function runWatchdog(opts: WatchdogOptions = {}): Promise<void> {
  const argv = opts.argv ?? ['run'];
  let attempts = 0;
  let restarts = 0;
  const maxRestarts = opts.maxRestarts ?? 10;

  while (restarts < maxRestarts) {
    const startedAt = Date.now();
    logLine('info', `watchdog: agent başlatılıyor (deneme ${restarts + 1})`);
    const code = await spawnAgent(argv);
    const uptime = Date.now() - startedAt;

    if (code === 0) {
      logLine('info', 'watchdog: agent temiz çıkış yaptı.');
      return;
    }

    restarts += 1;
    // If the agent crashed too quickly, back off to avoid a tight crash loop.
    if (uptime < MIN_UPTIME_MS) {
      attempts += 1;
    } else {
      attempts = 0;
    }
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempts);
    logLine('warn', `watchdog: agent çıkış kodu ${code}, ${delay}ms sonra yeniden başlatılıyor.`);
    await sleep(delay);
  }

  logLine('error', `watchdog: ${maxRestarts} yeniden başlatma denemesi tükendi — duruyor.`);
  process.exit(1);
}

function spawnAgent(argv: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [require('node:path').resolve(__dirname, 'index.ts'), ...argv], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
