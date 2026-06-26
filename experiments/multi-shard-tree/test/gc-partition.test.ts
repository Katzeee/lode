import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncAll, syncReplicas } from "../src/simulator.js";

/**
 * #6 (follow-up) — the genuinely dangerous GC case the original gc.test.ts did NOT
 * cover: a replica partitioned LONGER than the tombstone grace window.
 *
 * The README/VERIFICATION-PLAN state "grace must exceed the worst-case sync
 * partition" — i.e. the tombstone must outlive any partition or a lagging replica
 * could resurrect a deleted node. But:
 *   (a) that case was never tested (gc.test only tests within-grace reconnect, and
 *       all-converged-then-prune);
 *   (b) `sweepTombstones` decides orphan removal by `!existsNode` (ownership-based),
 *       NOT by consulting the tombstone — so it is unclear the tombstone participates
 *       in resurrection prevention AT ALL.
 *
 * These tests pin down the truth: under randomUUID-style nodeIds (no same-id
 * recreate), a lagging replica reconnecting AFTER the tombstone was pruned still
 * does NOT resurrect the node. The real invariant is the permanence of
 * `ownership.delete` (a Loro CRDT op) + the ownership-based sweep — not the grace
 * window. If LoroMap delete did NOT win here, these tests would fail and expose a
 * real resurrection bug.
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
const tombstoned = (e: ShardedEngine, nodeId: string): boolean =>
  e.treeDoc.getMap("tombstones").get(nodeId) === true;

const seedRootX = (): ShardedEngine => {
  const e = new ShardedEngine(8);
  const root = e.createNode("root", null);
  e.createNode("x", root, undefined, "X");
  e.commit();
  return e;
};

describe("partition > grace: a pruned tombstone still blocks resurrection", () => {
  // Helper: simulate "grace has elapsed on every converged replica" by dropping the
  // tombstone directly. pruneTombstones is local-round-based and conservative for a
  // replica that received the tombstone via sync (it records first-observation at the
  // current round, so it keeps the tombstone longer than the deleter). That conservatism
  // is safe; the resurrection question only depends on the tombstone being ABSENT when
  // the lagging replica reconnects, so we isolate exactly that.
  const forcePruned = (e: ShardedEngine, nodeId: string): void => {
    e.treeDoc.getMap("tombstones").delete(nodeId);
    e.commit();
  };

  it("C partitioned past grace, reconnects AFTER prune → x stays gone on ALL replicas", () => {
    const seed = seedRootX();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    const c = cloneReplica(seed); // C will stay partitioned until after prune

    // A deletes x; A,B converge. tombstone[x] present.
    a.hardDeleteNode("x");
    a.commit();
    syncAll([a, b]);
    expect(a.existsNode("x")).toBe(false);
    expect(tombstoned(a, "x")).toBe(true);

    // Real prune path works for the deleter (A) once grace elapses.
    for (let i = 0; i < 4; i++) a.advanceRound();
    a.pruneTombstones(2);
    expect(tombstoned(a, "x")).toBe(false);
    // B received the tombstone via sync; force the post-grace state on it too.
    forcePruned(b, "x");
    expect(tombstoned(a, "x")).toBe(false);
    expect(tombstoned(b, "x")).toBe(false);

    // C — partitioned since clone, x still fully live, never saw the delete or tombstone.
    expect(c.existsNode("x")).toBe(true);
    expect(tombstoned(c, "x")).toBe(false);

    // C reconnects now, AFTER the tombstone was pruned on A,B.
    syncAll([a, b, c]);

    // The headline assertion: no resurrection, despite the tombstone being gone.
    expect(a.existsNode("x")).toBe(false);
    expect(b.existsNode("x")).toBe(false);
    expect(c.existsNode("x")).toBe(false);
    equiv(a, b);
    equiv(a, c);
    for (const o of Object.values(c.snapshot().occurrences)) expect(o.nodeId).not.toBe("x");
  });

  it("C made a NEW reference to x while partitioned, reconnects after prune → orphan swept, no resurrection", () => {
    // Stronger: C didn't just hold the old x, it added a fresh occurrence of x
    // concurrently with the delete. Even so, the pruned-tombstone state stays safe.
    const seed = seedRootX();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    const c = cloneReplica(seed);

    a.hardDeleteNode("x");
    a.commit();
    c.createReference("x", canon(c, "root")); // concurrent new ref to a doomed node
    c.commit();
    syncAll([a, b]);
    forcePruned(a, "x");
    forcePruned(b, "x");
    expect(tombstoned(a, "x")).toBe(false);

    syncAll([a, b, c]);
    expect(a.existsNode("x")).toBe(false);
    expect(c.existsNode("x")).toBe(false);
    equiv(a, c);
    for (const o of Object.values(c.snapshot().occurrences)) expect(o.nodeId).not.toBe("x");
  });
});

describe("tombstone is NOT the mechanism — resurrection prevention is ownership-based", () => {
  it("sweepTombstones removes an orphan occurrence by ownership, not by tombstone", () => {
    // Reproduce the A3 concurrent ref+delete, but PRUNE the tombstone before the
    // post-sync sweep runs. If sweep depended on the tombstone, the orphan would
    // survive. It does not — sweep keys off ownership being gone.
    const seed = seedRootX();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    a.removeOccurrence(canon(a, "x")); // canonical → hard-delete x
    a.commit();
    b.createReference("x", canon(b, "root")); // ref to x concurrent with its deletion
    b.commit();

    // Tree-sync only first (so the orphan is visible), then prune the tombstone.
    a.sweepTombstones();
    b.sweepTombstones();
    // Drop the tombstone on both replicas as if grace elapsed.
    a.treeDoc.getMap("tombstones").delete("x");
    b.treeDoc.getMap("tombstones").delete("x");
    a.commit();
    b.commit();
    expect(tombstoned(a, "x")).toBe(false);

    syncReplicas(a, b); // sweeps again — ownership-based
    equiv(a, b);
    expect(a.existsNode("x")).toBe(false);
    for (const o of Object.values(b.snapshot().occurrences)) expect(o.nodeId).not.toBe("x");
  });

  it("a pruned tombstone does not let a stale ownership entry resurrect the node", () => {
    // Directly assert the CRDT permanence property the safety relies on: after x is
    // hard-deleted and the tombstone pruned, a replica that still carries ownership[x]
    // (because it was partitioned) converges with ownership[x] GONE — delete wins.
    const seed = seedRootX();
    const a = cloneReplica(seed);
    const c = cloneReplica(seed);
    a.hardDeleteNode("x");
    a.commit();
    for (let i = 0; i < 4; i++) a.advanceRound();
    a.pruneTombstones(2);
    expect(tombstoned(a, "x")).toBe(false);

    expect(c.treeDoc.getMap("ownership").get("x")).toBeDefined(); // C still owns x
    syncReplicas(a, c);
    expect(c.treeDoc.getMap("ownership").get("x")).toBeUndefined(); // delete won
    expect(c.existsNode("x")).toBe(false);
  });
});
