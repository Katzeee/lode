import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { ActionHistory } from "../src/history.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncReplicas } from "../src/simulator.js";

/**
 * #8 — verify the two-layer undo design: mechanism in the engine (ActionHistory),
 * granularity in the domain (begin/end grouping). Proves:
 *  - undo/redo of every primitive round-trips; structural invariants hold throughout;
 *  - cascade inversion restores everything across treeDoc + shards (cross-doc);
 *  - grouping makes undo land on DOMAIN-valid states (no post-undo reconcile);
 *  - the NEGATION: a standalone reconcile step, undone, lands DOMAIN-INVALID —
 *    exactly why grouping is required and why "reconcile after undo" is unsound
 *    (it would negate the undo);
 *  - linear undo/redo, empty-net-diff, redo clearing, and cooperative multi-replica undo.
 */

const canon = (h: ActionHistory, nodeId: string): string => {
  const id = h.snapshot().nodes[nodeId]?.canonicalOccurrenceId;
  if (!id) throw new Error(`no canonical for ${nodeId}`);
  return id;
};
const struct = (h: ActionHistory): string => stableStringify(canonicalStructure(h.snapshot()));

/** Domain invariants checked directly over the snapshot (≤1 slot/field, no stale). */
function domainValid(h: ActionHistory): boolean {
  const snap = h.snapshot();
  for (const nodeId of Object.keys(snap.nodes)) {
    const raw = snap.nodes[nodeId]?.props.fields;
    if (typeof raw !== "string") continue;
    const fields = new Set(raw.split(",").filter(Boolean));
    const canonOcc = snap.nodes[nodeId]?.canonicalOccurrenceId;
    const childOccs = canonOcc ? (snap.occurrences[canonOcc]?.childOccurrenceIds ?? []) : [];
    const seen = new Map<string, number>();
    for (const c of childOccs) {
      const nid = snap.occurrences[c]?.nodeId;
      const fd = nid ? snap.nodes[nid]?.props.fieldDef : undefined;
      if (nid && typeof fd === "string") {
        if (!fields.has(fd)) return false;
        seen.set(fd, (seen.get(fd) ?? 0) + 1);
      }
    }
    for (const v of seen.values()) if (v > 1) return false;
  }
  return true;
}

/** Reconcile inline, assuming an action is already open (records into it). */
function reconcileInline(h: ActionHistory, schemaNodeId: string): void {
  const snap = h.snapshot();
  const fields = new Set<string>(
    ((snap.nodes[schemaNodeId]?.props.fields as string) ?? "").split(",").filter(Boolean),
  );
  const canonOcc = snap.nodes[schemaNodeId]?.canonicalOccurrenceId;
  const childOccs = canonOcc ? (snap.occurrences[canonOcc]?.childOccurrenceIds ?? []) : [];
  const slots: { nodeId: string; fieldDef: string }[] = [];
  for (const c of childOccs) {
    const nid = snap.occurrences[c]?.nodeId;
    const fd = nid ? snap.nodes[nid]?.props.fieldDef : undefined;
    if (nid && typeof fd === "string") slots.push({ nodeId: nid, fieldDef: fd });
  }
  const byField = new Map<string, string[]>();
  for (const s of slots) {
    if (!fields.has(s.fieldDef)) {
      h.hardDeleteNode(s.nodeId);
      continue;
    }
    const a = byField.get(s.fieldDef) ?? [];
    a.push(s.nodeId);
    byField.set(s.fieldDef, a);
  }
  for (const ids of byField.values()) {
    ids.sort();
    for (let i = 1; i < ids.length; i++) h.hardDeleteNode(ids[i]!);
  }
}
/** reconcile as its OWN undo group (the WRONG granularity for undo — used to demonstrate the negation). */
function reconcileGrouped(h: ActionHistory, schemaNodeId: string): void {
  h.run(() => reconcileInline(h, schemaNodeId));
}

function newHistory(): { e: ShardedEngine; h: ActionHistory } {
  const e = new ShardedEngine(8);
  return { e, h: new ActionHistory(e) };
}

describe("undo/redo primitives: round-trip + structural invariants hold", () => {
  it("createNode → undo removes it → redo restores it (with text)", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      h.createNode("root", null, undefined, "R");
      h.createNode("a", canon(h, "root"), undefined, "A-content");
    });
    e.validateInvariants();
    expect(e.existsNode("a")).toBe(true);
    expect(h.undo()).toBe(true);
    e.validateInvariants(); // undo of createNode a → only root remains
    expect(e.existsNode("a")).toBe(false);
    expect(h.canRedo()).toBe(true);
    h.redo();
    e.validateInvariants();
    expect(e.snapshot().nodes["a"]?.text).toBe("A-content");
  });

  it("setText / setEntityProp undo restores the old value", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      h.createNode("root", null);
      h.createNode("x", canon(h, "root"), undefined, "orig");
      h.setEntityProp("x", "k", "old-val"); // pre-existing value to restore
    });
    h.run((h) => {
      h.setText("x", "changed");
      h.setEntityProp("x", "k", 123);
    });
    expect(e.snapshot().nodes["x"]?.text).toBe("changed");
    h.undo();
    e.validateInvariants();
    expect(e.snapshot().nodes["x"]?.text).toBe("orig");
    expect(e.snapshot().nodes["x"]?.props.k).toBe("old-val");
  });

  it("moveOccurrence undo moves it back", () => {
    const { e, h } = newHistory();
    const x = h.run((h) => {
      const root = h.createNode("root", null);
      h.createNode("a", root);
      return h.createNode("x", root);
    });
    h.run((h) => h.moveOccurrence(x, canon(h, "a"), 0)); // move x under a
    expect(e.snapshot().occurrences[x]?.parentOccurrenceId).toBe(canon(h, "a"));
    h.undo();
    e.validateInvariants();
    expect(e.snapshot().occurrences[x]?.parentOccurrenceId).toBe(canon(h, "root"));
  });
});

describe("cascade inversion: undo restores everything across treeDoc + shards", () => {
  it("hardDelete a node with children + a transclusion → undo fully restores (cross-doc)", () => {
    const { e, h } = newHistory();
    // root -> a -> b ; plus a transclusion (reference) of b under root.
    h.run((h) => {
      const root = h.createNode("root", null, undefined, "R");
      const a = h.createNode("a", root, undefined, "A");
      h.createNode("b", a, undefined, "B-content");
      h.setEntityProp("b", "kind", "note");
      h.createReference("b", root); // second occurrence of b (transclusion)
    });
    e.validateInvariants();
    const before = struct(h);
    expect(e.snapshot().nodes["b"]?.occurrences.length).toBe(2);

    h.run((h) => h.hardDeleteNode("a")); // cascade: a gone, b's canonical under a → b + both occs gone
    e.validateInvariants();
    expect(e.existsNode("a")).toBe(false);
    expect(e.existsNode("b")).toBe(false);

    expect(h.undo()).toBe(true);
    e.validateInvariants();
    expect(struct(h)).toBe(before); // topology + content fully restored
    expect(e.snapshot().nodes["b"]?.text).toBe("B-content"); // …incl. shard entity content
    expect(e.snapshot().nodes["b"]?.props.kind).toBe("note");
    expect(e.snapshot().nodes["b"]?.occurrences.length).toBe(2); // …and both occurrences
  });
});

describe("granularity (domain): undo lands on domain-valid states via grouping", () => {
  it("grouped reconcile: undo lands DOMAIN-valid (no post-undo reconcile needed)", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      const s = h.createNode("S", null);
      h.setEntityProp("S", "fields", "f1");
      h.createNode("slot-z", canon(h, "S")); // existing slot
      h.setEntityProp("slot-z", "fieldDef", "f1");
    });
    expect(domainValid(h)).toBe(true);

    // Add a duplicate slot AND reconcile, all as ONE undo group (correct granularity).
    h.run((h) => {
      h.createNode("slot-a", canon(h, "S"));
      h.setEntityProp("slot-a", "fieldDef", "f1"); // duplicate of f1
      reconcileInline(h, "S"); // folded into the same group
    });
    expect(domainValid(h)).toBe(true);

    // Undo the whole group (add-dup + reconcile): lands on the pre-add valid state.
    h.undo();
    e.validateInvariants();
    expect(domainValid(h)).toBe(true); // ← the key property: domain-valid landing point
    expect(e.snapshot().nodes["slot-a"]).toBeUndefined();
  });

  it("NEGATION: a standalone reconcile step, undone, lands DOMAIN-INVALID (why grouping is required)", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      const s = h.createNode("S", null);
      h.setEntityProp("S", "fields", "f1");
      h.createNode("slot-z", canon(h, "S"));
      h.setEntityProp("slot-z", "fieldDef", "f1");
    });
    // Group 1: add a duplicate slot (lands domain-INVALID — deliberately, to mimic raw input).
    h.run((h) => {
      h.createNode("slot-a", canon(h, "S"));
      h.setEntityProp("slot-a", "fieldDef", "f1");
    });
    // Group 2: reconcile as its OWN undo step (the WRONG granularity).
    reconcileGrouped(h, "S");
    expect(domainValid(h)).toBe(true);

    // Undo the standalone reconcile → back to the two-slot (domain-INVALID) state.
    h.undo();
    e.validateInvariants(); // engine tree still valid…
    expect(domainValid(h)).toBe(false); // …but DOMAIN-invalid (the user's exact scenario)

    // And re-running reconcile here would just RE-DELETE a slot → negate the undo.
    // (Demonstrated by restoring the same invalid state reconcile "fixed".)
    expect(e.snapshot().nodes["slot-a"]).toBeDefined();
    expect(e.snapshot().nodes["slot-z"]).toBeDefined();
  });

  it("empty-net-diff group (add duplicate slot + reconcile removes it) → undo is clean", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      const s = h.createNode("S", null);
      h.setEntityProp("S", "fields", "f1");
      h.createNode("slot-z", canon(h, "S"));
      h.setEntityProp("slot-z", "fieldDef", "f1");
    });
    const before = struct(h);
    // Add a lexicographically-LATER duplicate that reconcile removes (net no-op),
    // folded with reconcile into ONE group.
    h.run((h) => {
      h.createNode("slot-zzz", canon(h, "S"));
      h.setEntityProp("slot-zzz", "fieldDef", "f1"); // slot-zzz > slot-z → reconcile keeps slot-z
      reconcileInline(h, "S");
    });
    expect(domainValid(h)).toBe(true);
    expect(e.existsNode("slot-zzz")).toBe(false); // reconcile removed the new dup
    // Undo the group → back to the original valid state (no broken intermediate).
    h.undo();
    e.validateInvariants();
    expect(domainValid(h)).toBe(true);
    expect(struct(h)).toBe(before);
  });
});

describe("undo/redo history semantics", () => {
  it("linear undo across a mixed sequence; redo replays; a new action clears redo", () => {
    const { e, h } = newHistory();
    h.run((h) => h.createNode("root", null));
    h.run((h) => h.createNode("a", canon(h, "root"), undefined, "A"));
    h.run((h) => h.createNode("b", canon(h, "root"), undefined, "B"));
    expect(h.depth()).toBe(3);

    h.undo();
    expect(e.existsNode("b")).toBe(false);
    h.undo();
    expect(e.existsNode("a")).toBe(false);
    expect(h.canRedo()).toBe(true);

    h.redo();
    expect(e.existsNode("a")).toBe(true);
    h.redo();
    expect(e.existsNode("b")).toBe(true);
    expect(h.canRedo()).toBe(false);

    // A new action after undo clears the redo stack.
    h.undo();
    h.run((h) => h.createNode("c", canon(h, "root"), undefined, "C"));
    expect(h.canRedo()).toBe(false);
    e.validateInvariants();
  });

  it("multiple undo/redo cycles stay consistent (descriptors are node-stable)", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      h.createNode("root", null);
      h.createNode("x", canon(h, "root"), undefined, "X");
    });
    const created = struct(h);
    for (let i = 0; i < 5; i++) {
      h.undo();
      e.validateInvariants();
      h.redo();
      e.validateInvariants();
    }
    expect(struct(h)).toBe(created);
  });
});

describe("multi-replica: undo is cooperative (inverse applies forward, syncs, converges)", () => {
  it("A creates + syncs to B; A undoes; sync → B converges (X gone on both)", () => {
    const a = new ShardedEngine(8);
    const ha = new ActionHistory(a);
    ha.run((h) => {
      h.createNode("root", null, undefined, "R");
      h.createNode("x", canon(h, "root"), undefined, "X");
    });
    const b = cloneReplica(a);
    syncReplicas(a, b);
    expect(b.snapshot().nodes["x"]?.text).toBe("X");

    ha.undo(); // A removes x (inverse applied forward through the engine)
    a.validateInvariants();
    syncReplicas(a, b);
    a.validateInvariants();
    b.validateInvariants();
    expect(a.existsNode("x")).toBe(false);
    expect(b.existsNode("x")).toBe(false); // inverse synced → gone on B too
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
  });
});

describe("undo↔GC (#8d): undo of a delete clears the stale tombstone", () => {
  it("undo of a hardDelete re-creates the node AND clears its tombstone", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      h.createNode("root", null);
      h.createNode("x", canon(h, "root"), undefined, "X");
    });
    h.run((h) => h.hardDeleteNode("x"));
    expect(e.existsNode("x")).toBe(false);
    expect(e.treeDoc.getMap("tombstones").get("x")).toBe(true); // delete set a tombstone

    h.undo(); // undo re-creates x via createNode → clears the stale tombstone
    e.validateInvariants();
    expect(e.existsNode("x")).toBe(true);
    expect(e.snapshot().nodes["x"]?.text).toBe("X");
    expect(e.treeDoc.getMap("tombstones").get("x")).toBeUndefined(); // ← no stale "dead" record
  });

  it("multi-replica: A deletes+syncs, undoes, syncs again → x alive on both, tombstone cleared, converges", () => {
    const a = new ShardedEngine(8);
    const ha = new ActionHistory(a);
    ha.run((h) => {
      h.createNode("root", null);
      h.createNode("x", canon(h, "root"), undefined, "X");
    });
    const b = cloneReplica(a);
    syncReplicas(a, b);
    expect(b.existsNode("x")).toBe(true);

    ha.run((h) => h.hardDeleteNode("x")); // A deletes
    syncReplicas(a, b);
    expect(b.existsNode("x")).toBe(false); // delete reached B

    ha.undo(); // A undoes → re-creates x, clears its tombstone
    a.validateInvariants();
    syncReplicas(a, b); // the undo (re-create + tombstone-clear) reaches B
    a.validateInvariants();
    b.validateInvariants();
    expect(a.existsNode("x")).toBe(true);
    expect(b.existsNode("x")).toBe(true); // undo synced → x back on B too
    expect(a.treeDoc.getMap("tombstones").get("x")).toBeUndefined();
    expect(b.treeDoc.getMap("tombstones").get("x")).toBeUndefined(); // tombstone-clear synced
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
  });
});

describe("rich-text undo (#8a): marks survive undo", () => {
  it("applyContentDelta round-trips — the engine's delta read/write is consistent", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      h.createNode("root", null);
      h.createNode("x", canon(h, "root"), undefined, "Hello World");
      h.markText("x", 0, 5, "bold", true);
    });
    const delta = e.contentDelta("x"); // [{insert:"Hello",attributes:{bold:true}},{insert:" World"}]
    e.applyContentDelta("x", delta); // reset to the same delta
    expect(e.contentDelta("x")).toEqual(delta); // marks preserved across the round-trip
  });

  it("mark then undo → delta restored to the unmarked before-state", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      h.createNode("root", null);
      h.createNode("x", canon(h, "root"), undefined, "Hello World");
    });
    const before = e.contentDelta("x");
    h.run((h) => h.markText("x", 0, 5, "bold", true));
    const marked = e.contentDelta("x") as Array<Record<string, unknown>>;
    expect(marked).not.toEqual(before);
    expect(marked[0]?.attributes).toEqual({ bold: true }); // mark applied to "Hello"

    h.undo();
    expect(e.contentDelta("x")).toEqual(before); // mark fully removed — matches before
  });

  it("insert after a mark, undo the insert → the mark is PRESERVED (not collapsed to plain)", () => {
    const { e, h } = newHistory();
    h.run((h) => {
      h.createNode("root", null);
      h.createNode("x", canon(h, "root"), undefined, "Hello World");
      h.markText("x", 0, 5, "bold", true); // bold "Hello"
    });
    const withMark = e.contentDelta("x"); // [{insert:"Hello",bold},{insert:" World"}]

    h.run((h) => h.insertText("x", 11, "!")); // append "!" (outside the bold range)
    expect(e.snapshot().nodes["x"]?.text).toBe("Hello World!");

    h.undo(); // undo the insert → restores the before-delta, WITH the bold mark
    e.validateInvariants();
    expect(e.contentDelta("x")).toEqual(withMark); // ← mark survived, not dropped
  });
});
