import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Engine } from "./engine.js";
import { ShardedBlockStore } from "./sharded-store.js";
import { shardIdOf } from "./sharding.js";
import { SYS_PREFIX } from "./syncable.js";
import type { ShardCache } from "./shard-cache.js";
import type { DocStore, LoadedDocBytes } from "./doc-store.js";
import { InMemoryDocStore } from "./in-memory-doc-store.js";
import { validateSnapshot } from "./invariant.js";
import { toJSON } from "./serializers/json.js";

/** A round-tripping in-memory DocStore that records writes + reconstructs on load — lets tests
 *  exercise the lazy fault + write-back (evict-flush) path without a real sqlite sink. */
function recordingDocStore(): DocStore & {
  recs: Map<string, { updates: Uint8Array[]; snapshots: Uint8Array[]; seq: number }>;
} {
  const recs = new Map<string, { updates: Uint8Array[]; snapshots: Uint8Array[]; seq: number }>();
  const rec = (id: string) => {
    let r = recs.get(id);
    if (!r) {
      r = { updates: [], snapshots: [], seq: 0 };
      recs.set(id, r);
    }
    return r;
  };
  return {
    recs,
    load: (id) => {
      const r = recs.get(id);
      return Promise.resolve(
        r ? { snapshot: r.snapshots.at(-1) ?? null, updates: [...r.updates] } : null,
      );
    },
    listIds: () => Promise.resolve([...recs.keys()]),
    appendUpdate: (id, bytes) => {
      const r = rec(id);
      r.updates.push(bytes);
      return Promise.resolve(++r.seq);
    },
    writeSnapshot: (id, bytes) => {
      rec(id).snapshots.push(bytes);
      return Promise.resolve();
    },
  };
}
import type { Delta, OccurrenceId } from "./types.js";

const textToDelta = (s: string): Delta => [{ insert: s }];

describe("ShardedBlockStore smoke: full production data model round-trips, structurally valid", () => {
  it("content + marks read back from shards; occurrence/entity props+meta survive", async () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
    const root = await e.createNode(null);
    const a = await e.createNode(root.occurrenceId, undefined, { kind: "page" });
    await e.replaceDeltas(a.occurrenceId, textToDelta("hello world"));
    await e.mark(a.occurrenceId, { start: 0, end: 5 }, "bold", true);
    await e.setOccurrenceMeta(a.occurrenceId, "managed", { kind: "fieldSlot" });
    await e.setEntityMeta(a.occurrenceId, "updated", 1);

    // Content + marks resolve from the shard (read via the original occurrence).
    expect((await e.getOccurrence(a.occurrenceId))?.deltas).toEqual([
      { insert: "hello", attributes: { bold: true } },
      { insert: " world" },
    ]);
    expect(e.getOccurrenceMetaRecord(a.occurrenceId)).toEqual({ managed: { kind: "fieldSlot" } });
    expect(await e.getEntityMetaRecord(a.occurrenceId)).toEqual({ updated: 1 });

    validateSnapshot(await toJSON(e));
  });

  it("shards fan out across multiple docs and the snapshot stays valid", async () => {
    const store = new ShardedBlockStore({ numShards: 4 });
    const e = new Engine({ store });
    const root = await e.createNode(null);
    for (let i = 0; i < 40; i++) {
      await e.createNode(root.occurrenceId);
    }
    expect(store.shardIds().length).toBeGreaterThan(1); // fan-out happened
    validateSnapshot(await toJSON(e));
  });

  it("the cycle guard rejects a cycle-forming move cleanly (no WASM abort)", async () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 4 }) });
    const root = await e.createNode(null);
    const a = await e.createNode(root.occurrenceId); // a is parent of b
    const b = await e.createNode(a.occurrenceId);
    await expect(e.moveOccurrence(a.occurrenceId, b.occurrenceId)).rejects.toThrow(/cycle/i);
    validateSnapshot(await toJSON(e));
  });
});

describe("Outliner working-set session: ensureResident + the residency assertion", () => {
  it("a session op materializes only the declared shard (not every shard)", async () => {
    const numShards = 8;
    const seed = new ShardedBlockStore({ numShards });
    const seedEngine = new Engine({ store: seed });
    const root = await seedEngine.createNode(null);
    const childIds: string[] = [];
    for (let i = 0; i < 40; i++) {
      childIds.push((await seedEngine.createNode(root.occurrenceId)).nodeId);
    }
    seedEngine.captureSync();
    expect(seed.shardIds().length).toBeGreaterThan(1); // fanned across shards

    // Reload cold: tree eager, shards seeded into an InMemoryDocStore (in-memory clone — LoroDocs
    // NOT resident until faulted).
    const treeDoc = seed.treeSyncDoc();
    const treeBytes: LoadedDocBytes = { snapshot: await treeDoc.exportSnapshot(), updates: [] };
    const shardSeed = new Map<string, LoadedDocBytes>();
    for (const d of seed.shardSyncDocs()) {
      shardSeed.set(d.id, { snapshot: await d.exportSnapshot(), updates: [] });
    }
    const faults: string[] = [];
    const store = new ShardedBlockStore({
      numShards,
      treeBytes,
      docStore: new InMemoryDocStore(shardSeed),
      onFault: (id) => faults.push(id),
    });
    const e = new Engine({ store });

    // Declare a session over ONE child; ensureResident faults only its shard, the mutation touches
    // no other, and the other 39 children's shards stay cold.
    const target = childIds.at(0)!;
    const targetShard = shardIdOf(target, numShards);
    await store.ensureResident([target]);
    const targetOcc = await e.getCanonicalOccurrenceId(target); // resident now → no new fault
    await e.replaceDeltas(targetOcc, [{ insert: "x" }]);
    store.release();
    expect(new Set(faults)).toEqual(new Set([targetShard]));
  });

  it("touching a shard outside the declared working set throws (undeclared boundary)", async () => {
    // "root" → s1, "child" → s7 at numShards=8: different shards.
    const ids = ["root", "child"];
    let i = 0;
    const gen = (): string => ids[i++] ?? `x${i}`;
    const store = new ShardedBlockStore({ numShards: 8 });
    const e = new Engine({ store, nodeIdGenerator: gen });
    const root = await e.createNode(null); // s1
    const child = await e.createNode(root.occurrenceId); // s7

    await store.ensureResident([root.nodeId]); // declare s1 only
    await expect(e.replaceDeltas(child.occurrenceId, [{ insert: "x" }])).rejects.toThrow(
      /working set/,
    );
    store.release();
  });

  it("inside a session a declared shard is reachable; outside, no assertion", async () => {
    const store = new ShardedBlockStore({ numShards: 8 });
    const e = new Engine({ store });
    const root = await e.createNode(null);
    const child = await e.createNode(root.occurrenceId);

    await store.ensureResident([child.nodeId]);
    await expect(e.replaceDeltas(child.occurrenceId, [{ insert: "x" }])).resolves.toBeUndefined();
    store.release();
    // Outside a session, shard access faults freely (no assertion) — today's behavior.
    await expect(e.replaceDeltas(root.occurrenceId, [{ insert: "y" }])).resolves.toBeUndefined();
  });

  it("ensureResident during an active session throws; release is idempotent", async () => {
    const store = new ShardedBlockStore({ numShards: 8 });
    const e = new Engine({ store });
    const root = await e.createNode(null);

    await store.ensureResident([root.nodeId]);
    await expect(store.ensureResident([root.nodeId])).rejects.toThrow(/already active/);
    store.release();
    store.release(); // idempotent — no-op without a session
  });
});

describe("eviction (Phase 5): finite capacity bounds resident LoroDocs; re-fault preserves mutations", () => {
  it("resident shards stay ≤ capacity across edits that span many shards", async () => {
    const numShards = 16;
    const capacity = 4;
    const store = new ShardedBlockStore({
      numShards,
      capacity,
      docStore: recordingDocStore(),
      snapshotEveryUpdates: Number.POSITIVE_INFINITY,
    });
    const e = new Engine({ store });
    const root = await e.createNode(null);
    const occs: OccurrenceId[] = [];
    for (let i = 0; i < 80; i++) {
      occs.push((await e.createNode(root.occurrenceId)).occurrenceId);
    }
    e.captureSync();
    // Flush the create-batch's dirty shards (the real lifecycle persists after each op) so the
    // cache can reclaim before the edit storm.
    await store.flushDirty();
    // Edit nodes whose entities live across the shard space; persist+evict after each so resident ≤ capacity.
    for (const occ of occs) {
      await e.replaceDeltas(occ, [{ insert: "x" }]);
      e.captureSync();
      await store.flushDirty();
      expect(store.residentShardCount).toBeLessThanOrEqual(capacity);
    }
    expect(store.residentShardCount).toBeGreaterThan(0);
    expect(store.residentShardCount).toBeLessThanOrEqual(capacity);
  });

  it("evict→re-fault round-trip preserves a mutation (onEvict writes the dirty shard back)", async () => {
    // "root" → s1, "child" → s7 at numShards=8: different shards. capacity 1 evicts on every cross-shard touch.
    const ids = ["root", "child"];
    let i = 0;
    const gen = (): string => ids[i++] ?? `x${i}`;
    const docStore = recordingDocStore();
    const store = new ShardedBlockStore({
      numShards: 8,
      capacity: 1,
      docStore,
      snapshotEveryUpdates: Number.POSITIVE_INFINITY,
    });
    const e = new Engine({ store, nodeIdGenerator: gen });
    const root = await e.createNode(null); // s1
    const child = await e.createNode(root.occurrenceId); // s7
    await e.replaceDeltas(child.occurrenceId, [{ insert: "kept" }]); // mutate s7
    e.captureSync();
    // Flush s7's mutation so it's clean — the subsequent s1 fault then evicts s7 with an empty onEvict
    // delta (no extra write). Post-Phase-3 a dirty shard isn't pinned, so it COULD evict via onEvict
    // flush too; flushing first just keeps the test's eviction a clean one.
    await store.flushDirty();
    // Touch root (s1) → fault s1 → evict s7 (onEvict flushes "kept" to the DocStore). Only s1 resident.
    await e.replaceDeltas(root.occurrenceId, [{ insert: "root-text" }]);
    e.captureSync();
    expect(store.residentShardCount).toBe(1);
    // Re-fault s7 by reading child → "kept" survives (re-fault reads the persisted bytes back).
    expect((await e.getOccurrence(child.occurrenceId))?.deltas).toEqual([{ insert: "kept" }]);
  });
});

describe("incremental persistence (Phase 2): dirty-only + delta writes + replay", () => {
  const shardOf = (nodeId: string, numShards: number): string =>
    SYS_PREFIX + shardIdOf(nodeId, numShards);

  it("persists only dirty shards (a clean shard is not faulted or written again)", async () => {
    const numShards = 256;
    const spy = recordingDocStore();
    const store = new ShardedBlockStore({
      numShards,
      docStore: spy,
      snapshotEveryUpdates: Number.POSITIVE_INFINITY,
    });
    const e = new Engine({ store });
    const a = await e.createNode(null);
    await e.replaceDeltas(a.occurrenceId, [{ insert: "a" }]);
    const b = await e.createNode(null);
    await e.replaceDeltas(b.occurrenceId, [{ insert: "b" }]);
    e.captureSync();
    await store.flushDirty();
    const aShard = shardOf(a.nodeId, numShards);
    const bShard = shardOf(b.nodeId, numShards);
    // a + b were both dirty on first persist → both written once.
    expect(spy.recs.get(aShard)?.updates).toHaveLength(1);
    expect(spy.recs.get(bShard)?.updates).toHaveLength(1);
    // Edit ONLY a → only a's shard advances on the next persist; b's is untouched.
    await e.replaceDeltas(a.occurrenceId, [{ insert: "a2" }]);
    e.captureSync();
    await store.flushDirty();
    expect(spy.recs.get(aShard)?.updates).toHaveLength(2);
    expect(spy.recs.get(bShard)?.updates).toHaveLength(1);
  });

  it("a small edit to a large content node writes O(delta), not the full content", async () => {
    const numShards = 256;
    const spy = recordingDocStore();
    const store = new ShardedBlockStore({
      numShards,
      docStore: spy,
      snapshotEveryUpdates: Number.POSITIVE_INFINITY,
    });
    const e = new Engine({ store });
    const node = await e.createNode(null);
    await e.replaceDeltas(node.occurrenceId, [{ insert: "x".repeat(50_000) }]);
    e.captureSync();
    await store.flushDirty(); // full first write (sets cursor)
    const shard = shardOf(node.nodeId, numShards);
    const fullSize = spy.recs.get(shard)?.updates.at(-1)?.length ?? 0;
    // One-char edit → the next persist exports only the delta from the last cursor.
    await e.replaceDeltas(node.occurrenceId, [{ insert: "y" }]);
    e.captureSync();
    await store.flushDirty();
    const deltaSize = spy.recs.get(shard)?.updates.at(-1)?.length ?? 0;
    expect(deltaSize).toBeGreaterThan(0);
    expect(deltaSize).toBeLessThan(fullSize / 100); // delta ≪ full (no write amplification)
  });

  it("reloading from snapshot + replayed updates reconstructs the same state", async () => {
    const numShards = 256;
    const spy = recordingDocStore();
    const store = new ShardedBlockStore({ numShards, docStore: spy, snapshotEveryUpdates: 1 });
    const e = new Engine({ store });
    const node = await e.createNode(null);
    await e.replaceDeltas(node.occurrenceId, [{ insert: "hello" }]);
    e.captureSync();
    await e.replaceDeltas(node.occurrenceId, [{ insert: "world" }]);
    e.captureSync();
    // snapshotEveryUpdates=1 → a snapshot is taken every persist (compaction), exercising both the
    // snapshot + the post-snapshot update stream on reload.
    await store.flushDirty();
    // Reload: tree eager from the source tree snapshot, shards fault LAZILY from the spy (which now
    // holds each shard's last snapshot + appended updates — exactly what a real DocStore persists).
    const treeBytes: LoadedDocBytes = {
      snapshot: await store.treeSyncDoc().exportSnapshot(),
      updates: [],
    };
    const reloaded = new ShardedBlockStore({
      numShards,
      treeBytes,
      docStore: spy,
      snapshotEveryUpdates: 1,
    });
    const e2 = new Engine({ store: reloaded });
    expect((await e2.getOccurrence(node.occurrenceId))?.deltas).toEqual([{ insert: "world" }]);
  });
});

describe("ShardCache seam: the store depends on the interface, not the LRU impl", () => {
  it("an injected ShardCache double is used in place of the default LruShardCache", async () => {
    // A hand-rolled ShardCache double records getAndPin + returns a throwaway doc. The store accepts
    // it via `shardCache` (typed against the ShardCache interface) — a different implementation slots
    // in with zero caller change, proving the cache axis is a nominal seam.
    const calls: string[] = [];
    const rec = (tag: string, id: string): Promise<LoroDoc> => {
      calls.push(`${tag}:${id}`);
      return Promise.resolve(new LoroDoc());
    };
    const fake: ShardCache<LoroDoc> = {
      get: (id) => rec("get", id),
      getAndPin: (id) => rec("getAndPin", id),
      has: () => true,
      residentEntries: () => [],
      pin: () => undefined,
      unpin: () => undefined,
      size: 0,
      evictToFit: () => Promise.resolve(),
    };
    const numShards = 8;
    const store = new ShardedBlockStore({ numShards, shardCache: fake });
    await store.ensureResident(["anyNode"]);
    store.release();
    // ensureResident faulted+Pinned the node's shard through the injected cache, not a real one.
    expect(calls).toContain(`getAndPin:${shardIdOf("anyNode", numShards)}`);
  });
});
