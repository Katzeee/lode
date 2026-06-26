import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import {
  cloneReplica,
  syncAll,
  syncReplicas,
  syncReplicasPartial,
  syncTreeOnly,
} from "../src/simulator.js";

/**
 * #3 + #10 — delivery chaos at the SYNC layer. The existing suites model an
 * idealized clean two-way exchange. Real sync has partial / delayed / reordered
 * delivery and concurrent same-key writes. CRDT ops commute, so once delivery is
 * complete every scenario must converge to one invariant-valid state. Tests use
 * the chaos primitives in simulator.ts (syncTreeOnly / syncReplicasPartial) plus
 * the semantic cases (nodeId collision, concurrent tombstone).
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
const seedRoot = (): ShardedEngine => {
  const e = new ShardedEngine(8);
  e.createNode("root", null, undefined, "R");
  e.commit();
  return e;
};

describe("chaos: concurrent same-key writes converge deterministically", () => {
  it("#10 nodeId collision — two replicas createNode the SAME nodeId → one node, union of occurrences", () => {
    const base = seedRoot();
    const a = cloneReplica(base);
    const b = cloneReplica(base);
    a.createNode("dup", canon(a, "root"), undefined, "from-a");
    b.createNode("dup", canon(b, "root"), undefined, "from-b");
    a.commit();
    b.commit();
    expect(() => syncAll([a, b])).not.toThrow();
    equiv(a, b);
    expect(a.existsNode("dup")).toBe(true);
    // Both occurrences survived (union); the node is realized exactly once.
    expect(a.snapshot().nodes["dup"]!.occurrences.length).toBe(2);
  });

  it("concurrent tombstone — two replicas hard-delete the SAME node → gone on both, converge", () => {
    const base = seedRoot();
    base.createNode("x", canon(base, "root"), undefined, "X");
    base.commit();
    const a = cloneReplica(base);
    const b = cloneReplica(base);
    a.hardDeleteNode("x");
    b.hardDeleteNode("x");
    a.commit();
    b.commit();
    syncAll([a, b]);
    equiv(a, b);
    expect(a.existsNode("x")).toBe(false);
    expect(b.existsNode("x")).toBe(false);
  });
});

describe("chaos: messy delivery still converges (CRDT commutativity)", () => {
  it("a missing shard arrives LATER → content pending tolerated, then self-heals", () => {
    const a = seedRoot();
    a.createNode("x", canon(a, "root"), undefined, "X");
    a.createNode("y", canon(a, "root"), undefined, "Y");
    a.commit();
    const b = new ShardedEngine(8);
    const all = [...new Set([...a.shardIds()])];
    // Deliver everything except one shard (its content is pending on B).
    const dropped = all[0]!;
    syncReplicasPartial(
      a,
      b,
      all.filter((s) => s !== dropped),
    );
    expect(() => b.snapshot()).not.toThrow(); // no crash while incomplete
    // The dropped shard arrives now → full heal.
    syncReplicasPartial(a, b, [dropped]);
    equiv(a, b);
    expect(b.snapshot().nodes["x"]?.text).toBe("X");
    expect(b.snapshot().nodes["y"]?.text).toBe("Y");
  });

  it("out-of-order / paged shard delivery (one shard at a time, arbitrary order) → converge", () => {
    const a = seedRoot();
    for (let i = 0; i < 30; i++) a.createNode(`n${i}`, canon(a, "root"), undefined, `t${i}`);
    a.commit();
    const b = new ShardedEngine(8);
    const order = [...a.shardIds()].reverse(); // arbitrary order
    for (const sid of order) syncReplicasPartial(a, b, [sid]);
    equiv(a, b);
    for (let i = 0; i < 30; i++) expect(b.snapshot().nodes[`n${i}`]?.text).toBe(`t${i}`);
  });

  it("tree-doc-only sync (all content pending) then full sync → converge", () => {
    const a = seedRoot();
    a.createNode("x", canon(a, "root"), undefined, "X");
    a.commit();
    const b = new ShardedEngine(8);
    syncTreeOnly(a, b); // structure only, no content
    expect(() => b.snapshot()).not.toThrow();
    expect(b.treeDoc.getTree("occurrences").getNodes({ withDeleted: false }).length).toBe(2);
    syncReplicas(a, b); // full exchange heals
    equiv(a, b);
  });

  it("duplicate delivery (same shard update imported twice) is idempotent → converge", () => {
    const a = seedRoot();
    a.createNode("x", canon(a, "root"), undefined, "X");
    a.commit();
    const b = new ShardedEngine(8);
    syncReplicas(a, b);
    // Re-deliver the same content update (duplicate) — must not corrupt.
    const sx = a.shardIds()[0]!;
    const upd = a.getShardDoc(sx).export({ mode: "update", from: b.getShardDoc(sx).version() });
    b.getShardDoc(sx).import(upd);
    b.getShardDoc(sx).import(upd);
    b.commit();
    equiv(a, b);
  });
});

describe("chaos: restart / re-sync paths converge", () => {
  it("VV lost → re-sync from a full snapshot → converge with a live replica", () => {
    const a = seedRoot();
    a.createNode("x", canon(a, "root"), undefined, "X");
    a.commit();
    const b = cloneReplica(a);
    b.setText("x", "b-edit");
    b.commit();
    // A "lost its version vector" → rebuild A from a snapshot of B, then sync.
    const aResynced = cloneReplica(b);
    syncAll([aResynced, b]);
    equiv(aResynced, b);
  });

  it("multi-client different shard subsets → exchanging all shards converges", () => {
    // Two clients each created nodes that fanned out into different shards;
    // neither has loaded the other's shards. syncAll exchanges the union.
    const a = new ShardedEngine(8);
    const ar = a.createNode("root", null, undefined, "R");
    for (let i = 0; i < 40; i++) a.createNode(`a${i}`, ar, undefined, `a${i}`);
    a.commit();
    const b = new ShardedEngine(8);
    const br = b.createNode("root", null, undefined, "R");
    for (let i = 0; i < 40; i++) b.createNode(`b${i}`, br, undefined, `b${i}`);
    b.commit();
    syncAll([a, b]);
    equiv(a, b);
    expect(a.snapshot().nodes["a0"]).toBeDefined();
    expect(a.snapshot().nodes["b39"]).toBeDefined();
  });
});
