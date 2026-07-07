import type { LoadedDocBytes } from "./doc-store.js";

/**
 * The shard buffer pool — a refcounted LRU cache of shard docs. Faults shards in from `faultIn` on
 * first access (lazy disk read); pins (refcount) hold a shard resident across an operation; eviction
 * (over capacity) picks the least-recently-used UNPINNED shard and flushes it via `onEvict` (write-
 * back to the DocStore). Memory is O(capacity) regardless of content size — the load-path invariant.
 *
 * Generic over the doc type so this file imports no CRDT backend — `ShardedBlockStore` instantiates
 * `ShardCache<LoroDoc>` and supplies the Loro-specific `createDoc`/`faultIn`. The treeDoc does NOT
 * live here — the structure doc is always resident (the load-path invariant) and is owned by the
 * outliner directly, never evicted.
 */
export type ShardCacheOptions<T> = {
  /** Fetch the persisted bytes for a cold shard (snapshot + post-snapshot updates), or null if it
   *  has none. Async so the fault can read the DocStore port off the main thread; today it resolves
   *  a pre-read in-memory entry, Phase 3 swaps in `await DocStore.load` with no signature change. */
  readonly faultIn: (shardId: string) => Promise<LoadedDocBytes | null>;
  /** Build a fresh shard doc, importing `bytes` (snapshot + updates replay) if non-null.
   *  Backend-specific (Loro in production). */
  readonly createDoc: (bytes: LoadedDocBytes | null) => T;
  /** Max resident shards. Infinity (default) = never evict — the Phase 3 setting. */
  readonly capacity?: number;
  /** Called when a shard is faulted in (diagnostic/test — the incremental-undo fault spy). */
  readonly onFault?: (shardId: string) => void;
  /** Called when an unpinned shard is evicted. Async so the write-back (flush a dirty shard to the
   *  DocStore before dropping it) can await the port — without this, evicting an import-dirty shard
   *  would lose its unpersisted bytes. */
  readonly onEvict?: (shardId: string, doc: T) => void | Promise<void>;
};

export class ShardCache<T> {
  private readonly pages = new Map<string, T>();
  private readonly pins = new Map<string, number>();
  /** LRU order, least-recently-used first (index 0). */
  private readonly lru: string[] = [];
  private readonly faultIn: (shardId: string) => Promise<LoadedDocBytes | null>;
  private readonly createDoc: (bytes: LoadedDocBytes | null) => T;
  private capacity: number;
  private readonly onFault?: (shardId: string) => void;
  private readonly onEvict?: (shardId: string, doc: T) => void | Promise<void>;

  constructor(opts: ShardCacheOptions<T>) {
    this.faultIn = opts.faultIn;
    this.createDoc = opts.createDoc;
    this.capacity = opts.capacity ?? Number.POSITIVE_INFINITY;
    this.onFault = opts.onFault;
    this.onEvict = opts.onEvict;
  }

  /** The shard for `shardId`, faulting it in (await faultIn + createDoc) if cold. Touches LRU;
   *  evicts unpinned LRU victims to fit `capacity`. A pinned shard (refcount > 0) is never evicted.
   *  Async so the cold fault can read the DocStore port off-thread; a warm hit pays no await cost in
   *  Phase 3 (the fast path can stay sync once eviction/residency are wired). */
  async get(shardId: string): Promise<T> {
    const cached = this.pages.get(shardId);
    if (cached) {
      this.touch(shardId);
      return cached;
    }
    const doc = this.createDoc(await this.faultIn(shardId));
    this.pages.set(shardId, doc);
    this.lru.push(shardId);
    this.onFault?.(shardId);
    await this.evictToFit();
    return doc;
  }

  /** Fault + pin atomically: the just-faulted doc is pinned BEFORE `evictToFit` runs, so it is never
   *  its own eviction victim. Without this, a capacity-bound cache full of pinned-dirty shards would
   *  evict a newly-faulted write target (the only unpinned resident) the moment it faults. The write
   *  path uses this to mark a shard dirty on first fault. */
  async getAndPin(shardId: string): Promise<T> {
    const cached = this.pages.get(shardId);
    if (cached) {
      this.touch(shardId);
      this.pins.set(shardId, (this.pins.get(shardId) ?? 0) + 1);
      return cached;
    }
    const doc = this.createDoc(await this.faultIn(shardId));
    this.pages.set(shardId, doc);
    this.lru.push(shardId);
    this.pins.set(shardId, (this.pins.get(shardId) ?? 0) + 1); // pin BEFORE evictToFit
    this.onFault?.(shardId);
    await this.evictToFit();
    return doc;
  }

  /** Is `shardId` currently resident? */
  has(shardId: string): boolean {
    return this.pages.has(shardId);
  }

  /** Resident [shardId, doc] entries (insertion order) — for sync push of materialized shards. */
  residentEntries(): [string, T][] {
    return [...this.pages.entries()];
  }

  /** Increment the pin refcount — a pinned shard can't be evicted. The shard must be resident
   *  (call `get` first). Phase 4's ensureResident pins the operation's working set. */
  pin(shardId: string): void {
    if (!this.pages.has(shardId)) {
      throw new Error(`ShardCache.pin: shard not resident: ${shardId}`);
    }
    this.pins.set(shardId, (this.pins.get(shardId) ?? 0) + 1);
  }

  /** Decrement the pin refcount; at zero the shard is evictable again. */
  unpin(shardId: string): void {
    const next = (this.pins.get(shardId) ?? 0) - 1;
    if (next <= 0) {
      this.pins.delete(shardId);
    } else {
      this.pins.set(shardId, next);
    }
  }

  /** Number of resident shards. */
  get size(): number {
    return this.pages.size;
  }

  private touch(shardId: string): void {
    const i = this.lru.indexOf(shardId);
    if (i >= 0) {
      this.lru.splice(i, 1);
    }
    this.lru.push(shardId);
  }

  /** Evict unpinned LRU victims until resident ≤ capacity. Async — `onEvict` may flush a dirty shard
   *  to the DocStore (write-back) before dropping it. Public so the store can reclaim after
   *  `persistDirtyShards` unpins dirty shards — without this, an unpinned-but-lingering shard stays
   *  resident until the next fault forces eviction, so resident can exceed capacity at quiescent
   *  points. Called after the persist loop to keep the residency bound tight. */
  async evictToFit(): Promise<void> {
    // ponytail: O(resident) find per victim — fine while the unpinned set stays small (the Phase 5
    // target: resident ≪ total). A per-entry LRU node with a pin flag is the upgrade if a profile names it.
    while (this.pages.size > this.capacity) {
      const victim = this.lru.find((id) => !this.pins.has(id));
      if (victim === undefined) {
        break; // every resident shard is pinned — cannot evict further
      }
      const doc = this.pages.get(victim);
      if (doc === undefined) {
        continue;
      }
      this.pages.delete(victim);
      const li = this.lru.indexOf(victim);
      if (li >= 0) {
        this.lru.splice(li, 1);
      }
      await this.onEvict?.(victim, doc);
    }
  }
}
