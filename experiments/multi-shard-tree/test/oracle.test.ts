import { describe, expect, it } from "vitest";
import { SingleDocEngine } from "../src/single-doc-engine.js";
import type { TreeSnapshot } from "../src/types.js";

const snap = (e: SingleDocEngine): TreeSnapshot => e.snapshot();
const json = (e: SingleDocEngine): string => JSON.stringify(snap(e));

describe("SingleDocEngine (oracle) — structural correctness", () => {
  it("creates a node with a canonical occurrence and passes invariants", () => {
    const e = new SingleDocEngine();
    const root = e.createNode("root", null, undefined, "Root text");
    e.commit();
    e.validateInvariants();

    const s = snap(e);
    expect(s.roots).toEqual([root]);
    expect(s.nodes["root"]?.text).toBe("Root text");
    expect(s.nodes["root"]?.canonicalOccurrenceId).toBe(root);
    expect(s.nodes["root"]?.occurrences).toEqual([root]);
    expect(s.occurrences[root]?.childOccurrenceIds).toEqual([]);
  });

  it("nests children and reflects parent/child in the snapshot", () => {
    const e = new SingleDocEngine();
    const root = e.createNode("root", null);
    const a = e.createNode("a", root);
    const b = e.createNode("b", root, 0); // insert before a
    e.commit();
    e.validateInvariants();

    const s = snap(e);
    expect(s.occurrences[root]?.childOccurrenceIds).toEqual([b, a]);
    expect(s.occurrences[a]?.parentOccurrenceId).toBe(root);
    expect(s.occurrences[b]?.parentOccurrenceId).toBe(root);
  });

  it("shares canonical content across references (transclusion)", () => {
    const e = new SingleDocEngine();
    const root = e.createNode("root", null);
    const node = e.createNode("n", root, undefined, "hello");
    const ref = e.createReference("n", root); // second occurrence of n
    e.commit();
    e.validateInvariants();

    const s = snap(e);
    expect(s.nodes["n"]?.occurrences).toHaveLength(2);
    expect(s.nodes["n"]?.occurrences).toContain(node);
    expect(s.nodes["n"]?.occurrences).toContain(ref);
    expect(s.nodes["n"]?.canonicalOccurrenceId).toBe(node);

    // Editing canonical content is visible at both occurrences.
    e.setText("n", "world");
    e.commit();
    expect(snap(e).nodes["n"]?.text).toBe("world");
  });

  it("removing a non-canonical occurrence keeps the node alive", () => {
    const e = new SingleDocEngine();
    const root = e.createNode("root", null);
    e.createNode("n", root);
    const ref = e.createReference("n", root);
    e.commit();
    e.validateInvariants();
    expect(snap(e).nodes["n"]?.occurrences).toHaveLength(2);

    e.removeOccurrence(ref);
    e.commit();
    e.validateInvariants();
    expect(e.existsNode("n")).toBe(true);
    expect(snap(e).nodes["n"]?.occurrences).toHaveLength(1);
  });

  it("removing the canonical occurrence hard-deletes the node", () => {
    const e = new SingleDocEngine();
    const root = e.createNode("root", null);
    const canonical = e.createNode("n", root);
    e.createReference("n", root);
    e.commit();
    e.validateInvariants();

    e.removeOccurrence(canonical);
    e.commit();
    e.validateInvariants();
    expect(e.existsNode("n")).toBe(false);
    expect(snap(e).nodes["n"]).toBeUndefined();
  });

  it("hard-deletes a node and all its occurrences", () => {
    const e = new SingleDocEngine();
    const root = e.createNode("root", null);
    e.createNode("n", root);
    e.createReference("n", root);
    e.commit();

    e.hardDeleteNode("n");
    e.commit();
    e.validateInvariants();
    expect(e.existsNode("n")).toBe(false);
    expect(snap(e).occurrences[root]?.childOccurrenceIds).toEqual([]);
  });

  it("stores and reads entity props", () => {
    const e = new SingleDocEngine();
    const root = e.createNode("root", null);
    e.setEntityProp("root", "kind", "page");
    e.commit();
    expect(snap(e).nodes["root"]?.props).toEqual({ kind: "page" });
  });
});

describe("SingleDocEngine (oracle) — crdt sync round-trip", () => {
  it("snapshot import reproduces state exactly", () => {
    const a = new SingleDocEngine();
    const root = a.createNode("root", null, undefined, "R");
    a.createNode("c", root, undefined, "C");
    a.setEntityProp("root", "k", "v");
    a.commit();

    const b = new SingleDocEngine(a.exportSnapshotBytes());
    b.commit();
    b.validateInvariants();
    expect(json(b)).toBe(json(a));
  });

  it("snapshot + delta update reproduces state exactly", () => {
    const a = new SingleDocEngine();
    const root = a.createNode("root", null);
    a.commit();

    const b = new SingleDocEngine(a.exportSnapshotBytes());
    b.commit();

    const before = a.version();
    a.createNode("c", root, undefined, "child");
    a.setText("root", "updated");
    a.commit();

    b.importUpdate(a.exportUpdateFrom(before));
    b.commit();
    b.validateInvariants();
    expect(json(b)).toBe(json(a));
  });

  it("invariants hold after import of concurrent updates from two peers", () => {
    const seed = new SingleDocEngine();
    const root = seed.createNode("root", null);
    seed.commit();
    const base = seed.exportSnapshotBytes();
    const baseVV = seed.version();

    const a = new SingleDocEngine(base);
    const b = new SingleDocEngine(base);

    // Round 1: each peer creates a node concurrently, then syncs.
    a.createNode("a1", root);
    a.commit();
    b.createNode("b1", root);
    b.commit();
    a.importUpdate(b.exportUpdateFrom(baseVV));
    b.importUpdate(a.exportUpdateFrom(baseVV));
    a.commit();
    b.commit();
    // After mutual sync both versions are equal — capture as the next base.
    const vv1 = a.version();

    // Round 2: b can now reference a1 (it has it), then sync back to a.
    b.createReference("a1", root);
    b.commit();
    a.importUpdate(b.exportUpdateFrom(vv1));
    a.commit();

    a.validateInvariants();
    b.validateInvariants();
    expect(json(a)).toBe(json(b));
    expect(snap(a).nodes["a1"]?.occurrences).toHaveLength(2);
  });
});
