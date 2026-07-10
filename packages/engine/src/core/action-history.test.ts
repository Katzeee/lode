import { describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { ShardedBlockStore } from "./store/sharded-store.js";
import { shardIdOf } from "./store/sharding.js";
import { InMemoryDocStore } from "./store/in-memory-doc-store.js";
import type { LoadedDocBytes } from "./store/doc-store.js";
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
  it("createNode → undo removes it → redo restores it", async () => {
    const { e, h } = newShardedHistory();
    const root = await e.createNode(null);
    e.resetHistory(); // root created outside any group → drop its lone undo step
    await h.run(async () => {
      await e.createNode(root.occurrenceId, undefined, { kind: "page" });
    });
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(1);

    expect(await h.undo()).toBe(true);
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);

    expect(await h.redo()).toBe(true);
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(1);
  });

  it("replaceDeltas + mark → undo restores content AND marks", async () => {
    const { e, h } = newShardedHistory();
    const a = await e.createNode(null);
    await e.replaceDeltas(a.occurrenceId, textToDelta("hello world"));
    e.resetHistory();
    await h.run(async () => {
      await e.mark(a.occurrenceId, { start: 0, end: 5 }, "bold", true);
    });
    expect((await e.getOccurrence(a.occurrenceId))?.deltas?.[0]?.attributes).toEqual({
      bold: true,
    });

    await h.undo();
    expect((await e.getOccurrence(a.occurrenceId))?.deltas).toEqual(textToDelta("hello world"));
  });

  it("setProp → undo restores the previous value (or unsets)", async () => {
    const { e, h } = newShardedHistory();
    const a = await e.createNode(null);
    await e.setProp(a.occurrenceId, "tag", "old");
    e.resetHistory();
    await h.run(async () => {
      await e.setProp(a.occurrenceId, "tag", "new");
    });
    expect(await e.getProp(a.occurrenceId, "tag")).toBe("new");

    await h.undo();
    expect(await e.getProp(a.occurrenceId, "tag")).toBe("old");
  });

  it("moveOccurrence → undo moves it back", async () => {
    const { e, h } = newShardedHistory();
    const root = await e.createNode(null);
    const a = await e.createNode(root.occurrenceId);
    const b = await e.createNode(root.occurrenceId);
    e.resetHistory();
    await h.run(async () => {
      await e.moveOccurrence(b.occurrenceId, a.occurrenceId);
    });
    expect(e.getChildOccurrenceIds(a.occurrenceId)).toContain(b.occurrenceId);

    await h.undo();
    expect(e.getChildOccurrenceIds(root.occurrenceId)).toContain(b.occurrenceId);
  });
});

describe("ActionHistory deleteNode: undo restores a node + its shard content", () => {
  it("delete a leaf node with content → undo restores it (cross-doc: content from shard)", async () => {
    const { e, h } = newShardedHistory();
    const root = await e.createNode(null);
    const a = await e.createNode(root.occurrenceId);
    await e.replaceDeltas(a.occurrenceId, textToDelta("AAA"));
    const before = JSON.stringify((await e.getOccurrence(a.occurrenceId))?.deltas);
    e.resetHistory();

    await h.run(async () => {
      await e.deleteNode(a.nodeId);
    });
    expect(await e.getOccurrence(a.occurrenceId)).toBeUndefined();

    await h.undo();
    const restored = await e.getOccurrences(a.nodeId);
    expect(restored.length).toBe(1);
    expect(JSON.stringify(restored[0]?.deltas)).toBe(before);
  });
});

describe("ActionHistory grouping: run() folds multiple ops into one undo step", () => {
  it("two ops in one run() → one undo reverts both", async () => {
    const { e, h } = newShardedHistory();
    const root = await e.createNode(null);
    e.resetHistory();
    await h.run(async () => {
      await e.createNode(root.occurrenceId);
      await e.createNode(root.occurrenceId);
    });
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(2);

    await h.undo();
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);
  });
});

/**
 * The wired path. Engine mutators auto-group (each top-level op = one undo step), and
 * engine.undo()/redo()/canUndo() route to ActionHistory — so undo works through the
 * normal Engine API (the path commands/history.ts uses), not just by driving
 * ActionHistory directly.
 */
describe("ActionHistory wired into Engine: engine.undo() works on a sharded store", () => {
  it("engine.createNode auto-groups → engine.undo()/redo() round-trip (sharded)", async () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
    const root = await e.createNode(null);
    e.resetHistory();
    await e.createNode(root.occurrenceId);
    expect(e.canUndo()).toBe(true);
    expect(await e.undo()).toBe(true);
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);
    expect(await e.redo()).toBe(true);
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(1);
  });

  it("engine.transact() groups sharded ops into one undo step", async () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
    const root = await e.createNode(null);
    e.resetHistory();
    await e.transact(async () => {
      await e.createNode(root.occurrenceId);
      await e.createNode(root.occurrenceId);
    });
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(2);
    await e.undo();
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);
  });

  it("nested transact/batch joins the outer group (re-entrant, one undo step)", async () => {
    const e = new Engine({ store: new ShardedBlockStore({ numShards: 8 }) });
    const root = await e.createNode(null);
    e.resetHistory();
    // A batch that opens its own batch inside — must not throw, and must collapse to one step.
    await e.batch(async () => {
      await e.createNode(root.occurrenceId);
      await e.batch(async () => {
        await e.createNode(root.occurrenceId);
      });
      await e.createNode(root.occurrenceId);
    });
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(3);
    await e.undo();
    // One undo step removes all three.
    expect(e.getChildOccurrenceIds(root.occurrenceId).length).toBe(0);
    expect(e.canUndo()).toBe(false);
  });
});

describe("incremental capture: undo materializes only the touched shard", () => {
  it("a local edit + undo faults only the edited node's shard, not every shard", async () => {
    const numShards = 8;
    // Seed a tree fanned across many shards.
    const seed = new ShardedBlockStore({ numShards });
    const seedEngine = new Engine({ store: seed });
    const root = await seedEngine.createNode(null);
    const childNodeIds: string[] = [];
    for (let i = 0; i < 40; i++) {
      childNodeIds.push((await seedEngine.createNode(root.occurrenceId)).nodeId);
    }
    seedEngine.captureSync();
    expect(seed.shardIds().length).toBeGreaterThan(1); // fanned across >1 shard

    // Reload into a fresh store: tree eager, shards seeded into an InMemoryDocStore (in-memory clone
    // — the shard LoroDocs are NOT resident until faulted).
    const treeDoc = seed.treeSyncDoc();
    const treeBytes: LoadedDocBytes = {
      snapshot: await treeDoc.exportSnapshot(),
      updates: [],
    };
    const shardSeed = new Map<string, LoadedDocBytes>();
    for (const d of seed.shardSyncDocs()) {
      shardSeed.set(d.id, {
        snapshot: await d.exportSnapshot(),
        updates: [],
      });
    }
    const faults: string[] = [];
    const store = new ShardedBlockStore({
      numShards,
      treeBytes,
      docStore: new InMemoryDocStore(shardSeed),
      onFault: (id) => faults.push(id),
    });
    const e = new Engine({ store });

    // A local edit on ONE child + its undo. Only that child's shard may materialize — the
    // pre-Phase-2 full-toJSON undo capture walked every entity and would have faulted every shard.
    const targetNodeId = childNodeIds.at(0)!;
    const targetShard = shardIdOf(targetNodeId, numShards);
    const targetOcc = await e.getCanonicalOccurrenceId(targetNodeId);
    await e.replaceDeltas(targetOcc, [{ insert: "x" }]);
    expect(await e.undo()).toBe(true);

    expect(new Set(faults)).toEqual(new Set([targetShard]));
  });
});
