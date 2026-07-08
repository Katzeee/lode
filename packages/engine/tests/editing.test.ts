import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine.js";
import { ShardedBlockStore } from "../src/core/store/sharded-store.js";
import { toJSON } from "../src/core/serialize.js";
import { validateSnapshot } from "../src/core/invariant.js";
import type { DocSnapshot } from "../src/core/types.js";
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
function normalizeSnapshot(snap: DocSnapshot): unknown {
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

const canonical = async (e: Engine): Promise<string> =>
  stableStringify(normalizeSnapshot(await toJSON(e)));

async function roundTrip(e: Engine, act: () => Promise<unknown>): Promise<void> {
  e.resetHistory();
  expect(e.canUndo()).toBe(false);
  const before = await canonical(e);
  await act();
  expect(e.canUndo()).toBe(true);
  validateSnapshot(await toJSON(e));
  const after = await canonical(e);
  // One undo restores `before` exactly, and leaves nothing more to undo.
  expect(await e.undo()).toBe(true);
  expect(await canonical(e)).toBe(before);
  expect(e.canUndo()).toBe(false);
  // Redo restores `after`.
  expect(await e.redo()).toBe(true);
  expect(await canonical(e)).toBe(after);
}

async function buildTree(): Promise<{
  e: Engine;
  root: string;
  a: string;
  b: string;
  c: string;
  a1: string;
  a2: string;
}> {
  const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
  const root = await e.createNode(null);
  const a = await createPlainNode(e, root.occurrenceId);
  const b = await createPlainNode(e, root.occurrenceId);
  const c = await createPlainNode(e, root.occurrenceId);
  const a1 = await createPlainNode(e, a.occurrenceId);
  const a2 = await createPlainNode(e, a.occurrenceId);
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
  it("cloneOccurrence clones a subtree in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, () => cloneOccurrence(t.e, t.a));
  });

  it("removeOccurrenceOrHardDelete cascades in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, () => removeOccurrenceOrHardDelete(t.e, t.a)); // a has children a1,a2 → cascade
  });

  it("hardDeleteNode in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, async () => {
      await hardDeleteNode(t.e, (await t.e.mustGetOccurrence(t.a)).nodeId);
    });
  });

  it("paste (multi-source) in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, () => paste(t.e, [t.a, t.b], t.c));
  });

  it("duplicate in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, () => duplicate(t.e, t.a));
  });

  it("indent (single) in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, async () => {
      expect(await indent(t.e, [t.b])).toBe(true);
    });
  });

  it("indent (contiguous multi) in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, async () => {
      expect(await indent(t.e, [t.b, t.c])).toBe(true);
    });
  });

  it("outdent in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, async () => {
      expect(await outdent(t.e, t.a1)).toBe(true);
    });
  });

  it("moveSibling in one undo step", async () => {
    const t = await buildTree();
    await roundTrip(t.e, async () => {
      expect(await moveSibling(t.e, t.b, 1)).toBe(true);
    });
  });

  it("a grouped primitive called inside an outer batch joins it (nest-safe, one step)", async () => {
    const t = await buildTree();
    await roundTrip(t.e, async () => {
      await t.e.batch(async () => {
        // removeOccurrenceOrHardDelete opens its own batch (cascades on a) — must JOIN the
        // outer batch, not open a second undo step.
        await removeOccurrenceOrHardDelete(t.e, t.a);
        await createPlainNode(t.e, t.root);
      });
    });
  });
});

describe("composite/intent ops: no-op edges", () => {
  it("indent of a first child is a no-op (returns false, no state change)", async () => {
    const t = await buildTree();
    const before = stableStringify(await toJSON(t.e));
    expect(await indent(t.e, [t.a])).toBe(false); // a is the first child of root
    expect(stableStringify(await toJSON(t.e))).toBe(before);
  });

  it("outdent of a root is a no-op", async () => {
    const t = await buildTree();
    const before = stableStringify(await toJSON(t.e));
    expect(await outdent(t.e, t.root)).toBe(false);
    expect(stableStringify(await toJSON(t.e))).toBe(before);
  });

  it("moveSibling past the end is a no-op", async () => {
    const t = await buildTree();
    const before = stableStringify(await toJSON(t.e));
    expect(await moveSibling(t.e, t.c, 1)).toBe(false); // c is the last child of root
    expect(stableStringify(await toJSON(t.e))).toBe(before);
  });
});
