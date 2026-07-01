import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { OfflineBuffer } from './offline-buffer';
import { bufferDeviceEvent, replayBufferedEvents, bufferedEventCount, setOfflineBuffer, pruneBufferedEvents } from './event-bridge';

describe('event-bridge', () => {
  let dir: string;
  let buf: OfflineBuffer;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eb-'));
    buf = new OfflineBuffer(join(dir, 'b.db'));
    setOfflineBuffer(buf);
  });

  afterEach(() => {
    setOfflineBuffer(null);
    try { buf.close(); } catch {}
    // WAL files may stay briefly locked on Windows; swallow cleanup errors —
    // temp dir is OS-managed.
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('buffers a device event and counts it', () => {
    const id = bufferDeviceEvent({ deviceId: 'dev-1', cap: 'scanner.barcode', event: 'scan', payload: { code: 'X1' } });
    expect(id).toBeGreaterThan(0);
    expect(bufferedEventCount()).toBe(1);
  });

  it('replays buffered events to a reconnecting panel and marks them synced', async () => {
    bufferDeviceEvent({ deviceId: 'dev-1', cap: 'rfid.uhf', event: 'tag', payload: { epc: 'AAA' } });
    bufferDeviceEvent({ deviceId: 'dev-1', cap: 'rfid.uhf', event: 'tag', payload: { epc: 'BBB' } });
    bufferDeviceEvent({ deviceId: 'other', cap: 'rfid.uhf', event: 'tag', payload: { epc: 'CCC' } });

    const sent: string[] = [];
    const encode = (cap: string, event: string, pl: unknown) => JSON.stringify({ cap, event, pl });
    const n = await replayBufferedEvents('dev-1', (wire) => sent.push(wire), encode);

    expect(n).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent.some((w) => w.includes('AAA'))).toBe(true);
    expect(sent.some((w) => w.includes('BBB'))).toBe(true);
    // Other device's event stays buffered.
    const remaining = buf.pending(100).filter((r) => r.deviceId === 'other');
    expect(remaining).toHaveLength(1);
  });

  it('prunes synced events past the keep window', async () => {
    bufferDeviceEvent({ deviceId: 'dev-1', cap: 'scanner.barcode', event: 'scan' });
    const encode = (c: string, e: string) => JSON.stringify({ c, e });
    await replayBufferedEvents('dev-1', () => {}, encode);
    // Keep window = 0 → prune everything synced.
    const removed = pruneBufferedEvents(0);
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});
