import { describe, expect, it } from "vitest";
import { SingleDocEngine } from "../src/single-doc-engine.js";
import { ShardedEngine } from "../src/sharded-engine.js";
import { applyScript, generateScript, mulberry32, type Op } from "../src/driver.js";
import { assertEquivalent } from "../src/compare.js";

/**
 * E4 — Differential equivalence (the crown jewel). For identical op scripts, the
 * multi-shard engine must produce a behaviorally-identical tree to the single-doc
 * oracle, AND both must satisfy their structural invariants. This proves the
 * sharding is transparent: the domain cannot tell the engines apart.
 */
describe("E4 differential equivalence: sharded ≡ single-doc oracle", () => {
  const numShardsOptions = [1, 2, 4, 8];

  const runBoth = (ops: Op[], numShards: number) => {
    const oracle = new SingleDocEngine();
    const sharded = new ShardedEngine(numShards);
    applyScript(oracle, ops);
    applyScript(sharded, ops);
    oracle.validateInvariants();
    sharded.validateInvariants();
    assertEquivalent(oracle.snapshot(), sharded.snapshot());
    return { oracle, sharded };
  };

  it("matches for a hand-written build/move/reference/delete script", () => {
    for (const ns of numShardsOptions) {
      const ops: Op[] = [
        { t: "createNode", nodeId: "root", parent: null, text: "Root" },
        { t: "createNode", nodeId: "a", parent: 0 },
        { t: "createNode", nodeId: "b", parent: 0, index: 0 },
        { t: "createReference", target: "a", parent: 0 },
        { t: "createNode", nodeId: "c", parent: 2 },
        { t: "move", occ: 4, parent: 0, index: 1 },
        { t: "setText", nodeId: "a", text: "A-content" },
        { t: "setProp", nodeId: "root", key: "kind", value: "page" },
      ];
      runBoth(ops, ns);
    }
  });

  it("matches across removes (non-canonical) and hard-deletes", () => {
    for (const ns of numShardsOptions) {
      const ops: Op[] = [
        { t: "createNode", nodeId: "r", parent: null },
        { t: "createNode", nodeId: "x", parent: 0 },
        { t: "createReference", target: "x", parent: 0 },
        { t: "createReference", target: "x", parent: 0 },
        { t: "remove", occ: 2 }, // remove a non-canonical leaf occurrence of x
        { t: "createNode", nodeId: "y", parent: 0 },
        { t: "hardDelete", nodeId: "y" },
      ];
      const { sharded } = runBoth(ops, ns);
      // sanity: nodes that should survive do
      expect(sharded.existsNode("x")).toBe(true);
      expect(sharded.existsNode("y")).toBe(false);
    }
  });

  it("property fuzz: 400 seeded random scripts, every shard count", () => {
    const RUNS = 400;
    for (const ns of numShardsOptions) {
      for (let seed = 0; seed < RUNS; seed++) {
        const rng = mulberry32(seed * 31 + ns);
        const ops = generateScript(rng, 12 + (seed % 18));
        runBoth(ops, ns);
      }
    }
  });

  it("sharding actually fans out across multiple docs for larger trees", () => {
    const ops: Op[] = [{ t: "createNode", nodeId: "root", parent: null }];
    for (let i = 0; i < 40; i++) {
      ops.push({ t: "createNode", nodeId: `n${i}`, parent: 0 });
    }
    const { sharded } = runBoth(ops, 4);
    expect(sharded.shards.size).toBeGreaterThan(1);
    expect(sharded.liveNodeIds().length).toBe(41);
  });
});
