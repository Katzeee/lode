import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine.js";
import { ShardedBlockStore } from "../src/core/sharded-store.js";
import { shardIdOf } from "../src/core/sharding.js";
import { SYS_PREFIX, type LoadedDocBytes } from "../src/core/index.js";
import { validateSnapshot } from "../src/core/invariant.js";
import { toJSON } from "../src/core/serializers/json.js";

/**
 * Crash recovery — `ShardedBlockStore.reconcileDurability()`. The treeDoc and each shard
 * are independent LoroDocs (persisted separately), so a crash between their writes leaves
 * two kinds of orphan that the sweep does NOT cover:
 *   CREATE-direction: occurrence + ownership present, shard entity absent.
 *   DELETE-direction: shard entity present, ownership already gone.
 * reconcileDurability must reach an invariant-valid fixpoint after either.
 *
 * Node ids "root" (→ s1) and "child" (→ s7 at numShards=8) are in DIFFERENT shards — the orphan
 * scenarios need a lost shard distinct from a kept one, which co-located ids can't express.
 * Crashes are simulated by which shard snapshots the residentBytes map carries (omitted = lost,
 * stale = leaked), exactly the restart path of a real replica.
 */

const build = (numShards: number): { e: Engine; store: ShardedBlockStore } => {
  // Fresh per call: yield "root","child", then fall back. Two nodes is all these scenarios create.
  const ids = ["root", "child"];
  let i = 0;
  const gen = (): string => ids[i++] ?? `x${i}`;
  const store = new ShardedBlockStore({ numShards });
  return { e: new Engine({ store, nodeIdGenerator: gen }), store };
};

/** Build a residentBytes map from [outwardId, snapshot] pairs (no incremental updates — these
 *  scenarios persist snapshots only, mirroring how shards persist). */
const resident = (entries: [string, Uint8Array][]): Map<string, LoadedDocBytes> => {
  const map = new Map<string, LoadedDocBytes>();
  for (const [id, snapshot] of entries) {
    map.set(id, { snapshot, updates: [] });
  }
  return map;
};

describe("reconcileDurability: crash recovery to an invariant-valid fixpoint", () => {
  it("CREATE-direction orphan (entity missing) → reconcile drops the orphan", () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    const root = e.createNode(null); // "root" → s1
    const child = e.createNode(root.occurrenceId); // "child" → s7
    e.captureSync();

    const treeBytes = store.treeSyncDoc().exportSnapshot();
    const rootShard = shardIdOf("root", numShards);
    const rootShardBytes = store.getShardDoc(rootShard).export({ mode: "snapshot" });

    // Restart losing child's shard (entity never flushed) → child is a create-orphan. The map carries
    // the tree + root's shard; child's shard is omitted (a missing entry = the lost shard).
    const restarted = new ShardedBlockStore({
      numShards,
      residentBytes: resident([
        [store.treeSyncDoc().id, treeBytes],
        [SYS_PREFIX + rootShard, rootShardBytes],
      ]),
    });
    expect(() => validateSnapshot(toJSON(new Engine({ store: restarted })))).toThrow(); // child orphaned

    restarted.reconcileDurability();
    const e2 = new Engine({ store: restarted });
    expect(() => validateSnapshot(toJSON(e2))).not.toThrow();
    expect(e2.getOccurrence(child.occurrenceId)).toBeUndefined(); // child's occurrence dropped
    expect(e2.getChildOccurrenceIds(root.occurrenceId)).toEqual([]); // root has no children
  });

  it("DELETE-direction orphan (entity leaked) → reconcile cleans the stale shard", () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    const root = e.createNode(null); // "root" → s1
    e.createNode(root.occurrenceId); // "child" → s7
    e.captureSync();
    const childShard = shardIdOf("child", numShards);
    const childShardBytes = store.getShardDoc(childShard).export({ mode: "snapshot" }); // entity present

    // Hard-delete child (ownership gone, occurrence gone) — then snapshot treeDoc.
    e.deleteNode("child");
    e.captureSync();
    const treeBytes = store.treeSyncDoc().exportSnapshot();
    const rootShardBytes = store
      .getShardDoc(shardIdOf("root", numShards))
      .export({ mode: "snapshot" });

    // Restart: treeDoc flushed (child deleted), but child's shard served STALE (entity leaked).
    const restarted = new ShardedBlockStore({
      numShards,
      residentBytes: resident([
        [store.treeSyncDoc().id, treeBytes],
        [SYS_PREFIX + shardIdOf("root", numShards), rootShardBytes],
        [SYS_PREFIX + childShard, childShardBytes],
      ]),
    });
    // The leaked entity is an orphan (ownership gone); reconcile must clean it.
    expect(restarted.getShardDoc(childShard).getMap("entities").get("child")).toBeDefined(); // leaked

    restarted.reconcileDurability();
    expect(restarted.getShardDoc(childShard).getMap("entities").get("child")).toBeUndefined(); // cleaned
    expect(() => validateSnapshot(toJSON(new Engine({ store: restarted })))).not.toThrow();
  });

  it("reconcileDurability is idempotent — a second call changes nothing", () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    e.createNode(null);
    e.captureSync();
    store.reconcileDurability();
    const before = store.treeSyncDoc().exportSnapshot().length;
    store.reconcileDurability();
    const after = store.treeSyncDoc().exportSnapshot().length;
    expect(after).toBe(before); // no change
  });
});
