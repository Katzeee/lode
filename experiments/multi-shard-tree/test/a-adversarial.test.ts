import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncAll, syncReplicas } from "../src/simulator.js";

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

const seedXY = (): ShardedEngine => {
  const e = new ShardedEngine(4);
  e.createNode("root", null);
  e.createNode("x", canon(e, "root"), undefined, "X");
  e.createNode("y", canon(e, "root"), undefined, "Y");
  e.commit();
  return e;
};

/** A1 — a delayed/lost entity update leaves content pending, then heals. */
describe("A1 lost entity op -> content-pending, self-heals on full sync", () => {
  it("tree-doc-only sync then full sync converges with content intact", () => {
    const a = seedXY();
    const b = new ShardedEngine(4);
    const vb = b.treeDoc.version();
    b.treeDoc.import(a.treeDoc.export({ mode: "update", from: vb })); // structure only
    b.commit();
    expect(() => b.snapshot()).not.toThrow();
    syncReplicas(a, b); // full sync heals
    equiv(a, b);
    expect(b.snapshot().nodes["x"]?.text).toBe("X");
  });
});

/** A2 — the data-loss命门: concurrent delete vs edit. */
describe("A2 concurrent delete vs edit converges (no data loss / corruption)", () => {
  it("A hard-deletes x while B edits x -> delete wins consistently", () => {
    const seed = seedXY();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    a.hardDeleteNode("x");
    a.commit();
    b.setText("x", "edited-by-B");
    b.commit();
    syncAll([a, b]);
    equiv(a, b);
    expect(a.existsNode("x")).toBe(false);
    expect(b.existsNode("x")).toBe(false);
  });
});

/** A3 — concurrent reference-to-X vs delete-X; tombstone sweep clears the orphan. */
describe("A3 concurrent reference + delete -> sweep clears orphan occurrence", () => {
  it("B references x while A deletes x -> no dangling occurrence after sync", () => {
    const seed = seedXY();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    a.removeOccurrence(canon(a, "x")); // canonical -> hard-delete x
    a.commit();
    b.createReference("x", canon(b, "root")); // ref to x, concurrent with its deletion
    b.commit();
    syncReplicas(a, b);
    equiv(a, b);
    expect(a.existsNode("x")).toBe(false);
    expect(b.existsNode("x")).toBe(false);
    // No occurrence references the deleted x anymore.
    for (const o of Object.values(b.snapshot().occurrences)) {
      expect(o.nodeId).not.toBe("x");
    }
  });
});

/** A4 — delete then resurrect the same nodeId. */
describe("A4 tombstone then resurrect (same nodeId)", () => {
  it("hard-deleting then recreating a nodeId yields a clean live node", () => {
    const e = seedXY();
    e.hardDeleteNode("x");
    e.commit();
    expect(e.existsNode("x")).toBe(false);
    e.createNode("x", canon(e, "root"), undefined, "X-2"); // resurrect
    e.commit();
    e.validateInvariants();
    expect(e.existsNode("x")).toBe(true);
    expect(e.snapshot().nodes["x"]?.text).toBe("X-2");
  });
});

/** A5 — a structural move and a content edit are independent; both apply. */
describe("A5 move vs concurrent content edit are independent", () => {
  it("A moves y under x while B edits y's text -> both effects survive", () => {
    const seed = seedXY();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    a.moveOccurrence(canon(a, "y"), canon(a, "x"));
    a.commit();
    b.setText("y", "edited");
    b.commit();
    syncAll([a, b]);
    equiv(a, b);
    expect(a.snapshot().nodes["y"]?.text).toBe("edited");
    expect(a.snapshot().occurrences[canon(a, "y")]?.parentOccurrenceId).toBe(canon(a, "x"));
  });
});

/** A6 — restart from a snapshot mid-sync still converges. */
describe("A6 restart mid-sync", () => {
  it("snapshot-reseed at a partial point then full sync converges", () => {
    const seed = seedXY();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    a.setText("x", "a-edit");
    a.createNode("z", canon(a, "root"));
    a.commit();
    b.setEntityProp("y", "k", 1);
    b.commit();
    syncReplicas(a, b); // partial: one round
    // Restart A from its snapshot before the second round.
    const a2 = cloneReplica(a);
    a2.setText("x", "a2-edit");
    a2.commit();
    syncAll([a2, b]);
    equiv(a2, b);
    expect(a2.snapshot().nodes["x"]?.text).toContain("a2-edit");
  });
});

/** A7 — long partition, many divergent ops, then reconnect. */
describe("A7 long partition then reconnect", () => {
  it("two replicas diverge over many ops then converge on reconnect", () => {
    const seed = seedXY();
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    for (let i = 0; i < 15; i++) {
      a.createNode(`a${i}`, canon(a, "root"), undefined, `A${i}`);
      b.createNode(`b${i}`, canon(b, "root"), undefined, `B${i}`);
      if (i % 3 === 0) a.setText("x", `ax${i}`);
      if (i % 4 === 0) b.setText("y", `by${i}`);
    }
    a.commit();
    b.commit();
    syncAll([a, b]);
    equiv(a, b);
    expect(a.snapshot().nodes["a0"]).toBeDefined();
    expect(a.snapshot().nodes["b14"]).toBeDefined();
  });
});

/** Exhaustive small-space: every pair of single concurrent ops converges.
 *  Moves are restricted to the LEAF `y` (no descendants), so no pair can form a
 *  swap-cycle that would trip Loro's fatal Cycle-move abort on merge. */
describe("exhaustive 2-replica x 1-op interleaving", () => {
  const op = (e: ShardedEngine, code: string): void => {
    if (code === "create") e.createNode("new", canon(e, "root"), undefined, "N");
    else if (code === "editX") e.setText("x", "E");
    else if (code === "editY") e.setText("y", "E");
    else if (code === "refX") e.createReference("x", canon(e, "root"));
    else if (code === "delY") e.hardDeleteNode("y");
    else if (code === "moveYunderX") e.moveOccurrence(canon(e, "y"), canon(e, "x"));
    else if (code === "moveYtoRoot") e.moveOccurrence(canon(e, "y"), canon(e, "root"), 0);
    e.commit();
  };
  // Only `y` (a leaf) is ever moved, and only to {x, root} — never a cycle.
  const codes = ["create", "editX", "editY", "refX", "delY", "moveYunderX", "moveYtoRoot"];

  it("all op-pairs (incl. move-vs-move / move-vs-delete) converge and pass invariants", () => {
    const seed = seedXY();
    for (const ca of codes) {
      for (const cb of codes) {
        const a = cloneReplica(seed);
        const b = cloneReplica(seed);
        op(a, ca);
        op(b, cb);
        syncAll([a, b]);
        equiv(a, b); // invariant-valid + identical topology (covers move convergence)
      }
    }
  });
});
