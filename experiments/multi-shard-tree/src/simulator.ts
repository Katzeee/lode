import type { LoroDoc } from "loro-crdt";
import { ShardedEngine } from "./sharded-engine.js";

/**
 * Multi-replica sync harness ("post office"). The sharded engine syncs per-doc:
 * the tree doc (structure + ownership + tombstones) is the authority, and each
 * content shard syncs independently. A two-way CRDT exchange converges in one
 * round (ops form a commutative/idempotent set), so long as we capture both
 * pre-round version vectors before importing anything.
 */
function twoWaySync(da: LoroDoc, db: LoroDoc): void {
  const va = da.version();
  const vb = db.version();
  const aToB = da.export({ mode: "update", from: vb }); // A's ops not in B
  const bToA = db.export({ mode: "update", from: va }); // B's ops not in A
  da.import(bToA);
  db.import(aToB);
}

/** Fully synchronize two replicas: tree doc first, then every shard it reveals,
 * then a tombstone sweep (GC) so concurrent ref+delete leaves no orphan. */
export function syncReplicas(a: ShardedEngine, b: ShardedEngine): void {
  twoWaySync(a.treeDoc, b.treeDoc);
  const shardIds = new Set<string>([...a.shardIds(), ...b.shardIds()]);
  for (const sid of shardIds) {
    twoWaySync(a.getShardDoc(sid), b.getShardDoc(sid));
  }
  a.sweepTombstones();
  b.sweepTombstones();
}

/** Sync every pair once — sufficient for convergence (CRDT transitivity). */
export function syncAll(replicas: ShardedEngine[]): void {
  for (let i = 0; i < replicas.length; i++) {
    for (let j = i + 1; j < replicas.length; j++) {
      syncReplicas(replicas[i]!, replicas[j]!);
    }
  }
}

/** Seed a fresh replica from snapshots of another (tree doc + every shard). */
export function cloneReplica(src: ShardedEngine, numShards = src.numShards): ShardedEngine {
  const r = new ShardedEngine(numShards);
  r.treeDoc.import(src.treeDoc.export({ mode: "snapshot" }));
  for (const sid of src.shardIds()) {
    r.getShardDoc(sid).import(src.getShardDoc(sid).export({ mode: "snapshot" }));
  }
  return r;
}

// ── chaos primitives (#3/#10) ────────────────────────────────────────────────
// Real sync is not a clean atomic two-way exchange. These let tests drive
// delivery chaos (partial, delayed, out-of-order) deterministically. CRDT ops
// commute, so all of these must still converge once delivery is complete.

/** Sync ONLY the tree doc — content shards stay pending (the mid-sync state). */
export function syncTreeOnly(a: ShardedEngine, b: ShardedEngine): void {
  twoWaySync(a.treeDoc, b.treeDoc);
}

/** Sync the tree doc plus a SUBSET of shards, then sweep. Models partial /
 * delayed shard delivery (the missing shards "arrive later" in a follow-up). */
export function syncReplicasPartial(a: ShardedEngine, b: ShardedEngine, shardIds: string[]): void {
  twoWaySync(a.treeDoc, b.treeDoc);
  for (const sid of shardIds) twoWaySync(a.getShardDoc(sid), b.getShardDoc(sid));
  a.sweepTombstones();
  b.sweepTombstones();
}
