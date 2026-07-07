import { describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { ShardedBlockStore } from "./sharded-store.js";
import { shardIdOf } from "./sharding.js";
import type { DocStore } from "./doc-store.js";
import type { NodeId, OccurrenceId } from "./types.js";

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
 * Phase 4 — operation-level residency (`ensureResident`/`release`): pin the operation's working set
 * resident so a multi-shard edit doesn't fault+evict in a thrash. Each working-set shard faults once
 * (at the pin); subsequent edits are cache hits.
 */
describe("operation-level residency (Phase 4): ensureResident pins the working set (no thrash)", () => {
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
    await store.persistDirtyShards(); // unpin the create-pins so the working-set pin is the only pin
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
