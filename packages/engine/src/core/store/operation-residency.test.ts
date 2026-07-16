import { describe, expect, it } from "vitest";
import { Engine } from "../engine.js";
import { ShardedBlockStore } from "./sharded-store.js";
import { shardIdOf } from "./sharding.js";
import type { DocStore } from "./doc-store.js";
import type { NodeId, OccurrenceId } from "../types.js";

/** A round-tripping in-memory DocStore — flushDirty/persist exercises the lazy fault + write-back
 *  path without a real sqlite sink. */
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

/**
 * Operation-level residency (`ensureResident`/`release`): pin the operation's working set
 * resident so a multi-shard edit doesn't fault+evict in a thrash. Each working-set shard faults once
 * (at the pin); subsequent edits are cache hits.
 */
describe("operation-level residency: ensureResident pins the working set (no thrash)", () => {
  it("edits over a pinned multi-shard working set don't re-fault (each shard faulted once)", async () => {
    // Two nodes forced into DIFFERENT shards; capacity 1 would thrash (fault A, evict on B, re-fault
    // A) across interleaved edits. ensureResident pins both up front → every edit is a cache hit.
    const numShards = 256;
    const faults: string[] = [];
    const store = new ShardedBlockStore({
      numShards,
      capacity: 1,
      docStore: recordingDocStore(),
      snapshotEveryUpdates: Number.POSITIVE_INFINITY,
      onFault: (id) => faults.push(id),
    });
    const e = new Engine({ store });
    // Create nodes until two land in DIFFERENT shards (random ids → ~always 2 within 2-3 tries).
    const nodeIds: NodeId[] = [];
    const occs: OccurrenceId[] = [];
    const shards = new Set<string>();
    while (nodeIds.length < 2) {
      const n = await e.createNode(null);
      const s = shardIdOf(n.nodeId, numShards);
      if (!shards.has(s)) {
        nodeIds.push(n.nodeId);
        occs.push(n.occurrenceId);
        shards.add(s);
      }
    }
    e.captureSync();
    await store.flushDirty(); // unpin the create-pins so the working-set pin is the only pin
    await store.ensureResident(nodeIds);
    const pinned = faults.length;
    // Interleave 5 rounds of edits across both shards — pinned ⇒ all cache hits, no re-faults.
    for (let k = 0; k < 5; k++) {
      await e.replaceDeltas(occs.at(0)!, [{ insert: `a${k}` }]);
      await e.replaceDeltas(occs.at(1)!, [{ insert: `b${k}` }]);
    }
    store.release();
    expect(faults.length).toBe(pinned); // no thrash: zero re-faults across 10 cross-shard edits
  });
});

/**
 * Mid-burst residency — guards the write-pin removal. Before that removal, `shardForWrite` pinned every
 * clean→dirty shard until `flushDirty`; a write burst over many shards with NO mid-flush therefore
 * pinned each one, and resident spiked past capacity. The write-pin removal (a dirty shard
 * is freely evictable — `onEvict` flushes it). This test samples `residentShardCount` on every cold
 * fault during an un-flushed multi-shard burst and asserts it stays bounded (≤ capacity + 1, the
 * documented per-fault transient before `evictToFit` reclaims). A re-introduced write-pin would
 * push the max far past that.
 */
describe("mid-burst residency: an un-flushed multi-shard write burst stays bounded", () => {
  it("residentShardCount never spikes past capacity during a no-flush write burst", async () => {
    const numShards = 32;
    const capacity = 2;
    const samples: number[] = [];
    const store = new ShardedBlockStore({
      numShards,
      capacity,
      docStore: recordingDocStore(),
      snapshotEveryUpdates: Number.POSITIVE_INFINITY,
      onFault: () => samples.push(store.residentShardCount),
    });
    const e = new Engine({ store });
    const root = await e.createNode(null);
    // Create nodes until > capacity shards are touched (random ids fan across the shard space).
    const touched = new Set<string>();
    while (touched.size <= capacity) {
      const n = await e.createNode(root.occurrenceId);
      touched.add(shardIdOf(n.nodeId, numShards));
    }
    e.captureSync();
    // NO flushDirty between creates — the burst. Every dirty shard was written without being pinned.
    expect(samples.length).toBeGreaterThan(capacity); // the burst faulted more shards than capacity
    expect(Math.max(...samples)).toBeLessThanOrEqual(capacity + 1); // no spike; +1 is the per-fault transient
    expect(store.residentShardCount).toBeLessThanOrEqual(capacity); // quiescent after the burst
  });
});

/**
 * The working-set gate is an OPERATION dev-aid: inside an `ensureResident` session, `shardForRead` /
 * `shardForWrite` throw if a shard OUTSIDE the declared set is touched — catching an under-declared
 * operation boundary. Infra (heal, sync, flush) goes through the SAME gated accessors; it never trips
 * the gate because the per-workspace lock (Phase 2) serializes infra against any operation, so infra
 * always runs with `residentSession === null`. (The daemon `local-write-pushes` flake this class of
 * test was built for is now prevented structurally — sync cannot run during an operation's session.)
 *
 * This pins the gate's contract directly: a session scopes an operation to its declared shards, and
 * infra (heal) runs freely with no session armed.
 */
describe("working-set gate: scopes an operation's declared shards; infra runs off-session", () => {
  it("an armed session rejects a shard outside the declared set", async () => {
    const numShards = 256;
    const store = new ShardedBlockStore({ numShards });
    const e = new Engine({ store });
    // Two nodes forced into DIFFERENT shards.
    const a = await e.createNode(null);
    let b = await e.createNode(null);
    while (shardIdOf(b.nodeId, numShards) === shardIdOf(a.nodeId, numShards)) {
      b = await e.createNode(null);
    }
    e.captureSync();
    // Arm a session over ONLY a's shard. Editing b (a different shard) via the engine trips the gate.
    await store.ensureResident([a.nodeId]);
    await expect(e.replaceDeltas(b.occurrenceId, [{ insert: "x" }])).rejects.toThrow(/working set/);
    store.release();
    // Off-session the same edit is allowed — the infra / no-session path.
    await expect(e.replaceDeltas(b.occurrenceId, [{ insert: "x" }])).resolves.toBeUndefined();
  });

  it("heal runs (reconcile + sweep) with no session armed — the infra path the lock keeps session-free", async () => {
    const numShards = 8;
    const store = new ShardedBlockStore({ numShards });
    const e = new Engine({ store });
    await e.createNode(null);
    e.captureSync();
    // No ensureResident session armed → heal's gated faults see residentSession === null → no throw.
    await expect(store.reconcileDurability()).resolves.toBeUndefined();
    await expect(store.heal()).resolves.toBeUndefined();
  });
});
