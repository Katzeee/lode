import type { DocStore, LoadedDocBytes } from "./doc-store.js";
import type { SyncBytes } from "./syncable.js";

/**
 * The in-memory `DocStore`: a Map-backed `(id → bytes)` store for tests, ephemeral clones, and any
 * mode with no durable sink. Same contract as the persistent adapter, so `ShardedBlockStore` holds
 * exactly ONE byte owner (a `DocStore`) in every mode — "is this in-memory?" becomes "which
 * `DocStore` impl was injected", not a scatter of `if (persister)` / `if (docStore)` branches.
 *
 * The optional seed pre-populates a doc's bytes (snapshot + post-snapshot updates) — how a clone
 * or reload hands the store its starting shards without first writing through the port.
 *
 * Methods return `Promise`s (the `DocStore` contract is async — the persistent adapter reads a
 * sqlite leaf off the main thread) but resolve synchronously: the work is in-memory Map ops.
 */
export class InMemoryDocStore implements DocStore {
  private readonly snapshots = new Map<string, SyncBytes>();
  private readonly updates = new Map<string, SyncBytes[]>();
  private readonly seqs = new Map<string, number>();

  constructor(seed?: Map<string, LoadedDocBytes>) {
    if (seed) {
      for (const [id, bytes] of seed) {
        if (bytes.snapshot) {
          this.snapshots.set(id, bytes.snapshot);
        }
        if (bytes.updates.length > 0) {
          this.updates.set(id, [...bytes.updates]);
        }
      }
    }
  }

  load(id: string): Promise<LoadedDocBytes | null> {
    if (!this.snapshots.has(id) && !this.updates.has(id)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      snapshot: this.snapshots.get(id) ?? null,
      updates: this.updates.get(id) ?? [],
    });
  }

  listIds(): Promise<string[]> {
    return Promise.resolve([...new Set([...this.snapshots.keys(), ...this.updates.keys()])]);
  }

  appendUpdate(id: string, bytes: SyncBytes): Promise<number> {
    const list = this.updates.get(id);
    if (list) {
      list.push(bytes);
    } else {
      this.updates.set(id, [bytes]);
    }
    const seq = (this.seqs.get(id) ?? 0) + 1;
    this.seqs.set(id, seq);
    return Promise.resolve(seq);
  }

  writeSnapshot(id: string, bytes: SyncBytes): Promise<void> {
    // A snapshot covers the doc's latest state, so the now-subsumed updates are dropped — matching
    // the persistent leaf's `coveredUpdateSeq` compaction. Subsequent appends start a fresh tail.
    this.snapshots.set(id, bytes);
    this.updates.delete(id);
    return Promise.resolve();
  }
}
