import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine.js";
import { ShardedBlockStore } from "../src/core/sharded-store.js";
import { shardIdOf } from "../src/core/sharding.js";
import { validateSnapshot } from "../src/core/invariant.js";
import { toJSON } from "../src/core/serializers/json.js";
import { counterGen } from "./equiv.js";

/**
 * Crash recovery — `ShardedBlockStore.reconcileDurability()`. The treeDoc and each shard
 * are independent LoroDocs (persisted separately), so a crash between their writes leaves
 * two kinds of orphan that the sweep does NOT cover:
 *   CREATE-direction: occurrence + ownership present, shard entity absent.
 *   DELETE-direction: shard entity present, ownership already gone.
 * reconcileDurability must reach an invariant-valid fixpoint after either. Ported from
 * the prototype's e-durability.test.ts, adapted to the production ShardedBlockStore.
 *
 * Crashes are simulated via the lazy `shardLoader` hook (serve stale/missing shard bytes
 * on restart), exactly the restart path of a real replica.
 */

const build = (numShards: number): { e: Engine; store: ShardedBlockStore } => {
  const store = new ShardedBlockStore({ numShards });
  return { e: new Engine({ store, nodeIdGenerator: counterGen() }), store };
};

describe("reconcileDurability: crash recovery to an invariant-valid fixpoint", () => {
  it("CREATE-direction orphan (entity missing) → reconcile drops the orphan", () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    const root = e.createNode(null); // n0
    const n1 = e.createNode(root.occurrenceId); // n1
    e.captureSync();

    const treeBytes = store.treeDoc.export({ mode: "snapshot" });
    const rootShard = shardIdOf("n0", numShards);
    const rootShardBytes = store.getShardDoc(rootShard).export({ mode: "snapshot" });
    const xShard = shardIdOf("n1", numShards);

    // Restart losing n1's shard (entity never flushed) → create-orphan.
    const loader = (sid: string): Uint8Array | null =>
      sid === xShard ? null : sid === rootShard ? rootShardBytes : null;
    const restarted = new ShardedBlockStore({
      numShards,
      initialTreeBytes: treeBytes,
      shardLoader: loader,
    });
    expect(() => validateSnapshot(toJSON(new Engine({ store: restarted })))).toThrow(); // n1 orphaned

    restarted.reconcileDurability();
    const e2 = new Engine({ store: restarted });
    expect(() => validateSnapshot(toJSON(e2))).not.toThrow();
    expect(e2.getOccurrence(n1.occurrenceId)).toBeUndefined(); // n1's occurrence dropped
    expect(e2.getChildOccurrenceIds(root.occurrenceId)).toEqual([]); // root has no children
  });

  it("DELETE-direction orphan (entity leaked) → reconcile cleans the stale shard", () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    const root = e.createNode(null); // n0
    e.createNode(root.occurrenceId); // n1
    e.captureSync();
    const n1Shard = shardIdOf("n1", numShards);
    const n1ShardBytes = store.getShardDoc(n1Shard).export({ mode: "snapshot" }); // entity present

    // Hard-delete n1 (ownership gone, occurrence gone) — then snapshot treeDoc.
    e.deleteNode("n1");
    e.captureSync();
    const treeBytes = store.treeDoc.export({ mode: "snapshot" });
    const rootShardBytes = store
      .getShardDoc(shardIdOf("n0", numShards))
      .export({ mode: "snapshot" });

    // Restart: treeDoc flushed (n1 deleted), but n1's shard served STALE (entity leaked).
    const loader = (sid: string): Uint8Array | null =>
      sid === n1Shard ? n1ShardBytes : sid === shardIdOf("n0", numShards) ? rootShardBytes : null;
    const restarted = new ShardedBlockStore({
      numShards,
      initialTreeBytes: treeBytes,
      shardLoader: loader,
    });
    // The leaked entity is an orphan (ownership gone); reconcile must clean it.
    expect(restarted.getShardDoc(n1Shard).getMap("entities").get("n1")).toBeDefined(); // leaked

    restarted.reconcileDurability();
    expect(restarted.getShardDoc(n1Shard).getMap("entities").get("n1")).toBeUndefined(); // cleaned
    expect(() => validateSnapshot(toJSON(new Engine({ store: restarted })))).not.toThrow();
  });

  it("reconcileDurability is idempotent — a second call changes nothing", () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    e.createNode(null);
    e.captureSync();
    store.reconcileDurability();
    const before = store.treeDoc.export({ mode: "snapshot" }).length;
    store.reconcileDurability();
    const after = store.treeDoc.export({ mode: "snapshot" }).length;
    expect(after).toBe(before); // no change
  });
});
