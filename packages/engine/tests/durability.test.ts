import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine.js";
import { ShardedBlockStore, TREE_SUBDOC } from "../src/core/store/sharded-store.js";
import { shardIdOf } from "../src/core/store/sharding.js";
import {
  SYS_PREFIX,
  InMemoryDocStore,
  type DocStore,
  type LoadedDocBytes,
} from "../src/core/index.js";
import { validateSnapshot } from "../src/core/invariant.js";
import { toJSON } from "../src/core/serialize.js";
import { readStoredShard, residentShardDoc, snapshotShard } from "./support/shard-doc.js";

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
 *  each `sys:s{k}` entry → a seeded InMemoryDocStore (others omitted = the lost shard). Snapshots
 *  only — mirrors how shards persist. */
const restartStores = new WeakMap<ShardedBlockStore, InMemoryDocStore>();

const restart = (numShards: number, entries: [string, Uint8Array][]): ShardedBlockStore => {
  let treeBytes: LoadedDocBytes | undefined;
  const shardSeed = new Map<string, LoadedDocBytes>();
  for (const [id, snapshot] of entries) {
    if (id === SYS_PREFIX + TREE_SUBDOC) {
      treeBytes = { snapshot, updates: [] };
    } else if (id.startsWith(SYS_PREFIX)) {
      shardSeed.set(id, { snapshot, updates: [] });
    }
  }
  const docStore = new InMemoryDocStore(shardSeed);
  const store = new ShardedBlockStore({ numShards, treeBytes, docStore });
  restartStores.set(store, docStore);
  return store;
};

const storedRestartShard = (store: ShardedBlockStore, shardId: string) => {
  const docStore = restartStores.get(store);
  if (docStore === undefined) {
    throw new Error("store was not created by restart()");
  }
  return readStoredShard(docStore, shardId);
};

/** A round-tripping in-memory DocStore: records writes + reconstructs on load — lets durability
 *  tests exercise the persistent flush + restart path without a real sqlite sink. */
function recordingDocStore(): DocStore & {
  recs: Map<string, { updates: Uint8Array[]; snapshots: Uint8Array[]; seq: number }>;
} {
  const recs = new Map<string, { updates: Uint8Array[]; snapshots: Uint8Array[]; seq: number }>();
  const rec = (id: string) => {
    let r = recs.get(id);
    if (!r) {
      r = { updates: [], snapshots: [], seq: 0 };
      recs.set(id, r);
    }
    return r;
  };
  return {
    recs,
    load: (id) => {
      const r = recs.get(id);
      return Promise.resolve(
        r ? { snapshot: r.snapshots.at(-1) ?? null, updates: [...r.updates] } : null,
      );
    },
    listIds: () => Promise.resolve([...recs.keys()]),
    appendUpdate: (id, bytes) => {
      const r = rec(id);
      r.updates.push(bytes);
      return Promise.resolve(++r.seq);
    },
    writeSnapshot: (id, bytes) => {
      rec(id).snapshots.push(bytes);
      return Promise.resolve();
    },
  };
}

describe("reconcileDurability: crash recovery to an invariant-valid fixpoint", () => {
  it("CREATE-direction orphan (entity missing) → reconcile drops the orphan", async () => {
    const numShards = 8;
    const { e, store } = build(numShards);
    const root = await e.createNode(null); // "root" → s1
    const child = await e.createNode(root.occurrenceId); // "child" → s7
    e.captureSync();

    const treeBytes = await store.treeSyncDoc().exportSnapshot();
    const rootShard = shardIdOf("root", numShards);
    const rootShardBytes = await snapshotShard(store, rootShard);

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
    const childShardBytes = await snapshotShard(store, childShard); // entity present

    // Hard-delete child (ownership gone, occurrence gone) — then snapshot treeDoc.
    await e.deleteNode("child");
    e.captureSync();
    const treeBytes = await store.treeSyncDoc().exportSnapshot();
    const rootShardBytes = await snapshotShard(store, shardIdOf("root", numShards));

    // Restart: treeDoc flushed (child deleted), but child's shard served STALE (entity leaked).
    const restarted = restart(numShards, [
      [store.treeSyncDoc().id, treeBytes],
      [SYS_PREFIX + shardIdOf("root", numShards), rootShardBytes],
      [SYS_PREFIX + childShard, childShardBytes],
    ]);
    // The leaked entity is an orphan (ownership gone); reconcile must clean it.
    expect(
      (await storedRestartShard(restarted, childShard)).getMap("entities").get("child"),
    ).toBeDefined(); // leaked

    await restarted.reconcileDurability();
    expect(residentShardDoc(restarted, childShard).getMap("entities").get("child")).toBeUndefined(); // reconcile repairs the resident shard before returning

    await restarted.flushDirty();
    expect(
      (await storedRestartShard(restarted, childShard)).getMap("entities").get("child"),
    ).toBeUndefined(); // the repair is persisted
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

// NOTE on the missing "sync → crashClose → reopen → read" test (Phase C's other half): the full
// loop can't run at the engine layer because driving a real sync round in-process requires the
// source and receiver LoroDocs to COEXIST, and cross-peer import degrades the shared wasm enough
// to hang later in-process sync tests (a loro-level coexistence issue, not a correctness one).
// The reload half — "can a receiver that synced cross-peer content, persisted, and restarted read
// it back?" — is verified safe in `reload-cross-peer.test.ts`: with the source docs freed first,
// a fresh doc reads `toDelta` cleanly off both a snapshot and a raw update reload. So the
// production read-after-sync path is sound; only the in-process sync round is out of reach here.
// The content-round wiring (`ContentRound.runRound` → `flushDirty`, one line in round.ts) is
// verified by reading the code; the full sync→restart loop belongs in the daemon e2e (RPC
// transport, separate processes). The test below proves the Phase C guarantee end-to-end for
// LOCALLY-produced content (a reconcile heal): flushDirty persists, unpins, and the healed state
// survives a real reopen — the same flush mechanism the content round uses.

describe("Phase C: heal is persisted + the reconcile pin leak is fixed (flushDirty after reconcile)", () => {
  it("reconcile unpins its healed shards via flushDirty → residentShardCount ≤ capacity; heal survives restart", async () => {
    const numShards = 8;
    const cap = 1;
    // Seed a persistent store with root (s1) + child (s7), snapshotted (snapshotEveryUpdates=1).
    const seed = recordingDocStore();
    const seedStore = new ShardedBlockStore({
      numShards,
      docStore: seed,
      snapshotEveryUpdates: 1,
    });
    // Deterministic ids so "child" names the second node (→ s7 at numShards=8, distinct from root's s1).
    const ids = ["root", "child"];
    let i = 0;
    const gen = (): string => ids[i++] ?? `x${i}`;
    const es = new Engine({ store: seedStore, nodeIdGenerator: gen });
    const root = await es.createNode(null); // "root" → s1
    await es.createNode(root.occurrenceId); // "child" → s7
    es.captureSync();
    await seedStore.flushDirty();

    // Capture child's shard snapshot (entity present) BEFORE the delete — this is the leaked bytes.
    const childShard = shardIdOf("child", numShards);
    const leakedChildBytes = await snapshotShard(seedStore, childShard);

    // Hard-delete child (ownership + occurrence gone), persist → the tree + root's shard advance.
    await es.deleteNode("child");
    es.captureSync();
    await seedStore.flushDirty();

    // Build the orphan restart DocStore: the POST-delete tree + root's shard (post-delete) + child's
    // STALE shard (entity leaked — ownership gone but the entity is still served).
    const orphan = recordingDocStore();
    const treeId = seedStore.treeSyncDoc().id;
    await orphan.writeSnapshot(treeId, await seedStore.treeSyncDoc().exportSnapshot());
    await orphan.writeSnapshot(
      SYS_PREFIX + shardIdOf("root", numShards),
      await snapshotShard(seedStore, shardIdOf("root", numShards)),
    );
    await orphan.writeSnapshot(SYS_PREFIX + childShard, leakedChildBytes);

    const store = new ShardedBlockStore({
      numShards,
      capacity: cap,
      docStore: orphan,
      snapshotEveryUpdates: 1,
    });
    // The leaked entity is an orphan (ownership gone); reconcile must clean it.
    expect(
      (await readStoredShard(orphan, childShard)).getMap("entities").get("child"),
    ).toBeDefined();

    await store.reconcileDurability();
    // reconcile deleted the orphan entity via shardForWrite → child's shard is now dirty (markDirty).
    // Writes no longer pin (Phase 3): the dirty shard is freely evictable, and flushDirty persists
    // the heal + reclaims to capacity. The pre-Phase-C "write-pin leaks past reconcile" failure mode
    // is gone by design — there is no write-pin to leak.
    await store.flushDirty();
    expect(store.residentShardCount).toBeLessThanOrEqual(cap);
    expect(
      (await readStoredShard(orphan, childShard)).getMap("entities").get("child"),
    ).toBeUndefined(); // cleaned

    // The heal was persisted: a fresh reopen still sees the orphan cleaned (no re-heal needed).
    const reopened = new ShardedBlockStore({
      numShards,
      capacity: cap,
      treeBytes: (await orphan.load(treeId))!,
      docStore: orphan,
      snapshotEveryUpdates: 1,
    });
    expect(
      (await readStoredShard(orphan, childShard)).getMap("entities").get("child"),
    ).toBeUndefined();
    validateSnapshot(await toJSON(new Engine({ store: reopened })));
  });
});

/**
 * Phase 6 — the narrow content-persistence round-trip the durability NOTE used to verify "by reading
 * the code": write text → flushDirty → reload from the SAME DocStore → read it back. Same-peerId
 * (the persisting peer's own bytes), so no cross-peer wasm coexistence — the loop the daemon e2e
 * owns in full. Exercises the exact persistence path sync uses (markDirty → flushDirty → reload),
 * proving the bytes that flushDirty writes are the bytes a reload reads.
 */
describe("Phase 6: content round-trips through flushDirty + reload (same DocStore)", () => {
  it("text written + flushed reloads from the same DocStore", async () => {
    const numShards = 8;
    const docStore = recordingDocStore();
    const store = new ShardedBlockStore({ numShards, docStore, snapshotEveryUpdates: 1 });
    const e = new Engine({ store });
    const root = await e.createNode(null);
    await e.replaceDeltas(root.occurrenceId, [{ insert: "persisted text" }]);
    e.captureSync();
    await store.flushDirty();

    const reopened = new ShardedBlockStore({
      numShards,
      docStore,
      snapshotEveryUpdates: 1,
      treeBytes: (await docStore.load(SYS_PREFIX + TREE_SUBDOC))!,
    });
    const e2 = new Engine({ store: reopened });
    const reloadedRoot = (await e2.getRootOccurrences()).at(0)!;
    const deltas = await e2.getDeltas(reloadedRoot.occurrenceId);
    expect(deltas.map((d) => d.insert).join("")).toBe("persisted text");
  });
});
