// Edge deduplication filters (roadmap §29).
//
// UHF RFID readers re-read the same tag hundreds of times per second; ALPR
// cameras re-read the same plate within a few seconds. Before surfacing an
// event to the panel/cloud, the agent drops reads within a configurable time
// window per distinct key (EPC / plate). Pure — unit-testable.

export class Deduper {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs = 5_000) {}

  /** Returns true when the key is new within the window (should be surfaced). */
  accept(key: string, now = Date.now()): boolean {
    const last = this.seen.get(key);
    if (last != null && now - last < this.windowMs) {
      this.seen.set(key, now);
      return false;
    }
    this.seen.set(key, now);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  /** Drop expired entries to keep the map bounded under sustained traffic. */
  prune(now = Date.now()): number {
    let removed = 0;
    for (const [k, t] of this.seen) {
      if (now - t >= this.windowMs) {
        this.seen.delete(k);
        removed += 1;
      }
    }
    return removed;
  }
}

/** RFID tag deduper keyed by EPC hex string. */
export class TagDeduper extends Deduper {}
