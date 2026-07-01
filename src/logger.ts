// Rolling file logger (roadmap §38).
//
// Daily-rotated log files under ~/.ankara-connector/logs/ with a max total
// disk budget. Older files beyond the cap are deleted oldest-first. Redacts
// known secret fields (tokens) before writing. Node fs only — cross-compiles.

import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { configPath } from './config';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB total cap
const MAX_FILES = 14;

function logsDir(): string {
  return join(require('node:path').dirname(configPath()), 'logs');
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Patterns to redact before writing to disk. */
const REDACT_PATTERNS: RegExp[] = [
  /"(token|deviceToken|authorization|secret)"\s*:\s*"[^"]+"/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
];

export function redact(line: string): string {
  let out = line;
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, (m) => {
      if (m.startsWith('Bearer')) return 'Bearer <redacted>';
      // JSON field form
      const eq = m.indexOf(':');
      return m.slice(0, eq + 1) + ' "<redacted>"';
    });
  }
  return out;
}

function enforceCap(dir: string): void {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.log'));
  } catch {
    return;
  }
  const sized = files
    .map((f) => ({ f, size: statSync(join(dir, f)).size, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  let total = sized.reduce((n, s) => n + s.size, 0);
  // Delete oldest until under cap AND under file count.
  while (sized.length > 0 && (total > MAX_BYTES || sized.length > MAX_FILES)) {
    const oldest = sized.shift()!;
    try {
      unlinkSync(join(dir, oldest.f));
      total -= oldest.size;
    } catch {
      break;
    }
  }
}

export type LogLevel = 'info' | 'warn' | 'error';

/** Append a redacted, timestamped log line to the daily log file. */
export function logLine(level: LogLevel, msg: string): void {
  const dir = logsDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${todayStamp()}.log`);
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level.toUpperCase()} ${redact(msg)}\n`;
  appendFileSync(file, line, 'utf8');
  enforceCap(dir);
}

/** Test helper: current log dir. */
export function logsPath(): string {
  return logsDir();
}

/** Test helper: enforce the cap on demand. */
export function pruneLogs(): void {
  const dir = logsDir();
  if (existsSync(dir)) enforceCap(dir);
}
