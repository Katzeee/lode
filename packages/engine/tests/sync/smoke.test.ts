import { describe, expect, it } from "vitest";
import { createPlainNode, createReference, hardDeleteNode } from "../../src/domain/node.js";
import { syncPair } from "../../src/runtime/sync/sync-manager.js";
import { assertConverged, cloneReplica, replica, syncAll } from "./harness.js";

/**
 * Sync smoke — proves the production sync core (treeDoc + shard exchange + sweepOrphans)
 * converges on the hand-crafted shapes that matter most: divergent content edits, the
 * concurrent ref+delete orphan (the case sweepOrphans exists for), and 3-replica
 * transitivity. The full paradigm suite (differential oracle, exhaustive op-pairs, fuzz,
 * chaos, gc-partition) builds on the same harness.
 */
describe("sync smoke", () => {
  it("divergent edits on a shared base converge (structure + shard content)", async () => {
    const a = replica(8);
    const root = createPlainNode(a, null);
    const shared = createPlainNode(a, root.occurrenceId);
    a.replaceDeltas(shared.occurrenceId, [{ insert: "base" }]);

    const b = cloneReplica(a);
    createPlainNode(a, root.occurrenceId); // A adds a child (structure)
    b.replaceDeltas(shared.occurrenceId, [{ insert: "from B" }]); // B edits shared content (shard)
    createPlainNode(b, root.occurrenceId); // B adds a child

    await syncPair(a.getShardedStore()!, b.getShardedStore()!);
    assertConverged([a, b], "divergent edits");
    expect(a.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(3);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(3);
  });

  it("concurrent ref + hard-delete heals via sweepOrphans (no orphan, no resurrection)", async () => {
    const a = replica(8);
    const root = createPlainNode(a, null);
    const target = createPlainNode(a, root.occurrenceId);
    const targetNode = target.nodeId;

    const b = cloneReplica(a);
    hardDeleteNode(a, targetNode); // A deletes target
    createReference(b, targetNode, root.occurrenceId); // B concurrently refs it

    await syncPair(a.getShardedStore()!, b.getShardedStore()!);
    // B's ref points at a node whose ownership the delete won — sweepOrphans must drop it,
    // and validateSnapshot (inside assertConverged) must not throw.
    assertConverged([a, b], "ref + delete");
    // target's occurrence + B's orphan ref are both swept → root has no children on either side.
    expect(a.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(0);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(0);
  });

  it("three replicas converge via pairwise syncAll (transitivity)", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    createPlainNode(base, root.occurrenceId);

    const a = cloneReplica(base);
    const b = cloneReplica(base);
    const c = cloneReplica(base);
    createPlainNode(a, root.occurrenceId);
    createPlainNode(b, root.occurrenceId);
    createPlainNode(c, root.occurrenceId);

    await syncAll([a, b, c]);
    assertConverged([a, b, c], "3-replica");
    expect(a.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(4); // base child + a/b/c
  });

  it("idempotent re-sync: syncing again changes nothing", async () => {
    const a = replica(8);
    const root = createPlainNode(a, null);
    createPlainNode(a, root.occurrenceId);
    const b = cloneReplica(a);
    createPlainNode(b, root.occurrenceId);

    await syncPair(a.getShardedStore()!, b.getShardedStore()!);
    const after = JSON.stringify([
      a.getShardedStore()!.getVersion(),
      b.getShardedStore()!.getVersion(),
    ]);
    await syncPair(a.getShardedStore()!, b.getShardedStore()!); // again
    const again = JSON.stringify([
      a.getShardedStore()!.getVersion(),
      b.getShardedStore()!.getVersion(),
    ]);
    expect(again).toBe(after);
    assertConverged([a, b], "re-sync");
  });
});
