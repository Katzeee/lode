import { describe, expect, it } from "vitest";
import { deltaToText } from "../../src/core/index.js";
import {
  createPlainNode,
  createReference,
  hardDeleteNode,
  moveOccurrence,
} from "../../src/domain/node.js";
import { syncPair } from "../../src/runtime/sync/sync-manager.js";
import { assertConverged, assertEquiv, cloneReplica, replica } from "./harness.js";

/**
 * Sync TRUTH tests. NOT differential (no comparison to another implementation — that only
 * proves equality, not correctness, and the would-be oracle isn't independently verified).
 * Each assertion is derived from the sync CONTRACT or the domain SPEC, independently of any
 * sync code:
 *   - contract properties: convergence, validity, conservation (no op lost), determinism.
 *   - spec-defined concurrent-op outcomes: independent creates both survive; delete wins over
 *     a concurrent ref (node gone, ref swept); a concurrent same-field edit resolves to ONE of
 *     the writes, identically on both replicas; a concurrent move lands on one of the targets,
 *     acyclic; delete wins over a concurrent edit.
 */

function stores(a: ReturnType<typeof replica>, b: ReturnType<typeof replica>) {
  return [a.asOutliner(), b.asOutliner()] as const;
}

describe("sync truth: concurrent op-pair outcomes (spec-defined)", () => {
  it("independent concurrent creates: both survive on both replicas", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const a = cloneReplica(base);
    const b = cloneReplica(base);
    const ax = createPlainNode(a, root.occurrenceId);
    const bx = createPlainNode(b, root.occurrenceId);

    await syncPair(...stores(a, b));
    assertConverged([a, b], "independent creates");
    // conservation: every created node present on both
    expect(a.getOccurrence(ax.occurrenceId)).toBeDefined();
    expect(a.getOccurrence(bx.occurrenceId)).toBeDefined();
    expect(b.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(2);
  });

  it("concurrent ref + hard-delete: delete wins, ref swept, node gone (no resurrection)", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const target = createPlainNode(base, root.occurrenceId);
    const targetNode = target.nodeId;
    const targetOcc = target.occurrenceId;

    const a = cloneReplica(base);
    const b = cloneReplica(base);
    hardDeleteNode(a, targetNode); // A deletes
    createReference(b, targetNode, root.occurrenceId); // B concurrently refs it

    await syncPair(...stores(a, b));
    assertConverged([a, b], "ref + delete");
    // spec: the delete is authoritative — target gone on both, B's orphan ref swept.
    expect(a.getChildOccurrenceIds(root.occurrenceId)).not.toContain(targetOcc);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).not.toContain(targetOcc);
  });

  it("concurrent same-field text edit: converges identically on both (Loro sequence-merge)", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const shared = createPlainNode(base, root.occurrenceId);
    base.replaceDeltas(shared.occurrenceId, [{ insert: "base" }]);

    const a = cloneReplica(base);
    const b = cloneReplica(base);
    a.replaceDeltas(shared.occurrenceId, [{ insert: "from A" }]);
    b.replaceDeltas(shared.occurrenceId, [{ insert: "from B" }]);

    await syncPair(...stores(a, b));
    assertConverged([a, b], "concurrent edit");
    // Loro text is a sequence CRDT, so concurrent edits MERGE (not last-writer-wins) — the
    // merged value is Loro-defined, not spec-pinnable to one write. The truth we assert
    // independently is CONVERGENCE: both replicas hold the identical merged text.
    const textA = deltaToText(a.getDeltas(shared.occurrenceId));
    const textB = deltaToText(b.getDeltas(shared.occurrenceId));
    expect(textA).toBe(textB);
  });

  it("concurrent move to different parents: lands on one target, acyclic, same on both", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const p = createPlainNode(base, root.occurrenceId);
    const q = createPlainNode(base, root.occurrenceId);
    const x = createPlainNode(base, root.occurrenceId); // the node both will move

    const a = cloneReplica(base);
    const b = cloneReplica(base);
    moveOccurrence(a, x.occurrenceId, p.occurrenceId); // A moves x under p
    moveOccurrence(b, x.occurrenceId, q.occurrenceId); // B moves x under q

    await syncPair(...stores(a, b));
    assertConverged([a, b], "concurrent move"); // validity includes acyclic + single-parent
    // spec: x's parent is one of {p, q}, and identical on both replicas.
    const parentA = a.getOccurrence(x.occurrenceId)?.parentOccurrenceId;
    const parentB = b.getOccurrence(x.occurrenceId)?.parentOccurrenceId;
    expect(parentA).toBe(parentB);
    expect([p.occurrenceId, q.occurrenceId]).toContain(parentA);
  });

  it("concurrent delete + edit: delete wins, node gone on both", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const target = createPlainNode(base, root.occurrenceId);
    const targetNode = target.nodeId;
    const targetOcc = target.occurrenceId;

    const a = cloneReplica(base);
    const b = cloneReplica(base);
    hardDeleteNode(a, targetNode); // A deletes
    b.replaceDeltas(targetOcc, [{ insert: "edited concurrently" }]); // B edits

    await syncPair(...stores(a, b));
    assertConverged([a, b], "delete + edit");
    expect(a.getChildOccurrenceIds(root.occurrenceId)).not.toContain(targetOcc);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).not.toContain(targetOcc);
  });

  it("move under a concurrently-deleted node: the moved node is removed (cascade-delete)", async () => {
    // Known semantic edge (pinned, not a convergence bug): A hard-deletes X (cascade removes
    // X's subtree), B concurrently moves the distinct live node Y under X. After sync, Y is
    // part of X's deleted subtree → removed. Pinned so the outcome can't silently regress;
    // revisit if product wants Y rescued (reparented to root) instead of removed.
    const base = replica(8);
    const root = createPlainNode(base, null);
    const x = createPlainNode(base, root.occurrenceId);
    const y = createPlainNode(base, root.occurrenceId);

    const a = cloneReplica(base);
    const b = cloneReplica(base);
    hardDeleteNode(a, x.nodeId); // A deletes X (+ subtree)
    moveOccurrence(b, y.occurrenceId, x.occurrenceId); // B moves Y under X

    await syncPair(...stores(a, b));
    assertConverged([a, b], "move under deleted");
    expect(a.getOccurrence(y.occurrenceId)).toBeUndefined();
    expect(b.getOccurrence(y.occurrenceId)).toBeUndefined();
  });
});

describe("sync truth: contract properties", () => {
  it("conservation: every node created on any replica is present on all after sync", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const a = cloneReplica(base);
    const b = cloneReplica(base);
    const created = [
      createPlainNode(a, root.occurrenceId),
      createPlainNode(a, root.occurrenceId),
      createPlainNode(b, root.occurrenceId),
      createPlainNode(b, root.occurrenceId),
    ].map((n) => n.occurrenceId);

    await syncPair(...stores(a, b));
    assertConverged([a, b], "conservation");
    for (const occ of created) {
      expect(a.getOccurrence(occ)).toBeDefined();
      expect(b.getOccurrence(occ)).toBeDefined();
    }
  });

  it("determinism: same divergent state synced via different schedules converges identically", async () => {
    // Build the divergent state ONCE (fixed ids), then clone it per schedule so both start
    // from identical ids — only the sync ORDER differs.
    const seed = replica(8);
    const root = createPlainNode(seed, null);
    const shared = createPlainNode(seed, root.occurrenceId);
    const a0 = cloneReplica(seed);
    const b0 = cloneReplica(seed);
    const c0 = cloneReplica(seed);
    a0.replaceDeltas(shared.occurrenceId, [{ insert: "A" }]);
    createPlainNode(b0, root.occurrenceId);
    createPlainNode(c0, root.occurrenceId);

    // Schedule 1: a↔b, then b↔c, then a↔c
    const a1 = cloneReplica(a0);
    const b1 = cloneReplica(b0);
    const c1 = cloneReplica(c0);
    await syncPair(...stores(a1, b1));
    await syncPair(...stores(b1, c1));
    await syncPair(...stores(a1, c1));

    // Schedule 2: a↔c, then a↔b, then b↔c (different order, same starting state)
    const a2 = cloneReplica(a0);
    const b2 = cloneReplica(b0);
    const c2 = cloneReplica(c0);
    await syncPair(...stores(a2, c2));
    await syncPair(...stores(a2, b2));
    await syncPair(...stores(b2, c2));

    assertEquiv(a1, a2, "determinism across schedules");
  });
});
