import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine.js";
import { ShardedBlockStore } from "../src/core/sharded-store.js";
import { toJSON } from "../src/core/serializers/json.js";
import { validateSnapshot } from "../src/core/invariant.js";
import {
  cloneOccurrence,
  createPlainNode,
  hardDeleteNode,
  removeOccurrenceOrHardDelete,
} from "../src/domain/node.js";
import { duplicate, paste } from "../src/domain/editing/clipboard.js";
import { indent, moveSibling, outdent } from "../src/domain/editing/structure.js";
import { stableStringify } from "./truth-model.js";

/**
 * Composite/intent ops group as ONE undo step, and each undoes/redoes
 * to the exact prior snapshot. The step-count check (canUndo flips false after a single
 * undo from a reset baseline) catches any op that accidentally opens two groups; the
 * stableStringify equivalence catches any undo that doesn't fully restore state.
 */

/** Project a snapshot to an occId-keyed canonical form. Live Loro occurrenceIds are volatile
 * across undo/redo (redo recreates deleted occurrences with fresh live ids), so a raw toJSON
 * comparison fails for create/delete ops. Mapping every live id to its permanent occId and
 * canonicalizing array order makes the comparison stable while preserving structure, sibling
 * and root order, and per-occurrence/entity state. occId is the undo reconciliation key by
 * design (see action-history.ts). */
function normalizeSnapshot(snap: ReturnType<typeof toJSON>): unknown {
  const liveToOcc = new Map(snap.occurrences.map((o) => [o.occurrenceId, o.occId]));
  const occOf = (live: string): string => liveToOcc.get(live) ?? live;
  return {
    entities: snap.entities
      .map((e) => ({
        nodeId: e.nodeId,
        canonicalOccId: occOf(e.canonicalOccurrenceId),
        deltas: e.deltas,
        props: e.props,
        meta: e.meta,
      }))
      .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)),
    occurrences: snap.occurrences
      .map((o) => ({
        occId: o.occId,
        nodeId: o.nodeId,
        parentOccId: o.parentOccurrenceId ? occOf(o.parentOccurrenceId) : null,
        childOccIds: o.physicalChildOccurrenceIds.map(occOf),
        props: o.occurrenceProps,
        meta: o.occurrenceMeta,
      }))
      .sort((a, b) => (a.occId < b.occId ? -1 : a.occId > b.occId ? 1 : 0)),
    rootOccIds: snap.rootOccurrenceIds.map(occOf),
  };
}

const canonical = (e: Engine): string => stableStringify(normalizeSnapshot(toJSON(e)));

function roundTrip(e: Engine, act: () => void): void {
  e.resetHistory();
  expect(e.canUndo()).toBe(false);
  const before = canonical(e);
  act();
  expect(e.canUndo()).toBe(true);
  validateSnapshot(toJSON(e));
  const after = canonical(e);
  // One undo restores `before` exactly, and leaves nothing more to undo.
  expect(e.undo()).toBe(true);
  expect(canonical(e)).toBe(before);
  expect(e.canUndo()).toBe(false);
  // Redo restores `after`.
  expect(e.redo()).toBe(true);
  expect(canonical(e)).toBe(after);
}

function buildTree(): {
  e: Engine;
  root: string;
  a: string;
  b: string;
  c: string;
  a1: string;
  a2: string;
} {
  const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
  const root = e.createNode(null);
  const a = createPlainNode(e, root.occurrenceId);
  const b = createPlainNode(e, root.occurrenceId);
  const c = createPlainNode(e, root.occurrenceId);
  const a1 = createPlainNode(e, a.occurrenceId);
  const a2 = createPlainNode(e, a.occurrenceId);
  return {
    e,
    root: root.occurrenceId,
    a: a.occurrenceId,
    b: b.occurrenceId,
    c: c.occurrenceId,
    a1: a1.occurrenceId,
    a2: a2.occurrenceId,
  };
}

describe("composite/intent ops: one undo step + round-trip", () => {
  it("cloneOccurrence clones a subtree in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      cloneOccurrence(t.e, t.a);
    });
  });

  it("removeOccurrenceOrHardDelete cascades in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      removeOccurrenceOrHardDelete(t.e, t.a); // a has children a1,a2 → cascade
    });
  });

  it("hardDeleteNode in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      hardDeleteNode(t.e, t.e.mustGetOccurrence(t.a).nodeId);
    });
  });

  it("paste (multi-source) in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      paste(t.e, [t.a, t.b], t.c);
    });
  });

  it("duplicate in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      duplicate(t.e, t.a);
    });
  });

  it("indent (single) in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      expect(indent(t.e, [t.b])).toBe(true);
    });
  });

  it("indent (contiguous multi) in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      expect(indent(t.e, [t.b, t.c])).toBe(true);
    });
  });

  it("outdent in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      expect(outdent(t.e, t.a1)).toBe(true);
    });
  });

  it("moveSibling in one undo step", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      expect(moveSibling(t.e, t.b, 1)).toBe(true);
    });
  });

  it("a grouped primitive called inside an outer batch joins it (nest-safe, one step)", () => {
    const t = buildTree();
    roundTrip(t.e, () => {
      t.e.batch(() => {
        // removeOccurrenceOrHardDelete opens its own batch (cascades on a) — must JOIN the
        // outer batch, not open a second undo step.
        removeOccurrenceOrHardDelete(t.e, t.a);
        createPlainNode(t.e, t.root);
      });
    });
  });
});

describe("composite/intent ops: no-op edges", () => {
  it("indent of a first child is a no-op (returns false, no state change)", () => {
    const t = buildTree();
    const before = stableStringify(toJSON(t.e));
    expect(indent(t.e, [t.a])).toBe(false); // a is the first child of root
    expect(stableStringify(toJSON(t.e))).toBe(before);
  });

  it("outdent of a root is a no-op", () => {
    const t = buildTree();
    const before = stableStringify(toJSON(t.e));
    expect(outdent(t.e, t.root)).toBe(false);
    expect(stableStringify(toJSON(t.e))).toBe(before);
  });

  it("moveSibling past the end is a no-op", () => {
    const t = buildTree();
    const before = stableStringify(toJSON(t.e));
    expect(moveSibling(t.e, t.c, 1)).toBe(false); // c is the last child of root
    expect(stableStringify(toJSON(t.e))).toBe(before);
  });
});
