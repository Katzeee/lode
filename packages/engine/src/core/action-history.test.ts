import { describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { ShardedBlockStore } from "./sharded-store.js";
import { ActionHistory } from "./action-history.js";
import type { Delta } from "./types.js";

/**
 * ActionHistory (snapshot-diff undo). Each action captures the before/after state of
 * only the changed occurrences/entities (keyed by the permanent occId), and undo restores
 * the before-state forward through the Engine's own mutators. Driven both directly (via
 * ActionHistory.run, wrapping Engine mutators) and through the wired engine.undo()/redo()
 * path. Verifies structural + content + prop undo/redo on a sharded store, including the
 * cascade-restore inverse (deleteNode with content + children restored across the treeDoc
 * + shards) and the rich-text property (marks survive undo via full-delta restore).
 */

const textToDelta = (s: string): Delta => [{ insert: s }];

const newShardedHistory = (): { e: Engine; h: ActionHistory } => {
  const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
  return { e, h: new ActionHistory(e) };
};

describe("ActionHistory primitives: undo/redo round-trip", () => {
  it("createNode → undo removes it → redo restores it", () => {
    const { e, h } = newShardedHistory();
    const root = e.createNode(null);
    e.resetHistory(); // root created outside any group → drop its lone undo step
    h.run(() => {
      e.createNode(root.occurrenceId, undefined, { kind: "page" });
    });
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(1);

    expect(h.undo()).toBe(true);
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);

    expect(h.redo()).toBe(true);
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(1);
  });

  it("replaceDeltas + mark → undo restores content AND marks", () => {
    const { e, h } = newShardedHistory();
    const a = e.createNode(null);
    e.replaceDeltas(a.occurrenceId, textToDelta("hello world"));
    e.resetHistory();
    h.run(() => {
      e.mark(a.occurrenceId, { start: 0, end: 5 }, "bold", true);
    });
    expect(e.getOccurrence(a.occurrenceId)?.deltas?.[0]?.attributes).toEqual({ bold: true });

    h.undo();
    expect(e.getOccurrence(a.occurrenceId)?.deltas).toEqual(textToDelta("hello world"));
  });

  it("setProp → undo restores the previous value (or unsets)", () => {
    const { e, h } = newShardedHistory();
    const a = e.createNode(null);
    e.setProp(a.occurrenceId, "tag", "old");
    e.resetHistory();
    h.run(() => {
      e.setProp(a.occurrenceId, "tag", "new");
    });
    expect(e.getProp(a.occurrenceId, "tag")).toBe("new");

    h.undo();
    expect(e.getProp(a.occurrenceId, "tag")).toBe("old");
  });

  it("moveOccurrence → undo moves it back", () => {
    const { e, h } = newShardedHistory();
    const root = e.createNode(null);
    const a = e.createNode(root.occurrenceId);
    const b = e.createNode(root.occurrenceId);
    e.resetHistory();
    h.run(() => {
      e.moveOccurrence(b.occurrenceId, a.occurrenceId);
    });
    expect(e.getChildOccurrenceIds(a.occurrenceId)).toContain(b.occurrenceId);

    h.undo();
    expect(e.getChildOccurrenceIds(root.occurrenceId)).toContain(b.occurrenceId);
  });
});

describe("ActionHistory deleteNode: undo restores a node + its shard content", () => {
  it("delete a leaf node with content → undo restores it (cross-doc: content from shard)", () => {
    const { e, h } = newShardedHistory();
    const root = e.createNode(null);
    const a = e.createNode(root.occurrenceId);
    e.replaceDeltas(a.occurrenceId, textToDelta("AAA"));
    const before = JSON.stringify(e.getOccurrence(a.occurrenceId)?.deltas);
    e.resetHistory();

    h.run(() => {
      e.deleteNode(a.nodeId);
    });
    expect(e.getOccurrence(a.occurrenceId)).toBeUndefined();

    h.undo();
    const restored = e.getOccurrences(a.nodeId);
    expect(restored.length).toBe(1);
    expect(JSON.stringify(restored[0]?.deltas)).toBe(before);
  });
});

describe("ActionHistory grouping: run() folds multiple ops into one undo step", () => {
  it("two ops in one run() → one undo reverts both", () => {
    const { e, h } = newShardedHistory();
    const root = e.createNode(null);
    e.resetHistory();
    h.run(() => {
      e.createNode(root.occurrenceId);
      e.createNode(root.occurrenceId);
    });
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(2);

    h.undo();
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);
  });
});

/**
 * The wired path. Engine mutators auto-group (each top-level op = one undo step), and
 * engine.undo()/redo()/canUndo() route to ActionHistory — so undo works through the
 * normal Engine API (the path services/history.ts uses), not just by driving
 * ActionHistory directly.
 */
describe("ActionHistory wired into Engine: engine.undo() works on a sharded store", () => {
  it("engine.createNode auto-groups → engine.undo()/redo() round-trip (sharded)", () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
    const root = e.createNode(null);
    e.resetHistory();
    e.createNode(root.occurrenceId);
    expect(e.canUndo()).toBe(true);
    expect(e.undo()).toBe(true);
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);
    expect(e.redo()).toBe(true);
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(1);
  });

  it("engine.transact() groups sharded ops into one undo step", () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
    const root = e.createNode(null);
    e.resetHistory();
    e.transact(() => {
      e.createNode(root.occurrenceId);
      e.createNode(root.occurrenceId);
    });
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(2);
    e.undo();
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);
  });

  it("nested transact/batch joins the outer group (re-entrant, one undo step)", () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
    const root = e.createNode(null);
    e.resetHistory();
    // A batch that opens its own batch inside — must not throw, and must collapse to one step.
    e.batch(() => {
      e.createNode(root.occurrenceId);
      e.batch(() => {
        e.createNode(root.occurrenceId);
      });
      e.createNode(root.occurrenceId);
    });
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(3);
    e.undo();
    // One undo step removes all three.
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);
    expect(e.canUndo()).toBe(false);
  });
});
