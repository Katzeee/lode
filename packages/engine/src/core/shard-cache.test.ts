import { describe, expect, it, vi } from "vitest";
import type { LoadedDocBytes } from "./doc-store.js";
import { ShardCache } from "./shard-cache.js";

/** A fake shard doc — the cache is generic, so the unit tests need no CRDT backend. Carries the
 *  bytes it was built from so a test can assert what the fault fed to `createDoc`. */
type FakeDoc = { id: number; bytes: LoadedDocBytes | null };

const newCache = (opts: {
  capacity?: number;
  onEvict?: (id: string, doc: FakeDoc) => void;
  snaps?: Map<string, LoadedDocBytes>;
}) => {
  const snaps = opts.snaps ?? new Map<string, LoadedDocBytes>();
  let counter = 0;
  const faultIn = vi.fn((id: string): Promise<LoadedDocBytes | null> =>
    Promise.resolve(snaps.get(id) ?? null),
  );
  const createDoc = vi.fn((bytes: LoadedDocBytes | null): FakeDoc => ({ id: ++counter, bytes }));
  const cache = new ShardCache<FakeDoc>({
    faultIn,
    createDoc,
    capacity: opts.capacity,
    onEvict: opts.onEvict,
  });
  return { cache, faultIn, createDoc, snaps };
};

const snap = (bytes: number[]): LoadedDocBytes => ({
  snapshot: new Uint8Array(bytes),
  updates: [],
});

describe("ShardCache", () => {
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
});
