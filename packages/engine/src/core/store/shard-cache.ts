import type { LoadedDocBytes } from "./doc-store.js";

/**
 * The shard buffer pool seam — a refcounted cache of shard docs. Faults shards in from `faultIn` on
 * first access (lazy disk read); pins (refcount) hold a shard resident across an operation; eviction
 * (over capacity) picks a victim via the {@link EvictionPolicy} and flushes it via `onEvict`
 * (write-back to the DocStore). Memory is O(capacity) regardless of content size — the load-path
 * invariant. The treeDoc does NOT live here — the structure doc is always resident and owned by the
 * outliner directly, never evicted.
 *
 * Generic over the doc type so this file imports no CRDT backend — `ShardedBlockStore` instantiates
 * a `LruShardCache<LoroDoc>` and supplies the Loro-specific `createDoc`/`faultIn`.
 */
export type ShardCache<T> = {
  /** The shard for `id`, faulting it in (await faultIn + createDoc) if cold. Touches the eviction
   *  policy; evicts to fit `capacity`. A pinned shard (refcount > 0) is never evicted. */
  get(id: string): Promise<T>;
  /** Fault + pin atomically: the just-faulted doc is pinned BEFORE eviction runs, so it is never its
   *  own victim. The write path uses this to mark a shard dirty on first fault. */
  getAndPin(id: string): Promise<T>;
  /** Is `id` currently resident? */
  has(id: string): boolean;
  /** Resident [id, doc] entries (insertion order) — for sync push of materialized shards. */
  residentEntries(): [string, T][];
  /** Increment the pin refcount — a pinned shard can't be evicted. The shard must be resident. */
  pin(id: string): void;
  /** Decrement the pin refcount; at zero the shard is evictable again. */
  unpin(id: string): void;
  /** Number of resident shards. */
  readonly size: number;
  /** Evict victims until resident ≤ capacity. Public so the store can reclaim after `flushDirty`
   *  unpins dirty shards — without this an unpinned-but-lingering shard stays resident until the next
   *  fault forces eviction, so resident can exceed capacity at quiescent points. */
  evictToFit(): Promise<void>;
};

/**
 * The eviction-strategy seam: decides WHICH resident shard to evict, given the set of eviction-
 * eligible (already pin-filtered) candidates. The cache owns pin-filtering (mechanism: a pinned shard
 * is never a candidate); the policy only ORDERS the candidates (policy: LRU vs FIFO vs ARC etc.).
 * Swapping eviction strategy means replacing the policy, not the cache. The cache also notifies the
 * policy of access/insert/remove so it can maintain its ordering state.
 */
export type EvictionPolicy = {
  /** A resident shard was accessed (cache hit) — promote per the policy's recency notion. */
  onAccess(id: string): void;
  /** A shard was faulted in (newly resident) — record its arrival. */
  onInsert(id: string): void;
  /** A shard was evicted (no longer resident) — drop it from the policy's ordering state. */
  onRemove(id: string): void;
  /** Pick the next victim from the given (already pin-filtered) candidate ids, or null if the policy
   *  has no opinion (the cache then stops evicting). */
  selectVictim(candidates: Iterable<string>): string | null;
};

/**
 * Least-recently-used eviction: the candidate not accessed for the longest is the victim. Maintains
 * an access-ordered list (LRU at index 0, MRU at the end); access/insert promote to the end;
 * `selectVictim` returns the earliest candidate in that order.
 */
export class LruEvictionPolicy implements EvictionPolicy {
  private readonly order: string[] = [];

  onAccess(id: string): void {
    this.touch(id);
  }

  onInsert(id: string): void {
    this.touch(id);
  }

  onRemove(id: string): void {
    const i = this.order.indexOf(id);
    if (i >= 0) {
      this.order.splice(i, 1);
    }
  }

  selectVictim(candidates: Iterable<string>): string | null {
    const set = candidates instanceof Set ? candidates : new Set(candidates);
    for (const id of this.order) {
      // ponytail: O(order) scan per victim — fine while the resident set stays small (≪ total). A
      // linked-map (id → recency node) makes this O(1) if a profile names it.
      if (set.has(id)) {
        return id;
      }
    }
    return null;
  }

  private touch(id: string): void {
    const i = this.order.indexOf(id);
    if (i >= 0) {
      this.order.splice(i, 1);
    }
    this.order.push(id);
  }
}

export type ShardCacheOptions<T> = {
  /** Fetch the persisted bytes for a cold shard (snapshot + post-snapshot updates), or null if it
   *  has none. Async so the fault can read the DocStore port off the main thread. */
  readonly faultIn: (id: string) => Promise<LoadedDocBytes | null>;
  /** Build a fresh shard doc, importing `bytes` (snapshot + updates replay) if non-null.
   *  Backend-specific (Loro in production). */
  readonly createDoc: (bytes: LoadedDocBytes | null) => T;
  /** Max resident shards. Infinity (default) = never evict. */
  readonly capacity?: number;
  /** Called when a shard is faulted in (diagnostic/test). */
  readonly onFault?: (id: string) => void;
  /** Called when an unpinned shard is evicted. Async so the write-back can await the port. */
  readonly onEvict?: (id: string, doc: T) => void | Promise<void>;
  /** Eviction policy. Default: {@link LruEvictionPolicy}. */
  readonly policy?: EvictionPolicy;
};

/**
 * The production {@link ShardCache}: a Map of resident docs + a refcount pin set + an
 * {@link EvictionPolicy} (LRU by default). Pin-filtering stays here (a pinned shard is never offered
 * to the policy as a candidate); the policy only orders the unpinned candidates.
 */
export class LruShardCache<T> implements ShardCache<T> {
  private readonly pages = new Map<string, T>();
  private readonly pins = new Map<string, number>();
  /** In-flight cold faults, deduped per id so concurrent cold-faults of the SAME shard share one
   *  `createDoc` + `pages.set` — no cache stampede (two createDocs → one orphaned → lost writes).
   *  Cleared in the fault's `finally`, which runs in the same microtask as `pages.set`, so a later
   *  access sees the resident doc (cache hit), not a fresh fault. */
  private readonly pending = new Map<string, Promise<T>>();
  private readonly faultIn: (id: string) => Promise<LoadedDocBytes | null>;
  private readonly createDoc: (bytes: LoadedDocBytes | null) => T;
  private capacity: number;
  private readonly onFault?: (id: string) => void;
  private readonly onEvict?: (id: string, doc: T) => void | Promise<void>;
  private readonly policy: EvictionPolicy;

  constructor(opts: ShardCacheOptions<T>) {
    this.faultIn = opts.faultIn;
    this.createDoc = opts.createDoc;
    this.capacity = opts.capacity ?? Number.POSITIVE_INFINITY;
    this.onFault = opts.onFault;
    this.onEvict = opts.onEvict;
    this.policy = opts.policy ?? new LruEvictionPolicy();
  }

  async get(id: string): Promise<T> {
    const cached = this.pages.get(id);
    if (cached) {
      this.policy.onAccess(id);
      return cached;
    }
    const doc = await this.faultAndSet(id);
    await this.evictToFit();
    return doc;
  }

  async getAndPin(id: string): Promise<T> {
    const cached = this.pages.get(id);
    if (cached) {
      this.policy.onAccess(id);
      this.bumpPin(id);
      return cached;
    }
    const doc = await this.faultAndSet(id);
    // A concurrent `get`'s evictToFit could have evicted the just-faulted doc (it's the only
    // unpinned one when the cache is full of session-pinned shards) before we pin. Re-set the SAME
    // instance (no new createDoc → no stampede) + pin BEFORE our own evictToFit so it is never its
    // own victim.
    if (!this.pages.has(id)) {
      this.pages.set(id, doc);
      this.policy.onInsert(id);
    } else {
      this.policy.onAccess(id);
    }
    this.bumpPin(id);
    await this.evictToFit();
    return doc;
  }

  /** Dedup the cold fault (createDoc + first pages.set) per id — concurrent cold-faults share ONE
   *  doc instance. The pin + evictToFit stay caller-side so the pin refcount is exact. */
  private faultAndSet(id: string): Promise<T> {
    const existing = this.pending.get(id);
    if (existing) {
      return existing;
    }
    const p = (async () => {
      try {
        const doc = this.createDoc(await this.faultIn(id));
        if (!this.pages.has(id)) {
          this.pages.set(id, doc);
          this.policy.onInsert(id);
          this.onFault?.(id);
        }
        return doc;
      } finally {
        this.pending.delete(id);
      }
    })();
    this.pending.set(id, p);
    return p;
  }

  has(id: string): boolean {
    return this.pages.has(id);
  }

  residentEntries(): [string, T][] {
    return [...this.pages.entries()];
  }

  pin(id: string): void {
    if (!this.pages.has(id)) {
      throw new Error(`ShardCache.pin: shard not resident: ${id}`);
    }
    this.bumpPin(id);
  }

  unpin(id: string): void {
    const next = (this.pins.get(id) ?? 0) - 1;
    if (next <= 0) {
      this.pins.delete(id);
    } else {
      this.pins.set(id, next);
    }
  }

  get size(): number {
    return this.pages.size;
  }

  async evictToFit(): Promise<void> {
    while (this.pages.size > this.capacity) {
      const victim = this.policy.selectVictim(this.unpinnedResidentIds());
      if (victim === null) {
        break; // policy has no victim (every resident shard is pinned) — cannot evict further
      }
      const doc = this.pages.get(victim);
      if (doc === undefined) {
        continue;
      }
      this.pages.delete(victim);
      this.policy.onRemove(victim);
      await this.onEvict?.(victim, doc);
    }
  }

  private bumpPin(id: string): void {
    this.pins.set(id, (this.pins.get(id) ?? 0) + 1);
  }

  /** The pin-filtered resident ids — the only candidates the policy may pick from. Pin-filtering is
   *  the cache's mechanism concern (refcount); ordering them is the policy's. */
  private unpinnedResidentIds(): Set<string> {
    const out = new Set<string>();
    for (const id of this.pages.keys()) {
      if (!this.pins.has(id)) {
        out.add(id);
      }
    }
    return out;
  }
}
