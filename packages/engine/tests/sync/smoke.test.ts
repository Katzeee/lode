import { describe, expect, it } from "vitest";
import { createPlainNode, createReference, hardDeleteNode } from "../../src/domain/node/node.js";
import { syncPair } from "../../src/runtime/sync/sync-exchange.js";
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
    const root = await a.createNode(null);
    const shared = await createPlainNode(a, root.occurrenceId);
    await a.replaceDeltas(shared.occurrenceId, [{ insert: "base" }]);

    const b = await cloneReplica(a);
    await createPlainNode(a, root.occurrenceId); // A adds a child (structure)
    await b.replaceDeltas(shared.occurrenceId, [{ insert: "from B" }]); // B edits shared content (shard)
    await createPlainNode(b, root.occurrenceId); // B adds a child

    await syncPair(a.asOutliner(), b.asOutliner());
    await assertConverged([a, b], "divergent edits");
    expect(a.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(3);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(3);
  });

  it("concurrent ref + hard-delete heals via sweepOrphans (no orphan, no resurrection)", async () => {
    const a = replica(8);
    const root = await a.createNode(null);
    const target = await createPlainNode(a, root.occurrenceId);
    const targetNode = target.nodeId;

    const b = await cloneReplica(a);
    await hardDeleteNode(a, targetNode); // A deletes target
    await createReference(b, targetNode, root.occurrenceId); // B concurrently refs it

    await syncPair(a.asOutliner(), b.asOutliner());
    // B's ref points at a node whose ownership the delete won — sweepOrphans must drop it,
    // and validateSnapshot (inside assertConverged) must not throw.
    await assertConverged([a, b], "ref + delete");
    // target's occurrence + B's orphan ref are both swept → root has no children on either side.
    expect(a.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(0);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(0);
  });

  it("three replicas converge via pairwise syncAll (transitivity)", async () => {
    const base = replica(8);
    const root = await base.createNode(null);
    await createPlainNode(base, root.occurrenceId);

    const a = await cloneReplica(base);
    const b = await cloneReplica(base);
    const c = await cloneReplica(base);
    await createPlainNode(a, root.occurrenceId);
    await createPlainNode(b, root.occurrenceId);
    await createPlainNode(c, root.occurrenceId);

    await syncAll([a, b, c]);
    await assertConverged([a, b, c], "3-replica");
    expect(a.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(4); // base child + a/b/c
  });

  it("idempotent re-sync: syncing again changes nothing", async () => {
    const a = replica(8);
    const root = await a.createNode(null);
    await createPlainNode(a, root.occurrenceId);
    const b = await cloneReplica(a);
    await createPlainNode(b, root.occurrenceId);

    await syncPair(a.asOutliner(), b.asOutliner());
    const after = JSON.stringify([
      await a.asOutliner().treeSyncDoc().version(),
      await b.asOutliner().treeSyncDoc().version(),
    ]);
    await syncPair(a.asOutliner(), b.asOutliner()); // again
    const again = JSON.stringify([
      await a.asOutliner().treeSyncDoc().version(),
      await b.asOutliner().treeSyncDoc().version(),
    ]);
    expect(again).toBe(after);
    await assertConverged([a, b], "re-sync");
  });
});
