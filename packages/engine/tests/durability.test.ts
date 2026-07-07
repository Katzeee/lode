import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine.js";
import { ShardedBlockStore, TREE_SUBDOC } from "../src/core/sharded-store.js";
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
 * Crashes are simulated by which shard snapshots the restart carries (omitted = lost, stale =
 * leaked) — exactly the restart path of a real replica (tree eager, shards fault lazily).
 */

const build = (numShards: number): { e: Engine; store: ShardedBlockStore } => {
  // Fresh per call: yield "root","child", then fall back. Two nodes is all these scenarios create.
  const ids = ["root", "child"];
  let i = 0;
  const gen = (): string => ids[i++] ?? `x${i}`;
  const store = new ShardedBlockStore({ numShards });
  return { e: new Engine({ store, nodeIdGenerator: gen }), store };
};

/** Restart into a fresh store from [outwardId, snapshot] pairs: the tree entry → eager treeBytes,
 *  each `sys:s{k}` entry → a shardSnaps seed (others omitted = the lost shard). Snapshots only —
 *  mirrors how shards persist. */
const restart = (numShards: number, entries: [string, Uint8Array][]): ShardedBlockStore => {
  let treeBytes: LoadedDocBytes | undefined;
  const shardSnaps = new Map<string, LoadedDocBytes>();
  for (const [id, snapshot] of entries) {
    if (id === SYS_PREFIX + TREE_SUBDOC) {
      treeBytes = { snapshot, updates: [] };
    } else if (id.startsWith(SYS_PREFIX)) {
      shardSnaps.set(id.slice(SYS_PREFIX.length), { snapshot, updates: [] });
    }
  }
  return new ShardedBlockStore({ numShards, treeBytes, shardSnaps });
};

describe("reconcileDurability: crash recovery to an invariant-valid fixpoint", () => {
  it("CREATE-direction orphan (entity missing) → reconcile drops the orphan", async () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    const root = await e.createNode(null); // "root" → s1
    const child = await e.createNode(root.occurrenceId); // "child" → s7
    e.captureSync();

    const treeBytes = await store.treeSyncDoc().exportSnapshot();
    const rootShard = shardIdOf("root", numShards);
    const rootShardBytes = (await store.getShardDoc(rootShard)).export({ mode: "snapshot" });

    // Restart losing child's shard (entity never flushed) → child is a create-orphan. The restart
    // carries the tree + root's shard; child's shard is omitted (a missing seed = the lost shard).
    const restarted = restart(numShards, [
      [store.treeSyncDoc().id, treeBytes],
      [SYS_PREFIX + rootShard, rootShardBytes],
    ]);
    await expect(async () =>
      validateSnapshot(await toJSON(new Engine({ store: restarted }))),
    ).rejects.toThrow(); // child orphaned

    await restarted.reconcileDurability();
    const e2 = new Engine({ store: restarted });
    validateSnapshot(await toJSON(e2)); // invariant-valid after reconcile
    expect(await e2.getOccurrence(child.occurrenceId)).toBeUndefined(); // child's occurrence dropped
    expect(e2.getChildOccurrenceIds(root.occurrenceId)).toEqual([]); // root has no children
  });

  it("DELETE-direction orphan (entity leaked) → reconcile cleans the stale shard", async () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    const root = await e.createNode(null); // "root" → s1
    await e.createNode(root.occurrenceId); // "child" → s7
    e.captureSync();
    const childShard = shardIdOf("child", numShards);
    const childShardBytes = (await store.getShardDoc(childShard)).export({
      mode: "snapshot",
    }); // entity present

    // Hard-delete child (ownership gone, occurrence gone) — then snapshot treeDoc.
    await e.deleteNode("child");
    e.captureSync();
    const treeBytes = await store.treeSyncDoc().exportSnapshot();
    const rootShardBytes = (await store.getShardDoc(shardIdOf("root", numShards))).export({
      mode: "snapshot",
    });

    // Restart: treeDoc flushed (child deleted), but child's shard served STALE (entity leaked).
    const restarted = restart(numShards, [
      [store.treeSyncDoc().id, treeBytes],
      [SYS_PREFIX + shardIdOf("root", numShards), rootShardBytes],
      [SYS_PREFIX + childShard, childShardBytes],
    ]);
    // The leaked entity is an orphan (ownership gone); reconcile must clean it.
    expect((await restarted.getShardDoc(childShard)).getMap("entities").get("child")).toBeDefined(); // leaked

    await restarted.reconcileDurability();
    expect(
      (await restarted.getShardDoc(childShard)).getMap("entities").get("child"),
    ).toBeUndefined(); // cleaned
    validateSnapshot(await toJSON(new Engine({ store: restarted }))); // invariant-valid after reconcile
  });

  it("reconcileDurability is idempotent — a second call changes nothing", async () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    await e.createNode(null);
    e.captureSync();
    await store.reconcileDurability();
    const before = (await store.treeSyncDoc().exportSnapshot()).length;
    await store.reconcileDurability();
    const after = (await store.treeSyncDoc().exportSnapshot()).length;
    expect(after).toBe(before); // no change
  });
});
