// Offline event bridge (roadmap §32) — durability for unsolicited device events.
//
// When a hardware event arrives (barcode scanned, RFID read, ALPR plate) and no
// panel WebSocket client is connected to receive it, the event is buffered in
// the local SQLite OfflineBuffer instead of being dropped. On reconnect (a WS
// client opens), buffered events are replayed to the panel in order. This
// closes the loop started by the polling fallback (which covers cloud→agent
// commands): now agent→panel events also survive a disconnected browser.
//
// Cloud-level replay (buffer→server when both WS and cloud are down) is handled
// by piggybacking buffered event ids onto the heartbeat; the server can fetch
// them later. The local buffer is the source of truth until acked.

import { logLine } from './logger';
import { OfflineBuffer, type BufferedEvent, type BufferedEventKind } from './offline-buffer';

let buffer: OfflineBuffer | null = null;

function buf(): OfflineBuffer {
  if (!buffer) buffer = new OfflineBuffer();
  return buffer;
}

/** Test helper: inject a custom buffer. */
export function setOfflineBuffer(b: OfflineBuffer | null): void {
  buffer = b;
}

function kindFor(cap: string): BufferedEventKind {
  switch (cap) {
    case 'scanner.barcode':
    case 'scanner.qr':
      return 'scan';
    case 'alpr.camera':
      return 'alpr';
    case 'rfid.uhf':
    case 'rfid.gate':
      return 'rfid';
    default:
      return 'generic';
  }
}

/**
 * Buffer a device event for later replay. Called when no panel WS client is
 * connected. Returns the buffer row id.
 */
export function bufferDeviceEvent(input: {
  deviceId: string;
  cap: string;
  event: string;
  payload?: unknown;
}): number {
  return buf().enqueue({
    kind: kindFor(input.cap),
    deviceId: input.deviceId,
    payload: JSON.stringify({ cap: input.cap, event: input.event, ...(input.payload !== undefined ? { payload: input.payload } : {}) }),
  });
}

/** Drain and replay buffered events to a freshly-connected panel client. */
export async function replayBufferedEvents(
  deviceId: string,
  send: (wire: string) => void,
  encode: (cap: string, event: string, payload: unknown) => string,
): Promise<number> {
  const pending = buf().pending(100);
  if (pending.length === 0) return 0;
  let replayed = 0;
  const acked: number[] = [];
  for (const row of pending) {
    if (row.deviceId !== deviceId) continue;
    try {
      const parsed = JSON.parse(row.payload) as { cap: string; event: string; payload?: unknown };
      send(encode(parsed.cap, parsed.event, parsed.payload));
      acked.push(row.id!);
      replayed += 1;
    } catch {
      // skip malformed
    }
  }
  if (acked.length > 0) {
    buf().markSynced(acked);
    logLine('info', `event-bridge: ${replayed} arabellekli olay panele yeniden oynandı.`);
  }
  return replayed;
}

/** Count of buffered (unreplayed) events — for status/heartbeat telemetry. */
export function bufferedEventCount(): number {
  return buf().count();
}

/** Prune synced events older than the keep window (housekeeping). */
export function pruneBufferedEvents(keepMs = 1000 * 60 * 60 * 24): number {
  return buf().pruneSynced(keepMs);
}

export type { BufferedEvent };
