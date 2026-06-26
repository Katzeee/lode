import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { applyScript, generateScript, mulberry32, type Op } from "../src/driver.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncAll, syncReplicas } from "../src/simulator.js";

/**
 * Remaining engine-layer properties. (E2 referential-integrity-at-quiescence
 * and E4 differential-equivalence and E5 convergence live in their own files;
 * every test here additionally exercises validateInvariants, which is E2.)
 */
describe("E1 structural validity holds at every checkpoint", () => {
  it("after EACH op in a random script, invariants pass (local engine, all shards present)", () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = mulberry32(seed + 700);
      const ops = generateScript(rng, 20);
      const e = new ShardedEngine(4);
      // Replay op-by-op with a PERSISTENT occIds (applyScript's is per-call).
      const occIds: string[] = [];
      const resolve = (idx: number | null): string | null => (idx == null ? null : occIds[idx]!);
      for (const op of ops) {
        switch (op.t) {
          case "createNode":
            occIds.push(e.createNode(op.nodeId, resolve(op.parent), op.index, op.text));
            break;
          case "createReference":
            occIds.push(e.createReference(op.target, resolve(op.parent), op.index));
            break;
          case "move":
            e.moveOccurrence(resolve(op.occ), resolve(op.parent), op.index);
            break;
          case "remove":
            e.removeOccurrence(resolve(op.occ));
            break;
          case "hardDelete":
            e.hardDeleteNode(op.nodeId);
            break;
          case "setText":
            e.setText(op.nodeId, op.text);
            break;
          case "setProp":
            e.setEntityProp(op.nodeId, op.key, op.value);
            break;
        }
        e.commit();
        e.validateInvariants(); // must never throw, after every single op
      }
    }
  });
});

describe("E3 mid-sync tolerance: content-pending does not corrupt and self-heals", () => {
  it("after tree-doc-only sync, reading state does not crash; full sync heals", () => {
    const a = new ShardedEngine(4);
    const root = a.createNode("root", null);
    a.createNode("x", root, undefined, "X-content");
    a.createNode("y", root, undefined, "Y-content");
    a.commit();

    const b = new ShardedEngine(4);
    // Sync ONLY the tree doc: B learns structure + ownership, not entity content.
    const vb = b.treeDoc.version();
    b.treeDoc.import(a.treeDoc.export({ mode: "update", from: vb }));
    b.commit();

    // B's tree doc is a well-formed tree (structure is always valid). Reading the
    // snapshot must not crash; the entities are simply not yet present.
    expect(() => b.snapshot()).not.toThrow();
    expect(b.treeDoc.getTree("occurrences").getNodes({ withDeleted: false }).length).toBe(3);

    // Full sync (shards too) heals: B now matches A and passes invariants.
    syncReplicas(a, b);
    b.validateInvariants();
    a.validateInvariants();
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
    expect(b.snapshot().nodes["x"]?.text).toBe("X-content");
  });
});

describe("E6 lazy-load transparency", () => {
  it("shards fan out across docs and snapshot resolves them transparently", () => {
    const ops: Op[] = [{ t: "createNode", nodeId: "root", parent: null }];
    for (let i = 0; i < 50; i++) ops.push({ t: "createNode", nodeId: `n${i}`, parent: 0 });
    const e = new ShardedEngine(4);
    applyScript(e, ops);
    // 50 distinct nodeIds hashed across 4 shards -> fan-out happened.
    expect(e.shardIds().length).toBeGreaterThan(1);
    // Every node resolves regardless of which shard it landed in.
    for (let i = 0; i < 50; i++) expect(e.snapshot().nodes[`n${i}`]).toBeDefined();
  });

  it("snapshot is identical whether shards are pre-touched or only loaded on demand", () => {
    const e1 = new ShardedEngine(4);
    const e2 = new ShardedEngine(4);
    const ops: Op[] = [{ t: "createNode", nodeId: "root", parent: null }];
    for (let i = 0; i < 30; i++)
      ops.push({ t: "createNode", nodeId: `n${i}`, parent: 0, text: `t${i}` });
    applyScript(e1, ops);
    applyScript(e2, ops);
    // Forcefully materialize every shard on e1 (simulating eager load).
    for (const sid of e1.shardIds()) e1.getShardDoc(sid);
    expect(stableStringify(canonicalStructure(e1.snapshot()))).toBe(
      stableStringify(canonicalStructure(e2.snapshot())),
    );
  });
});

describe("E7 no data loss: hard-delete + tombstone, concurrent delete/edit", () => {
  it("hard-delete removes content + records a tombstone in the tree doc", () => {
    const e = new ShardedEngine(4);
    const root = e.createNode("root", null);
    e.createNode("x", root, undefined, "X");
    e.commit();
    e.hardDeleteNode("x");
    e.commit();
    expect(e.existsNode("x")).toBe(false);
    expect(e.snapshot().nodes["x"]).toBeUndefined();
    expect(e.treeDoc.getMap("tombstones").get("x")).toBe(true);
  });

  it("concurrent delete (A) vs edit (B) converges consistently — no corrupt half-state", () => {
    const seed = new ShardedEngine(4);
    const root = seed.createNode("root", null);
    seed.createNode("x", root, undefined, "X");
    seed.commit();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);

    a.hardDeleteNode("x"); // A deletes (tree doc + shard + tombstone)
    a.commit();
    b.setEntityProp("x", "note", "B-was-here"); // B edits content (shard only)
    b.commit();

    syncAll([a, b]);
    a.validateInvariants();
    b.validateInvariants();
    // X is gone on both — delete wins, consistently. No orphan, no resurrection.
    expect(a.existsNode("x")).toBe(false);
    expect(b.existsNode("x")).toBe(false);
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
  });
});

describe("E9 delivery robustness: duplicate / re-ordered updates still converge", () => {
  it("importing the same update twice is idempotent", () => {
    const a = new ShardedEngine(4);
    const root = a.createNode("root", null);
    a.createNode("x", root, undefined, "X");
    a.commit();
    const b = new ShardedEngine(4);
    const before = b.treeDoc.version();
    const upd = a.treeDoc.export({ mode: "update", from: before });
    b.treeDoc.import(upd);
    b.treeDoc.import(upd); // duplicate
    b.commit();
    syncReplicas(a, b); // full heal
    b.validateInvariants();
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
  });

  it("shard updates delivered out of order converge", () => {
    const a = new ShardedEngine(4);
    a.createNode("root", null, undefined, "R");
    a.setText("root", "R2");
    a.setEntityProp("root", "k", "v");
    a.commit();
    const b = cloneReplica(a);
    // Re-apply a few content edits on a, then sync shards in arbitrary order.
    a.setText("root", "R3");
    a.commit();
    for (const sid of a.shardIds()) {
      const va = a.getShardDoc(sid).version();
      const vb = b.getShardDoc(sid).version();
      // deliberately cross direction/order
      b.getShardDoc(sid).import(a.getShardDoc(sid).export({ mode: "update", from: vb }));
      a.getShardDoc(sid).import(b.getShardDoc(sid).export({ mode: "update", from: va }));
    }
    syncReplicas(a, b);
    a.validateInvariants();
    b.validateInvariants();
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
  });
});

describe("E10 persistence/restart fidelity", () => {
  it("snapshot-export → fresh engine → state reproduces exactly", () => {
    const a = new ShardedEngine(4);
    applyScript(a, generateScript(mulberry32(1234), 25));
    const reloaded = cloneReplica(a); // snapshot-based reseed
    reloaded.validateInvariants();
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(reloaded.snapshot())),
    );
  });

  it("a converged multi-replica state survives restart on all replicas", () => {
    const seed = new ShardedEngine(4);
    const root = seed.createNode("root", null);
    seed.createNode("x", root, undefined, "X");
    seed.commit();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    a.setText("x", "from-a");
    b.setEntityProp("x", "k", 1);
    a.commit();
    b.commit();
    syncAll([a, b]);

    // "Restart" both from snapshots.
    const a2 = cloneReplica(a);
    const b2 = cloneReplica(b);
    a2.validateInvariants();
    b2.validateInvariants();
    expect(stableStringify(canonicalStructure(a2.snapshot()))).toBe(
      stableStringify(canonicalStructure(b2.snapshot())),
    );
  });
});
