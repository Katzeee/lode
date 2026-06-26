import { describe, expect, it } from "vitest";
import { ShardedEngine, shardIdOf } from "../src/sharded-engine.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncReplicas } from "../src/simulator.js";

/**
 * #9 Multi-doc durability. The tree doc and each content shard are independent
 * LoroDocs, so persistence/sync of a single logical op is NOT atomic across them.
 * A crash between the tree-doc write and the shard write leaves an incomplete
 * state that `sweepTombstones` (delete-direction GC only) does not repair:
 *
 *   - CREATE-direction orphan: occurrence + ownership present, entity missing
 *     (the shard write of a createNode never flushed).
 *   - DELETE-direction orphan: shard entity present, ownership already gone (a
 *     hard-delete — or a delete synced in via the tree doc — took the authority
 *     side but the shard entity survived).
 *
 * `reconcileDurability()` must reach an invariant-valid fixpoint after either,
 * and the result must converge with a healthy replica.
 *
 * Crashes are simulated at the persistence boundary: we snapshot the tree doc at
 * one point and serve shard bytes from another (stale / missing), then restart
 * via the lazy `shardLoader` hook — exactly the restart path of a real replica.
 */

const canon = (e: ShardedEngine, nodeId: string): string => {
  const id = e.snapshot().nodes[nodeId]?.canonicalOccurrenceId;
  if (!id) throw new Error(`no canonical for ${nodeId}`);
  return id;
};
const equiv = (a: ShardedEngine, b: ShardedEngine): void => {
  a.validateInvariants();
  b.validateInvariants();
  expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
    stableStringify(canonicalStructure(b.snapshot())),
  );
};

/** Find `count` nodeIds that hash to distinct shards (clean persistence surgery). */
function distinctShardIds(numShards: number, count: number, prefix = "d"): string[] {
  const byShard = new Map<string, string>();
  for (let i = 0; byShard.size < count && i < 10_000; i++) {
    const id = `${prefix}${i}`;
    const sid = shardIdOf(id, numShards);
    if (!byShard.has(sid)) byShard.set(sid, id);
  }
  if (byShard.size < count) throw new Error(`could not find ${count} distinct shards`);
  return [...byShard.values()];
}

const entityPresent = (e: ShardedEngine, shardId: string, nodeId: string): boolean => {
  const v = e.getShardDoc(shardId).getMap("entities").get(nodeId);
  return v !== undefined;
};

describe("E-durability create-direction: orphan occurrence (entity missing)", () => {
  it("crash after treeDoc write, before shard write → reconcile drops the orphan", () => {
    const numShards = 8;
    const [rootId, xId] = distinctShardIds(numShards, 2);
    const a = new ShardedEngine(numShards);
    const rootOcc = a.createNode(rootId, null, undefined, "ROOT");
    a.commit();

    // Persist root fully (tree + its shard) BEFORE the interrupted op.
    const rootShard = shardIdOf(rootId, numShards);
    const rootShardBytes = a.getShardDoc(rootShard).export({ mode: "snapshot" });

    // The create that "crashes": tree-doc side applies, shard side is lost.
    a.createNode(xId, rootOcc, undefined, "X");
    a.commit();
    const treeBytes = a.treeDoc.export({ mode: "snapshot" });
    const xShard = shardIdOf(xId, numShards);
    const loader = (sid: string): Uint8Array | null => {
      if (sid === rootShard) return rootShardBytes; // root intact
      if (sid === xShard) return null; // x's entity never flushed
      return null;
    };

    const restarted = new ShardedEngine(numShards, treeBytes, loader);
    // x is structurally present but its entity is gone → invariants break.
    expect(() => restarted.validateInvariants()).toThrow();
    restarted.reconcileDurability();
    expect(() => restarted.validateInvariants()).not.toThrow();
    expect(restarted.existsNode(xId)).toBe(false);
    expect(restarted.snapshot().nodes[rootId]?.text).toBe("ROOT");
  });
});

describe("E-durability delete-direction: orphan entity (ownership gone)", () => {
  it("crash after hardDelete's tree-doc step, before shard entity delete → reconcile finishes it", () => {
    const numShards = 8;
    const [rootId, xId] = distinctShardIds(numShards, 2);
    const a = new ShardedEngine(numShards);
    const rootOcc = a.createNode(rootId, null, undefined, "ROOT");
    a.createNode(xId, rootOcc, undefined, "X");
    a.commit();

    const xShard = shardIdOf(xId, numShards);
    const xShardBytes = a.getShardDoc(xShard).export({ mode: "snapshot" }); // entity present

    a.hardDeleteNode(xId); // tree-doc side: ownership gone, tombstone, occurrence gone
    a.commit();
    const treeBytes = a.treeDoc.export({ mode: "snapshot" });
    const rootShard = shardIdOf(rootId, numShards);
    const rootShardBytes = a.getShardDoc(rootShard).export({ mode: "snapshot" });
    const loader = (sid: string): Uint8Array | null => {
      if (sid === rootShard) return rootShardBytes;
      if (sid === xShard) return xShardBytes; // STALE: x's entity survived the crash
      return null;
    };

    const restarted = new ShardedEngine(numShards, treeBytes, loader);
    restarted.validateInvariants(); // ownership gone → snapshot omits x; already valid
    expect(entityPresent(restarted, xShard, xId)).toBe(true); // …but orphan entity leaked
    restarted.reconcileDurability();
    expect(entityPresent(restarted, xShard, xId)).toBe(false); // cleaned
    expect(() => restarted.validateInvariants()).not.toThrow();
    expect(restarted.snapshot().nodes[rootId]?.text).toBe("ROOT");
  });
});

describe("E-durability fixpoint: mixed orphans, idempotent", () => {
  it("a restart with both orphan kinds reconciles to a valid, stable fixpoint", () => {
    const numShards = 8;
    const [rootId, aId, bId, cId] = distinctShardIds(numShards, 4);
    const a = new ShardedEngine(numShards);
    const rootOcc = a.createNode(rootId, null, undefined, "ROOT");
    a.createNode(aId, rootOcc, undefined, "A");
    a.createNode(bId, rootOcc, undefined, "B");
    a.commit();

    // Persistence point: all three shards have their entities.
    const shardBytes = new Map<string, Uint8Array>();
    for (const id of [rootId, aId, bId]) {
      shardBytes.set(
        shardIdOf(id, numShards),
        a.getShardDoc(shardIdOf(id, numShards)).export({ mode: "snapshot" }),
      );
    }

    // Diverge in memory: hard-delete a (delete-orphan if its shard stays stale),
    // then create c whose shard write is lost (create-orphan).
    a.hardDeleteNode(aId);
    a.createNode(cId, rootOcc, undefined, "C");
    a.commit();
    const treeBytes = a.treeDoc.export({ mode: "snapshot" });

    // Crash: tree doc flushed (a deleted, c present); shards served from the
    // pre-divergence point (a's entity leaked; c's shard never written).
    const cShard = shardIdOf(cId, numShards);
    const loader = (sid: string): Uint8Array | null => {
      if (sid === cShard) return null;
      return shardBytes.get(sid) ?? null;
    };
    const restarted = new ShardedEngine(numShards, treeBytes, loader);
    expect(() => restarted.validateInvariants()).toThrow(); // c is a create-orphan
    restarted.reconcileDurability();
    expect(() => restarted.validateInvariants()).not.toThrow();
    expect(restarted.existsNode(cId)).toBe(false);
    expect(entityPresent(restarted, shardIdOf(aId, numShards), aId)).toBe(false);
    expect(restarted.snapshot().nodes[bId]?.text).toBe("B");

    // Idempotent: a second reconcile changes nothing.
    const before = stableStringify(canonicalStructure(restarted.snapshot()));
    restarted.reconcileDurability();
    expect(stableStringify(canonicalStructure(restarted.snapshot()))).toBe(before);
  });
});

describe("E-durability convergence with a healthy replica", () => {
  it("orphan never synced out → reconcile + sync converges (no resurrection needed)", () => {
    // Replica A creates root, syncs it to B, THEN creates x and crashes before x
    // is persisted or synced. B never learned of x. A restarts, reconciles (drops
    // the orphan), and the two converge.
    const numShards = 8;
    const [rootId, xId] = distinctShardIds(numShards, 2);
    const a = new ShardedEngine(numShards);
    const rootOcc = a.createNode(rootId, null, undefined, "ROOT");
    a.commit();

    const b = new ShardedEngine(numShards);
    syncReplicas(a, b); // B learns root only
    b.createNode("y", canon(b, rootId), undefined, "Y"); // B's own independent node
    b.commit();

    // A's interrupted create of x (never synced).
    a.createNode(xId, rootOcc, undefined, "X");
    a.commit();
    const treeBytes = a.treeDoc.export({ mode: "snapshot" });
    const rootShardBytes = a.getShardDoc(shardIdOf(rootId, numShards)).export({ mode: "snapshot" });
    const xShard = shardIdOf(xId, numShards);
    const loader = (sid: string): Uint8Array | null =>
      sid === xShard ? null : sid === shardIdOf(rootId, numShards) ? rootShardBytes : null;
    const restarted = new ShardedEngine(numShards, treeBytes, loader);
    restarted.reconcileDurability();

    syncReplicas(restarted, b);
    equiv(restarted, b);
    expect(restarted.existsNode(xId)).toBe(false);
    expect(restarted.snapshot().nodes["y"]?.text).toBe("Y");
  });

  it("a replica that still has the node heals it via shard re-sync BEFORE reconcile", () => {
    // The safe recovery protocol when a healthy replica owns the orphaned node:
    // re-sync the missing shard first (the entity arrives → no longer an orphan),
    // THEN reconcile (no-op for that node). The node survives — no destructive
    // local drop is propagated. (Reconciling BEFORE re-sync would discard a node
    // another replica still has live; re-sync-then-reconcile avoids that.)
    const numShards = 8;
    const [rootId, xId] = distinctShardIds(numShards, 2);
    const a = new ShardedEngine(numShards);
    const rootOcc = a.createNode(rootId, null, undefined, "ROOT");
    a.createNode(xId, rootOcc, undefined, "X");
    a.commit();

    // B is fully healthy: clone of the complete state (root + x).
    const b = cloneReplica(a);

    // A "crashes" losing x's shard only; restarts as a create-orphan.
    const treeBytes = a.treeDoc.export({ mode: "snapshot" });
    const rootShardBytes = a.getShardDoc(shardIdOf(rootId, numShards)).export({ mode: "snapshot" });
    const xShard = shardIdOf(xId, numShards);
    const loader = (sid: string): Uint8Array | null =>
      sid === xShard ? null : sid === shardIdOf(rootId, numShards) ? rootShardBytes : null;
    const restarted = new ShardedEngine(numShards, treeBytes, loader);

    // Re-sync FIRST: B's shard restores x's entity on A → x is no longer orphaned.
    syncReplicas(restarted, b);
    expect(() => restarted.validateInvariants()).not.toThrow(); // healed, no orphan
    restarted.reconcileDurability(); // no-op for x (entity present)
    equiv(restarted, b);
    expect(restarted.snapshot().nodes[xId]?.text).toBe("X"); // x survived
  });

  it("CHARACTERIZATION (hazard): reconcile BEFORE re-sync destroys a node a peer still owns", () => {
    // The flip side of the safe path above — and the reason it must be re-sync-
    // first. `reconcileDurability` is a pure function of LOCAL state: if x's entity
    // is absent locally (shard not yet re-imported) it drops x as a create-orphan,
    // EVEN THOUGH a healthy peer still has x. That drop then syncs out and deletes
    // x on the peer too. This is the non-obvious temporal trap: both methods look
    // safe by inspection (they only remove things "not there"), but "not there
    // YET" ≠ "never existed." Pinned here so a future quiescence guard / ack-aware
    // reconcile is noticed (it would flip this assertion).
    const numShards = 8;
    const [rootId, xId] = distinctShardIds(numShards, 2);
    const a = new ShardedEngine(numShards);
    const rootOcc = a.createNode(rootId, null, undefined, "ROOT");
    a.createNode(xId, rootOcc, undefined, "X");
    a.commit();
    const b = cloneReplica(a); // B is healthy and owns x

    // A crashes losing x's shard; restarts as a create-orphan.
    const treeBytes = a.treeDoc.export({ mode: "snapshot" });
    const rootShardBytes = a.getShardDoc(shardIdOf(rootId, numShards)).export({ mode: "snapshot" });
    const xShard = shardIdOf(xId, numShards);
    const loader = (sid: string): Uint8Array | null =>
      sid === xShard ? null : sid === shardIdOf(rootId, numShards) ? rootShardBytes : null;
    const restarted = new ShardedEngine(numShards, treeBytes, loader);

    // UNSAFE ordering: reconcile BEFORE re-sync. x looks orphaned locally → dropped.
    restarted.reconcileDurability();
    expect(restarted.existsNode(xId)).toBe(false); // x destroyed on A

    // The drop propagates to B on sync — B loses a node it legitimately owned.
    syncReplicas(restarted, b);
    expect(b.existsNode(xId)).toBe(false); // ← data loss reached the healthy peer
  });
});
