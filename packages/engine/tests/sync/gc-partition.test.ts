import { describe, expect, it } from "vitest";
import { createPlainNode, createReference, hardDeleteNode } from "../../src/domain/node.js";
import { syncPair } from "../../src/runtime/sync/sync-manager.js";
import { assertConverged, cloneReplica, replica } from "./harness.js";

/**
 * Sync GC-safety TRUTH under partition. The headline invariant: a node hard-deleted on the
 * majority does NOT resurrect when a partitioned replica reconnects — even if that replica
 * made a fresh reference to it during the partition. Prevention is ownership-based (the delete
 * wins the CRDT merge, so the ownership entry is gone on both sides → sweepOrphans drops the
 * orphan occurrence). Tombstones are gone entirely — verified not to carry correctness — so
 * no-resurrection rests purely on ownership. No comparison to another implementation.
 */
describe("sync gc: no resurrection under partition", () => {
  it("a hard-deleted node stays gone when a partitioned replica reconnects", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const target = createPlainNode(base, root.occurrenceId);
    const targetOcc = target.occurrenceId;

    const a = cloneReplica(base);
    const b = cloneReplica(base); // partitioned: still has target live
    hardDeleteNode(a, target.nodeId); // majority deletes while b is partitioned

    await syncPair(a.asOutliner(), b.asOutliner()); // b reconnects
    assertConverged([a, b], "reconnect after delete");
    // Truth: delete is authoritative — target gone on both, no resurrection.
    expect(a.getChildOccurrenceIds(root.occurrenceId)).not.toContain(targetOcc);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).not.toContain(targetOcc);
  });

  it("a NEW reference made during partition is swept on reconnect (no resurrection)", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const target = createPlainNode(base, root.occurrenceId);

    const a = cloneReplica(base);
    const b = cloneReplica(base); // partitioned, target still live here
    hardDeleteNode(a, target.nodeId); // a deletes
    // b, unaware, makes a fresh ref to the still-live-on-b target
    const ref = createReference(b, target.nodeId, root.occurrenceId);

    await syncPair(a.asOutliner(), b.asOutliner()); // reconnect
    assertConverged([a, b], "ref-during-partition swept");
    // Truth: delete wins; b's new ref points at a node whose ownership is gone → swept.
    expect(a.getChildOccurrenceIds(root.occurrenceId)).not.toContain(ref.occurrenceId);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).not.toContain(ref.occurrenceId);
  });
});
