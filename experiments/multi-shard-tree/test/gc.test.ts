import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncAll, syncReplicas } from "../src/simulator.js";

/**
 * #6 — GC / tombstone long-term behavior. Tombstones (set on every hard-delete)
 * would grow without bound. `pruneTombstones(grace)` drops tombstones older than
 * `grace` local sync-rounds, so growth stays bounded; the tombstone prevents a
 * lagging replica from resurrecting a deleted node, so pruning must never bring a
 * deleted node back or delete a live one.
 */

const tombstoneCount = (e: ShardedEngine): number =>
  [...e.treeDoc.getMap("tombstones").keys()].length;
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

describe("GC: tombstone growth is bounded over a long delete history", () => {
  it("pruneTombstones keeps the tombstone set bounded (not monotonic to N deletes)", () => {
    const e = new ShardedEngine(8);
    const root = e.createNode("root", null);
    e.commit();
    // 10 rounds × 100 create+delete = 1000 deletes; prune with grace 3 each round.
    for (let r = 0; r < 10; r++) {
      for (let i = 0; i < 100; i++) e.createNode(`n${r}_${i}`, root, undefined, `x`);
      e.commit();
      for (let i = 0; i < 100; i++) e.hardDeleteNode(`n${r}_${i}`);
      e.commit();
      e.advanceRound();
      e.pruneTombstones(3);
    }
    // Without pruning this would be ~1000. Grace 3 keeps at most ~3-4 rounds worth.
    expect(tombstoneCount(e)).toBeLessThan(400);
    e.validateInvariants();
  });
});

describe("GC: sweep is resumable and never deletes live data", () => {
  it("sweepTombstones is idempotent — running it twice yields identical state", () => {
    const e = new ShardedEngine(8);
    const root = e.createNode("root", null);
    e.createNode("x", root, undefined, "X");
    e.createNode("y", root, undefined, "Y");
    e.hardDeleteNode("x");
    e.commit();
    e.sweepTombstones();
    const once = stableStringify(canonicalStructure(e.snapshot()));
    e.sweepTombstones();
    const twice = stableStringify(canonicalStructure(e.snapshot()));
    expect(twice).toBe(once);
  });

  it("concurrent sweep vs an edit on an UNRELATED live node deletes nothing live", () => {
    const seed = new ShardedEngine(8);
    const root = seed.createNode("root", null);
    seed.createNode("x", root, undefined, "X");
    seed.createNode("y", root, undefined, "Y");
    seed.commit();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    a.hardDeleteNode("x"); // A deletes x
    b.setText("y", "edited-by-B"); // B edits the unrelated live node y
    a.commit();
    b.commit();
    syncReplicas(a, b); // sweeps both replicas
    equiv(a, b);
    expect(a.existsNode("x")).toBe(false); // deleted node gone
    expect(a.snapshot().nodes["y"]?.text).toBe("edited-by-B"); // live edit survived
  });
});

describe("GC: no resurrection — a tombstone blocks a lagging replica, then prunes safely", () => {
  it("a partitioned replica with the node still live does NOT resurrect it (tombstone wins)", () => {
    const seed = new ShardedEngine(8);
    const root = seed.createNode("root", null);
    seed.createNode("x", root, undefined, "X");
    seed.commit();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    const c = cloneReplica(seed); // lagging: partitioned, still has x live

    a.hardDeleteNode("x");
    a.commit();
    syncAll([a, b]); // a,b drop x; tombstone[x] present
    expect(a.existsNode("x")).toBe(false);

    // C (still has x live) reconnects WHILE the tombstone is present (within grace).
    syncAll([a, b, c]);
    equiv(a, b);
    equiv(a, c);
    expect(c.existsNode("x")).toBe(false); // tombstone swept C's x — no resurrection
  });

  it("after grace, pruneTombstones drops the tombstone and the node stays gone", () => {
    const seed = new ShardedEngine(8);
    const root = seed.createNode("root", null);
    seed.createNode("x", root, undefined, "X");
    seed.commit();
    const a = cloneReplica(seed);
    a.hardDeleteNode("x");
    a.commit();
    const b = cloneReplica(a);
    // All replicas converged; let enough rounds pass, then prune.
    for (let i = 0; i < 5; i++) {
      a.advanceRound();
      b.advanceRound();
    }
    a.pruneTombstones(3);
    b.pruneTombstones(3);
    expect(tombstoneCount(a)).toBe(0); // tombstone pruned
    expect(a.existsNode("x")).toBe(false); // …and x stays gone
    equiv(a, b);
  });
});
