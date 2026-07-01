// Offline SQLite buffer (roadmap §32).
//
// When the cloud ingest endpoint is unreachable (network outage, server
// maintenance), the agent buffers device events — PDKS scans, ALPR plates,
// RFID reads — in a local SQLite database and replays them on reconnect.
// Uses bun:sqlite (built into the compiled binary, no native addon). The
// buffer is capped; oldest rows are evicted when the cap is hit.

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configPath } from './config';

export type BufferedEventKind = 'scan' | 'alpr' | 'rfid' | 'pdks' | 'generic';

export interface BufferedEvent {
  id?: number;
  kind: BufferedEventKind;
  deviceId: string;
  payload: string; // JSON string
  queuedAt: string;
  syncedAt?: string | null;
}

const DEFAULT_CAP = 50_000;

function bufferPath(): string {
  return join(dirname(configPath()), 'buffer.db');
}

export class OfflineBuffer {
  private db: Database;
  private readonly cap: number;

  constructor(path = bufferPath(), cap = DEFAULT_CAP) {
    this.cap = cap;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        device_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        synced_at TEXT
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS events_unsynced ON events(synced_at) WHERE synced_at IS NULL');
    this.enforceCap(cap);
  }

  /** Append a device event to the offline buffer. */
  enqueue(ev: Omit<BufferedEvent, 'id' | 'queuedAt' | 'syncedAt'>): number {
    const queuedAt = new Date().toISOString();
    const r = this.db.run(
      'INSERT INTO events (kind, device_id, payload, queued_at) VALUES (?, ?, ?, ?)',
      [ev.kind, ev.deviceId, ev.payload, queuedAt],
    );
    this.enforceCap(this.cap);
    return Number(r.lastInsertRowid);
  }

  /** Return up to `limit` unsynced events (oldest first). */
  pending(limit = 100): BufferedEvent[] {
    return this.db
      .prepare('SELECT id, kind, device_id, payload, queued_at, synced_at FROM events WHERE synced_at IS NULL ORDER BY id ASC LIMIT ?')
      .all(limit)
      .map((r: any) => ({
        id: r.id,
        kind: r.kind,
        deviceId: r.device_id,
        payload: r.payload,
        queuedAt: r.queued_at,
        syncedAt: r.synced_at,
      }));
  }

  /** Mark a batch of event ids as synced. */
  markSynced(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(`UPDATE events SET synced_at = ? WHERE id IN (${placeholders})`, [new Date().toISOString(), ...ids]);
  }

  /** Delete fully-synced events older than `keepMs`. */
  pruneSynced(keepMs = 1000 * 60 * 60 * 24): number {
    const cutoff = new Date(Date.now() - keepMs).toISOString();
    const r = this.db.run('DELETE FROM events WHERE synced_at IS NOT NULL AND synced_at < ?', [cutoff]);
    return Number(r.changes);
  }

  /** Total rows in the buffer. */
  count(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    return r.n;
  }

  private enforceCap(cap: number): void {
    const n = this.count();
    if (n <= cap) return;
    const overflow = n - cap;
    this.db.run('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id ASC LIMIT ?)', [overflow]);
  }

  close(): void {
    this.db.close();
  }
}

/** Test helper: build a buffer at a temp path. */
export function openBufferAt(path: string, cap?: number): OfflineBuffer {
  return new OfflineBuffer(path, cap);
}

/** Test helper: default buffer path. */
export function defaultBufferPath(): string {
  return bufferPath();
}

void existsSync;
