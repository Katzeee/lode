import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateActorKeypair } from "../src/crypto/index.js";
import { TestWorkspaceRegistry as WorkspaceRegistry } from "./support/workspace-registry.js";
import type { ShardedBlockStore } from "../src/core/store/sharded-store.js";

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

const storeOf = (engine: { asOutliner(): unknown }): ShardedBlockStore =>
  engine.asOutliner() as ShardedBlockStore;

const engineOf = (registry: WorkspaceRegistry, workspaceId: string) =>
  registry.runWorkspace(workspaceId, ({ engine }) => engine);

describe("terminal acceptance: residentShardCount ≤ capacity across load / edit / undo / fork", () => {
  it("a large workspace stays within capacity on load, edit, undo, and fork", async () => {
    const cap = 4;
    const rt = await WorkspaceRegistry.persistent({
      dataRoot: tempDir,
      shardCacheCapacity: cap,
    });
    const owner = generateActorKeypair();
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS", actorKeypair: owner });
    const engine = await engineOf(rt, "ws");
    const root = (await engine.getRootOccurrences()).at(0)!;

    // Create 40 children (fanned across many of the 256 shards) — far beyond capacity.
    const occs: string[] = [];
    for (let i = 0; i < 40; i++) {
      occs.push((await engine.createNode(root.occurrenceId)).occurrenceId);
    }
    await storeOf(engine).flushDirty(); // flush + unpin + evictToFit
    expect(storeOf(engine).residentShardCount).toBeLessThanOrEqual(cap);

    // Edit a node, flush → resident still bounded.
    await engine.replaceDeltas(occs.at(0)!, [{ insert: "edited" }]);
    await storeOf(engine).flushDirty();
    expect(storeOf(engine).residentShardCount).toBeLessThanOrEqual(cap);

    // Undo the edit, flush → resident still bounded.
    await engine.undo();
    await storeOf(engine).flushDirty();
    expect(storeOf(engine).residentShardCount).toBeLessThanOrEqual(cap);

    // close + reopen (load): only the tree is eager → shards fault lazily, resident bounded.
    await rt.close();
    const rt2 = await WorkspaceRegistry.persistent({
      dataRoot: tempDir,
      shardCacheCapacity: cap,
    });
    const doc2 = await engineOf(rt2, "ws");
    expect(storeOf(doc2).residentShardCount).toBeLessThanOrEqual(cap);

    // Fork: the destination store is lazy over the fork DocStore → resident bounded.
    const forker = generateActorKeypair();
    const forkInfo = await rt2.forkWorkspace({
      sourceWorkspaceId: "ws",
      displayName: "fork",
      actorKeypair: forker,
    });
    const forkDoc = await engineOf(rt2, forkInfo.workspaceId);
    expect(storeOf(forkDoc).residentShardCount).toBeLessThanOrEqual(cap);

    await rt2.close();
  });
});
