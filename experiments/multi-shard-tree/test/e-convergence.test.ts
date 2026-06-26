import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { applyScript, generateScript, mulberry32 } from "../src/driver.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncAll, syncReplicas } from "../src/simulator.js";

const base = (e: ShardedEngine): void => {
  const root = e.createNode("root", null, undefined, "Root");
  e.createNode("a", root);
  e.createNode("b", root);
  e.createNode("c", root);
  e.commit();
};

/** Canonical occurrence id of a node, resolved from the snapshot (clone-safe). */
const canon = (e: ShardedEngine, nodeId: string): string => {
  const id = e.snapshot().nodes[nodeId]?.canonicalOccurrenceId;
  if (!id) throw new Error(`no canonical for ${nodeId}`);
  return id;
};

/** All replicas must reach the same canonical structure AND pass invariants. */
const assertConverged = (replicas: ShardedEngine[]): void => {
  for (const r of replicas) r.validateInvariants();
  const first = stableStringify(canonicalStructure(replicas[0]!.snapshot()));
  for (let i = 1; i < replicas.length; i++) {
    if (stableStringify(canonicalStructure(replicas[i]!.snapshot())) !== first) {
      throw new Error(`Replica ${i} diverged after sync`);
    }
  }
};

/**
 * E5 — convergence. Replicas from a common base making concurrent divergent
 * edits must converge to one identical, invariant-valid state after sync. The
 * multi-replica extension of E4.
 */
describe("E5 convergence: divergent replicas sync to one state", () => {
  it("three replicas with hand-crafted divergent edits converge", () => {
    const seed = new ShardedEngine(4);
    base(seed);
    const r1 = cloneReplica(seed);
    const r2 = cloneReplica(seed);
    const r3 = cloneReplica(seed);

    // Divergent concurrent edits. Parents/occurrences are resolved from the
    // shared clone via snapshot; new nodeIds are replica-prefixed.
    r1.setText("a", "from-r1");
    r1.createNode("r1x", canon(r1, "a"));
    r1.setEntityProp("root", "by", "r1");
    r1.commit();

    r2.setText("a", "from-r2");
    r2.createReference("b", canon(r2, "root"));
    r2.moveOccurrence(canon(r2, "c"), canon(r2, "a")); // move c under a
    r2.commit();

    r3.setText("b", "from-r3");
    r3.createNode("r3x", canon(r3, "b"));
    r3.setEntityProp("c", "k", 1);
    r3.commit();

    syncAll([r1, r2, r3]);
    assertConverged([r1, r2, r3]);

    const live = r1.liveNodeIds();
    expect(live).toContain("r1x");
    expect(live).toContain("r3x");
    expect(r1.snapshot().nodes["b"]?.occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("converges via a star topology (hub = replica 0), two rounds", () => {
    const seed = new ShardedEngine(4);
    base(seed);
    const replicas = [seed, cloneReplica(seed), cloneReplica(seed), cloneReplica(seed)];
    for (let i = 0; i < replicas.length; i++) {
      const r = replicas[i]!;
      r.createNode(`p${i}`, canon(r, "root"));
      r.setText("a", `t${i}`);
      r.commit();
    }
    for (let i = 1; i < replicas.length; i++) syncReplicas(replicas[0]!, replicas[i]!);
    for (let i = 1; i < replicas.length; i++) syncReplicas(replicas[0]!, replicas[i]!);
    assertConverged(replicas);
  });

  it("fuzz: 5 independent replicas, random prefixed scripts, converge every time", () => {
    const RUNS = 60;
    for (let seed = 0; seed < RUNS; seed++) {
      const replicas: ShardedEngine[] = [];
      for (let i = 0; i < 5; i++) {
        const r = new ShardedEngine(4);
        const rng = mulberry32(seed * 97 + i * 13);
        // Independent replicas: the index-based occIds model is exactly correct
        // here (occIds grows within this single script). Prefixed nodeIds avoid
        // collisions after the union merge.
        applyScript(r, generateScript(rng, 8, `r${i}_`));
        replicas.push(r);
      }
      syncAll(replicas);
      assertConverged(replicas);
    }
  });
});

/**
 * E5b — move convergence. `move` had NO multi-replica coverage beyond one
 * hand-crafted one-sided move, and the differential fuzzer refuses to emit
 * cycle-forming moves. Two replicas moving the SAME leaf to different parents is
 * the core LoroTree CRDT case (which move wins). Assert: converges, stays acyclic
 * (no swap-cycle), invariant-valid, identical topology.
 */
describe("E5b move convergence: concurrent reparenting of the same occurrence", () => {
  it("two replicas move the same leaf to different parents → converge, acyclic, invariant-valid", () => {
    const seed = new ShardedEngine(4);
    base(seed); // root -> a, b, c (all leaves)
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    // Both move c, to different parents.
    a.moveOccurrence(canon(a, "c"), canon(a, "a"));
    b.moveOccurrence(canon(b, "c"), canon(b, "b"));
    a.commit();
    b.commit();
    syncAll([a, b]);
    assertConverged([a, b]);
    // c lives under exactly one parent (a or b) — moved, not duplicated, not orphaned.
    const snap = a.snapshot();
    const cOccs = Object.values(snap.occurrences).filter((o) => o.nodeId === "c");
    expect(cOccs.length).toBe(1);
    expect(cOccs[0]!.parentOccurrenceId).toBeTruthy();
  });

  it("move vs delete of the moved node converges (delete wins consistently)", () => {
    const seed = new ShardedEngine(4);
    base(seed);
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    a.moveOccurrence(canon(a, "c"), canon(a, "a")); // A reparents c
    b.hardDeleteNode("c"); // B deletes c concurrently
    a.commit();
    b.commit();
    syncAll([a, b]);
    assertConverged([a, b]);
    expect(a.existsNode("c")).toBe(false);
    expect(b.existsNode("c")).toBe(false);
  });
});
