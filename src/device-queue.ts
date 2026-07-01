// Per-device command serialization (roadmap §34, enterprise §5 thread isolation).
//
// The DriverHost routes a command to the right capability driver, but a single
// physical device may serve multiple capabilities (a thermal printer that also
// drives the drawer; an IP camera that does both ONVIF and ALPR). This module
// serializes work per physical device key so commands to the same device run
// strictly in order (FIFO), while different devices run in parallel. A slow or
// hung device therefore never blocks another — the core enterprise §5 promise.

export type DeviceKey = string;

interface QueueItem {
  fn: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const queues = new Map<DeviceKey, QueueItem[]>();
const busy = new Set<DeviceKey>();

/**
 * Run `fn` serialized per `key`. Concurrent calls with the same key run in
 * FIFO order; calls with different keys run in parallel. Resolves with fn's
 * result or rejects with its error.
 */
export function runOnDevice<T>(key: DeviceKey, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const item: QueueItem = { fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject };
    const list = queues.get(key);
    if (list) {
      list.push(item);
    } else {
      queues.set(key, [item]);
    }
    void drain(key);
  });
}

async function drain(key: DeviceKey): Promise<void> {
  if (busy.has(key)) return;
  const list = queues.get(key);
  if (!list || list.length === 0) return;
  busy.add(key);
  const item = list.shift()!;
  try {
    const v = await item.fn();
    item.resolve(v);
  } catch (e) {
    item.reject(e);
  } finally {
    busy.delete(key);
    if (list.length > 0) {
      void drain(key);
    } else {
      queues.delete(key);
    }
  }
}

/** Test helper: reset all queues. */
export function resetDeviceQueues(): void {
  queues.clear();
  busy.clear();
}

/** Introspection: how many keys currently have pending work. */
export function pendingDeviceKeys(): number {
  return queues.size;
}
