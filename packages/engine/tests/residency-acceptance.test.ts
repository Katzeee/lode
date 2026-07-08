import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateActorKeypair } from "../src/utils/crypto/index.js";
import { AppWorkspaceRuntime } from "../src/runtime/workspace-registry.js";
import type { ShardedBlockStore } from "../src/core/sharded-store.js";

/**
 * Terminal acceptance for the lazy shard cache: residentShardCount ≤ the configured capacity
 * across the full-set paths (load / edit / undo / fork), at quiescent points (after persist +
 * evictToFit). The cache bound is the whole point of sharding — content ≫ memory.
 */

let tempDir: string;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lode-residency-"));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const storeOf = (doc: { asOutliner(): unknown }): ShardedBlockStore =>
  doc.asOutliner() as ShardedBlockStore;

describe("terminal acceptance: residentShardCount ≤ capacity across load / edit / undo / fork", () => {
  it("a large workspace stays within capacity on load, edit, undo, and fork", async () => {
    const cap = 4;
    const rt = await AppWorkspaceRuntime.persistent({
      dataRoot: tempDir,
      shardCacheCapacity: cap,
    });
    const owner = generateActorKeypair();
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS", actorKeypair: owner });
    const doc = (await rt.getEngine("ws"))!;
    const root = (await doc.getRootOccurrences()).at(0)!;

    // Create 40 children (fanned across many of the 256 shards) — far beyond capacity.
    const occs: string[] = [];
    for (let i = 0; i < 40; i++) {
      occs.push((await doc.createNode(root.occurrenceId)).occurrenceId);
    }
    await storeOf(doc).flushDirty(); // flush + unpin + evictToFit
    expect(storeOf(doc).residentShardCount).toBeLessThanOrEqual(cap);

    // Edit a node, flush → resident still bounded.
    await doc.replaceDeltas(occs.at(0)!, [{ insert: "edited" }]);
    await storeOf(doc).flushDirty();
    expect(storeOf(doc).residentShardCount).toBeLessThanOrEqual(cap);

    // Undo the edit, flush → resident still bounded.
    await doc.undo();
    await storeOf(doc).flushDirty();
    expect(storeOf(doc).residentShardCount).toBeLessThanOrEqual(cap);

    // close + reopen (load): only the tree is eager → shards fault lazily, resident bounded.
    await rt.close();
    const rt2 = await AppWorkspaceRuntime.persistent({
      dataRoot: tempDir,
      shardCacheCapacity: cap,
    });
    const doc2 = (await rt2.getEngine("ws"))!;
    expect(storeOf(doc2).residentShardCount).toBeLessThanOrEqual(cap);

    // Fork: the destination store is lazy over the fork DocStore → resident bounded.
    const forker = generateActorKeypair();
    const forkInfo = await rt2.forkWorkspace({
      sourceWorkspaceId: "ws",
      displayName: "fork",
      actorKeypair: forker,
    });
    const forkDoc = (await rt2.getEngine(forkInfo.workspaceId))!;
    expect(storeOf(forkDoc).residentShardCount).toBeLessThanOrEqual(cap);

    await rt2.close();
  });
});
