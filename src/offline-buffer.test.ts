import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OfflineBuffer } from './offline-buffer';

function tmpDb(): string {
  return join(tmpdir(), `connector-buffer-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('OfflineBuffer', () => {
  test('enqueue + pending + markSynced round-trip', () => {
    const path = tmpDb();
    const buf = new OfflineBuffer(path);
    const id1 = buf.enqueue({ kind: 'scan', deviceId: 'dev-1', payload: '{"code":"123"}' });
    const id2 = buf.enqueue({ kind: 'alpr', deviceId: 'dev-1', payload: '{"plate":"06 ABC 1"}' });
    expect(id1).toBeGreaterThan(0);
    const pending = buf.pending(10);
    expect(pending.length).toBe(2);
    expect(pending[0].kind).toBe('scan');
    buf.markSynced([id1, id2]);
    expect(buf.pending(10).length).toBe(0);
    buf.close();
  });

  test('pruneSynced removes old synced rows', () => {
    const path = tmpDb();
    const buf = new OfflineBuffer(path);
    const id = buf.enqueue({ kind: 'pdks', deviceId: 'd', payload: '{}' });
    buf.markSynced([id]);
    // Backdate the synced_at via raw SQL to simulate age.
    (buf as any).db.run("UPDATE events SET synced_at = '2000-01-01T00:00:00Z' WHERE id = ?", [id]);
    const removed = buf.pruneSynced(1000);
    expect(removed).toBe(1);
    buf.close();
  });

  test('cap evicts oldest rows', () => {
    const path = tmpDb();
    const buf = new OfflineBuffer(path, 3);
    buf.enqueue({ kind: 'scan', deviceId: 'd', payload: '1' });
    buf.enqueue({ kind: 'scan', deviceId: 'd', payload: '2' });
    buf.enqueue({ kind: 'scan', deviceId: 'd', payload: '3' });
    buf.enqueue({ kind: 'scan', deviceId: 'd', payload: '4' });
    expect(buf.count()).toBe(3);
    buf.close();
  });

  test('default buffer path lives under ~/.ankara-connector', () => {
    const { defaultBufferPath } = require('./offline-buffer');
    expect(defaultBufferPath()).toContain('buffer.db');
  });
});
