import { describe, expect, it, vi } from "vitest";
import type { LoadedDocBytes } from "./doc-store.js";
import { LruShardCache, type EvictionPolicy } from "./shard-cache.js";

/** A fake shard doc — the cache is generic, so the unit tests need no CRDT backend. Carries the
 *  bytes it was built from so a test can assert what the fault fed to `createDoc`. */
type FakeDoc = { id: number; bytes: LoadedDocBytes | null };

const newCache = (opts: {
  capacity?: number;
  onEvict?: (id: string, doc: FakeDoc) => void;
  snaps?: Map<string, LoadedDocBytes>;
  policy?: EvictionPolicy;
}) => {
  const snaps = opts.snaps ?? new Map<string, LoadedDocBytes>();
  let counter = 0;
  const faultIn = vi.fn((id: string): Promise<LoadedDocBytes | null> =>
    Promise.resolve(snaps.get(id) ?? null),
  );
  const createDoc = vi.fn((bytes: LoadedDocBytes | null): FakeDoc => ({ id: ++counter, bytes }));
  const cache = new LruShardCache<FakeDoc>({
    faultIn,
    createDoc,
    capacity: opts.capacity,
    onEvict: opts.onEvict,
    policy: opts.policy,
  });
  return { cache, faultIn, createDoc, snaps };
};

const snap = (bytes: number[]): LoadedDocBytes => ({
  snapshot: new Uint8Array(bytes),
  updates: [],
});

describe("LruShardCache", () => {
  it("faults a shard in once; later gets reuse the cached doc (faultIn + createDoc called once)", async () => {
    const { cache, faultIn, createDoc } = newCache({});
    const first = await cache.get("s0");
    const second = await cache.get("s0");
    expect(first).toBe(second);
    expect(createDoc).toHaveBeenCalledTimes(1);
    expect(faultIn).toHaveBeenCalledTimes(1);
  });

  it("passes the faulted bytes to createDoc; null when the shard has no snapshot", async () => {
    const snaps = new Map([["s0", snap([1, 2, 3])]]);
    const { cache, createDoc } = newCache({ snaps });
    await cache.get("s0"); // has bytes
    await cache.get("s1"); // no bytes
    expect(createDoc.mock.calls[0]?.[0]).toEqual(snap([1, 2, 3]));
    expect(createDoc.mock.calls[1]?.[0]).toBeNull();
  });

  it("LRU evicts the least-recently-used unpinned shard when over capacity", async () => {
    const evicted: string[] = [];
    const { cache } = newCache({ capacity: 1, onEvict: (id) => evicted.push(id) });
    await cache.get("s0");
    await cache.get("s1"); // over capacity → evict s0 (LRU front, unpinned)
    expect(cache.has("s0")).toBe(false);
    expect(cache.has("s1")).toBe(true);
    expect(evicted).toEqual(["s0"]);
  });

  it("LRU order follows access, not insertion (a get promotes to back)", async () => {
    const evicted: string[] = [];
    const { cache } = newCache({ capacity: 2, onEvict: (id) => evicted.push(id) });
    await cache.get("s0");
    await cache.get("s1");
    await cache.get("s0"); // promote s0 → LRU is now [s1, s0]
    await cache.get("s2"); // over capacity → evict s1 (front)
    expect(cache.has("s0")).toBe(true);
    expect(evicted).toEqual(["s1"]);
  });

  it("a pinned shard is never evicted (refcount > 0 protects it; a younger unpinned shard goes)", async () => {
    const evicted: string[] = [];
    const { cache } = newCache({ capacity: 2, onEvict: (id) => evicted.push(id) });
    await cache.get("s0");
    cache.pin("s0");
    await cache.get("s1");
    await cache.get("s2"); // over capacity; s0 pinned → evict s1
    expect(cache.has("s0")).toBe(true);
    expect(cache.has("s1")).toBe(false);
    expect(evicted).toEqual(["s1"]);
  });

  it("once refcount drops to zero, the shard is evictable again", async () => {
    const evicted: string[] = [];
    const { cache } = newCache({ capacity: 1, onEvict: (id) => evicted.push(id) });
    await cache.get("s0");
    cache.pin("s0");
    await cache.get("s1"); // s0 pinned → s1 evicted to fit
    expect(cache.has("s0")).toBe(true);
    cache.unpin("s0");
    await cache.get("s2"); // s0 now evictable, LRU front → evicted
    expect(cache.has("s0")).toBe(false);
  });

  it("eviction flushes the dirty doc via onEvict", async () => {
    const flushed: { id: string; doc: FakeDoc }[] = [];
    const { cache } = newCache({ capacity: 1, onEvict: (id, doc) => flushed.push({ id, doc }) });
    const doc = await cache.get("s0");
    await cache.get("s1"); // evict s0
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.id).toBe("s0");
    expect(flushed[0]?.doc).toBe(doc);
  });

  it("capacity ∞ (default) never evicts, regardless of pin state", async () => {
    const evicted: string[] = [];
    const { cache } = newCache({ onEvict: (id) => evicted.push(id) });
    for (let i = 0; i < 50; i++) {
      await cache.get(`s${i}`);
    }
    expect(cache.size).toBe(50);
    expect(evicted).toEqual([]);
  });

  it("pin requires the shard to be resident", () => {
    const { cache } = newCache({});
    expect(() => cache.pin("absent")).toThrow(/not resident/);
  });

  it("concurrent cold-faults of the same shard share one createDoc (no cache stampede → no orphan)", async () => {
    // A controllable faultIn that doesn't resolve until the test releases it — two callers racing
    // the same cold fault. Without dedup each would createDoc → the second overwrites pages → the
    // first's doc is orphaned → its writes lost. With dedup they share ONE doc instance.
    let resolveFault!: (bytes: LoadedDocBytes | null) => void;
    const faultIn = vi.fn(
      (_id: string) =>
        new Promise<LoadedDocBytes | null>((res) => {
          resolveFault = res;
        }),
    );
    const createDoc = vi.fn((bytes: LoadedDocBytes | null): FakeDoc => ({ id: 0, bytes }));
    const cache = new LruShardCache<FakeDoc>({ faultIn, createDoc });

    const p1 = cache.get("s0");
    const p2 = cache.get("s0");
    expect(faultIn).toHaveBeenCalledTimes(1); // deduped: only one in-flight fault
    resolveFault(snap([1, 2, 3]));
    const [d1, d2] = await Promise.all([p1, p2]);
    expect(d1).toBe(d2); // SAME instance — no orphan
    expect(createDoc).toHaveBeenCalledTimes(1);
  });

  it("concurrent get + getAndPin of the same shard share one createDoc; the pin still applies", async () => {
    let resolveFault!: (bytes: LoadedDocBytes | null) => void;
    const faultIn = vi.fn(
      (_id: string) =>
        new Promise<LoadedDocBytes | null>((res) => {
          resolveFault = res;
        }),
    );
    const createDoc = vi.fn((bytes: LoadedDocBytes | null): FakeDoc => ({ id: 0, bytes }));
    const cache = new LruShardCache<FakeDoc>({ faultIn, createDoc });

    const pGet = cache.get("s0");
    const pPin = cache.getAndPin("s0");
    resolveFault(snap([7]));
    const [dGet, dPin] = await Promise.all([pGet, pPin]);
    expect(dGet).toBe(dPin); // SAME instance
    expect(createDoc).toHaveBeenCalledTimes(1);
    cache.unpin("s0"); // the getAndPin's pin was applied (balanced unpin doesn't throw)
  });
});

/** FIFO eviction: the OLDEST resident (insertion order, ignoring later accesses) is the victim.
 *  Substituted into LruShardCache to prove EvictionPolicy is a real seam, not structurally coupled. */
class FifoEvictionPolicy implements EvictionPolicy {
  private readonly inserted: string[] = [];
  onAccess(): void {
    // FIFO ignores accesses — only insertion order matters.
  }
  onInsert(id: string): void {
    this.inserted.push(id);
  }
  onRemove(id: string): void {
    const i = this.inserted.indexOf(id);
    if (i >= 0) {
      this.inserted.splice(i, 1);
    }
  }
  selectVictim(candidates: Iterable<string>): string | null {
    const set = candidates instanceof Set ? candidates : new Set(candidates);
    return this.inserted.find((id) => set.has(id)) ?? null;
  }
}

describe("EvictionPolicy seam: a substitute policy changes eviction behavior", () => {
  it("FIFO evicts the oldest resident even if it was accessed most recently (unlike LRU)", async () => {
    const evicted: string[] = [];
    const { cache } = newCache({
      capacity: 2,
      policy: new FifoEvictionPolicy(),
      onEvict: (id) => evicted.push(id),
    });
    await cache.get("s0");
    await cache.get("s1");
    await cache.get("s0"); // LRU would promote s0; FIFO must NOT — s0 stays oldest by insertion
    await cache.get("s2"); // over capacity → FIFO evicts s0 (first inserted), not s1
    expect(cache.has("s0")).toBe(false);
    expect(cache.has("s1")).toBe(true);
    expect(evicted).toEqual(["s0"]);
  });
});
