import type { DocStore } from "./doc-store.js";
import type { SyncBytes, SyncableDoc } from "./syncable.js";

/**
 * The persistence-strategy seam: turns "this `SyncableDoc` changed" into durable bytes on a
 * `DocStore`, tracking per-doc cursors so each flush writes only the incremental delta (with periodic
 * snapshot compaction). CRDT-agnostic — it speaks ONLY the opaque `SyncableDoc` export surface +
 * the `DocStore` port, never the backend (loro-crdt). Swapping persistence strategy (incremental-vs-
 * snapshot cadence, snapshot-only, a future log-structured sink) means replacing THIS class, not
 * `ShardedBlockStore`. Constructed only in persistent mode (a `DocStore` is present); in-memory mode
 * has no durable sink and no persister.
 *
 * Per doc id (the OUTWARD `SyncableDoc.id` — `sys:tree` / `sys:s{k}`):
 *   - `lastPersistedVersion` — the opaque version baseline; `exportUpdate(from)` exports only ops
 *     beyond it, so a flush is O(delta), not O(doc). Tracked for every flushed doc.
 *   - `persistedRevision` — the store-side dirty-counter at the last flush. The dirty gate
 *     (`storeRevision > persistedRevision`) lets a caller skip a clean shard WITHOUT faulting it just
 *     to re-export. Tracked ONLY for gated docs (shards); the always-flushed tree omits it. Treated as
 *     an opaque dirty-token: stored on flush, read back by the gate, never interpreted here.
 *
 * Both advance together at the end of a successful `flushDoc`, so a flush that throws leaves the
 * doc still-dirty (re-tried on the next pass) rather than silently marking a half-flush clean.
 */
export class ShardPersister {
  private readonly docStore: DocStore;
  private readonly snapshotEveryUpdates: number;
  private readonly lastPersistedVersion = new Map<string, SyncBytes>();
  private readonly persistedRevision = new Map<string, number>();

  constructor(opts: { docStore: DocStore; snapshotEveryUpdates: number }) {
    this.docStore = opts.docStore;
    this.snapshotEveryUpdates = opts.snapshotEveryUpdates;
  }

  /** The revision recorded at this doc's last flush (0 = never flushed). The dirty gate. */
  persistedRevisionOf(id: string): number {
    return this.persistedRevision.get(id) ?? 0;
  }

  /** Initialize a doc's version cursor to an already-persisted state WITHOUT writing — used for the
   *  always-resident tree, which is loaded eagerly from persistence on restart. Without this, a fresh
   *  persister's undefined cursor would make the first post-restart `flushDoc` re-export the ENTIRE
   *  tree oplog instead of just the new delta (write amplification every restart). `version` is the
   *  doc's current opaque version (captured by the store right after it imports the reloaded bytes). */
  seedCursor(id: string, version: SyncBytes): void {
    this.lastPersistedVersion.set(id, version);
  }

  /** Flush one doc's incremental delta since its cursor + advance the cursor. No write if the delta
   *  is empty (the doc is clean at the byte level — a no-op flush still records the cursor). Shared by
   *  the post-mutation flush and the evict write-back; the caller owns pin/evict policy (this method
   *  is just bytes).
   *
   *  `revision`, when provided, is the doc's current store-side dirty-counter, recorded as the new
   *  persisted baseline so the dirty gate (`storeRevision > persistedRevision`) can skip the doc next
   *  pass WITHOUT faulting it to re-export. Omitted for docs that have no dirty gate — the always-
   *  resident tree, which is flushed unconditionally (its `exportUpdate` IS the dirty check: an
   *  unchanged tree yields an empty delta → no write), so it tracks a cursor but no gate counter.
   *
   *  The new cursor is captured BEFORE the export. Under the engine's sequential mutation model the
   *  two reads land on the same state; the reason to prefer before is overlap-safety — if a concurrent
   *  edit ever slipped between the version-read and the export, a pre-captured cursor makes the next
   *  flush re-export a harmless overlap (CRDT import is idempotent), whereas a post-captured cursor
   *  would skip a delta. Data-loss paths take the safer failure mode. */
  async flushDoc(doc: SyncableDoc, revision?: number): Promise<void> {
    const from = this.lastPersistedVersion.get(doc.id);
    const currentVersion = await doc.version();
    const delta = await doc.exportUpdate(from);
    if (delta.length > 0) {
      const seq = await this.docStore.appendUpdate(doc.id, delta);
      if (seq % this.snapshotEveryUpdates === 0) {
        await this.docStore.writeSnapshot(doc.id, await doc.exportSnapshot());
      }
    }
    this.lastPersistedVersion.set(doc.id, currentVersion);
    if (revision !== undefined) {
      this.persistedRevision.set(doc.id, revision);
    }
  }
}
