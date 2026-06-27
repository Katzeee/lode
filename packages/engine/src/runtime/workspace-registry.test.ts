import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LoroMap } from "loro-crdt";
import { AppWorkspaceRuntime } from "./workspace-registry.js";
import { shardIdOf } from "../core/sharding.js";

/**
 * Step 5b — sharded persistence end-to-end. A sharded workspace (treeDoc + N content
 * shards) is mutated, persisted across sub-doc streams, then reloaded from the same
 * data root; structure (treeDoc) and content (shards) must both survive. Single-doc
 * path is the default and covered by the daemon integration suite.
 */

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lode-sharded-rt-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const buildAndMutate = async (dataRoot: string) => {
  const rt = await AppWorkspaceRuntime.persistent({ dataRoot });
  await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
  await rt.createDoc({ workspaceId: "ws", docId: "main", displayName: "Main" });
  const doc = (await rt.getEngine("ws"))!;
  expect(doc.getShardedStore()).not.toBeNull();

  const before = doc.getVersion();
  const root = doc.createNode(null);
  for (let i = 0; i < 30; i++) {
    doc.createNode(root.occurrenceId, undefined, { i });
  }
  doc.replaceDeltas(root.occurrenceId, [{ insert: "persist me across shards" }]);
  doc.mark(root.occurrenceId, { start: 0, end: 4 }, "bold", true);
  // Persist the whole batch (runMutation does this per-call; here one explicit persist).
  await rt.persistMutation("ws", before);

  const rootOcc = root.occurrenceId;
  const rootText = doc.getOccurrence(rootOcc)?.deltas;
  await rt.close();
  return { rootOcc, rootText };
};

describe("AppWorkspaceRuntime sharded persistence", () => {
  it("restores treeDoc structure + shard content across a restart", async () => {
    const { rootOcc, rootText } = await buildAndMutate(tempDir);

    const rt2 = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    try {
      const doc2 = (await rt2.getEngine("ws"))!;
      expect(doc2.getShardedStore()).not.toBeNull();
      // Structure survived (the root + 30 children).
      const root2 = doc2.getOccurrence(rootOcc);
      expect(root2).toBeDefined();
      expect(doc2.getChildOccurrenceIds(rootOcc).length).toBe(30);
      // Shard content survived (resolved from the lazy-loaded shard on read).
      expect(doc2.getOccurrence(rootOcc)?.deltas).toEqual(rootText);
    } finally {
      await rt2.close();
    }
  });

  it("the runtime is sharded-only (no single-doc path)", async () => {
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    await rt.createDoc({ workspaceId: "ws", docId: "main", displayName: "Main" });
    const doc = (await rt.getEngine("ws"))!;
    expect(doc.getShardedStore()).not.toBeNull(); // always sharded
    await rt.close();
  });

  it("rejects a persisted state that reconcile cannot heal (broken canonical)", async () => {
    // reconcileDurability self-heals create/delete orphans between treeDoc and shards, but
    // it does NOT touch a broken canonical reference. Shards persist as snapshots, so a
    // corrupted canonical survives restart and must be rejected by the load-time
    // validateSnapshot (the sharded analog of the old single-doc import validation).
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    await rt.createDoc({ workspaceId: "ws", docId: "main", displayName: "Main" });
    const doc = (await rt.getEngine("ws"))!;
    const before = doc.getVersion();
    const root = doc.createNode(null);

    const store = doc.getShardedStore()!;
    const shard = store.getShardDoc(shardIdOf(root.nodeId, store.numShards));
    const entity = shard.getMap("entities").get(root.nodeId);
    expect(entity).toBeInstanceOf(LoroMap);
    (entity as LoroMap).set("canonicalOccurrenceId", "ghost-occurrence");
    shard.commit();
    await rt.persistMutation("ws", before);
    await rt.close();

    const rt2 = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    try {
      await expect(rt2.getEngine("ws")).rejects.toThrow(/canonical/i);
    } finally {
      await rt2.close();
    }
  });
});
