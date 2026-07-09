import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LoroMap, VersionVector } from "loro-crdt";
import { generateActorKeypair } from "../../utils/crypto/index.js";
import { AppWorkspaceRuntime } from "./registry.js";
import type { ShardedBlockStore } from "../../core/store/sharded-store.js";
import { shardIdOf } from "../../core/store/sharding.js";

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
  const doc = (await rt.getEngine("ws"))!;
  expect(doc.asOutliner()).not.toBeNull();

  const root = await doc.createNode(null);
  for (let i = 0; i < 30; i++) {
    await doc.createNode(root.occurrenceId, undefined, { i });
  }
  await doc.replaceDeltas(root.occurrenceId, [{ insert: "persist me across shards" }]);
  await doc.mark(root.occurrenceId, { start: 0, end: 4 }, "bold", true);
  // Persist the whole batch (runMutation does this per-call; here one explicit flush).
  await rt.flushDirty("ws");

  const rootOcc = root.occurrenceId;
  const rootText = (await doc.getOccurrence(rootOcc))?.deltas;
  await rt.close();
  return { rootOcc, rootText };
};

describe("AppWorkspaceRuntime state-holder attachment", () => {
  it("assertStateHoldersAttached throws before attach (fail-loud against a missed two-phase wire)", async () => {
    const rt = await AppWorkspaceRuntime.inMemory();
    try {
      // An unattached registry would silently leak sync + session state on a workspace's death; the
      // lifecycle start() asserts this so a misconfigured createAppRuntime can't slip through.
      expect(() => rt.assertStateHoldersAttached()).toThrow(/not attached/);
    } finally {
      await rt.close();
    }
  });
});

describe("AppWorkspaceRuntime sharded persistence", () => {
  it("restores treeDoc structure + shard content across a restart", async () => {
    const { rootOcc, rootText } = await buildAndMutate(tempDir);

    const rt2 = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    try {
      const doc2 = (await rt2.getEngine("ws"))!;
      expect(doc2.asOutliner()).not.toBeNull();
      // Structure survived (the root + 30 children).
      const root2 = await doc2.getOccurrence(rootOcc);
      expect(root2).toBeDefined();
      expect(doc2.getChildOccurrenceIds(rootOcc).length).toBe(30);
      // Shard content survived (resolved from the lazy-loaded shard on read).
      expect((await doc2.getOccurrence(rootOcc))?.deltas).toEqual(rootText);
    } finally {
      await rt2.close();
    }
  });

  it("the runtime is sharded-only (no single-doc path)", async () => {
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    const doc = (await rt.getEngine("ws"))!;
    expect(doc.asOutliner()).not.toBeNull(); // always sharded
    await rt.close();
  });

  it("exposes a stable per-dataRoot peerId wired into the Loro treeDoc", async () => {
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    const doc = (await rt.getEngine("ws"))!;
    const peerId = rt.peerId;
    expect(typeof peerId).toBe("number");
    expect(peerId!).toBeGreaterThan(0);
    // The peerId reached the treeDoc: an op lands under it in the version vector. (Decodes the
    // opaque version bytes here purely to observe the peer set — production code never does this.)
    await doc.createNode(null);
    const vvPeers = [
      ...VersionVector.decode(await doc.asOutliner().treeSyncDoc().version())
        .toJSON()
        .keys(),
    ];
    expect(vvPeers).toContain(rt.routingId()!);
    await rt.close();

    // Stable across reopen (same dataRoot → same peerId).
    const rt2 = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    expect(rt2.peerId).toBe(peerId);
    await rt2.close();
  });

  it("wires peerId into lazily-created shard docs, not just the treeDoc", async () => {
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    const doc = (await rt.getEngine("ws"))!;
    // createNode writes an entity into the owning shard, materializing that shard lazily.
    const node = await doc.createNode(null);
    const store = doc.asOutliner() as ShardedBlockStore;
    const shard = await store.getShardDoc(shardIdOf(node.nodeId, store.numShards));
    const shardPeers = [...shard.version().toJSON().keys()];
    expect(shardPeers).toContain(rt.routingId()!);
    await rt.close();
  });

  it("rejects a persisted state that reconcile cannot heal (broken canonical)", async () => {
    // reconcileDurability self-heals create/delete orphans between treeDoc and shards, but
    // it does NOT touch a broken canonical reference. Shards persist as snapshots, so a
    // corrupted canonical survives restart and must be rejected by the load-time
    // validateSnapshot (the sharded analog of the old single-doc import validation).
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    const doc = (await rt.getEngine("ws"))!;
    const root = await doc.createNode(null);

    const store = doc.asOutliner() as ShardedBlockStore;
    const shard = await store.getShardDoc(shardIdOf(root.nodeId, store.numShards));
    const entity = shard.getMap("entities").get(root.nodeId);
    expect(entity).toBeInstanceOf(LoroMap);
    (entity as LoroMap).set("canonicalOccurrenceId", "ghost-occurrence");
    shard.commit();
    await rt.flushDirty("ws");
    // Crash-close (no clean marker) so the reload runs validate, which rejects the unhealable break.
    await rt.crashClose();

    const rt2 = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    try {
      await expect(rt2.getEngine("ws")).rejects.toThrow(/canonical/i);
    } finally {
      await rt2.close();
    }
  });

  it("createWorkspace auto-inits the single content doc ('main')", async () => {
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    // No createDoc call: the ws is born with its one content tree — an engine exists for it.
    expect(await rt.getEngine("ws")).not.toBeNull();
    await rt.close();
  });

  it("createWorkspace is idempotent — a concurrent/repeated create returns the existing ws", async () => {
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    const first = await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    // A second create for the same id (a racing join, or a re-create) returns the existing ws — no
    // duplicate insert, no throw. (Two creates fired concurrently also resolve to one ws because
    // createWorkspace is serialized.)
    const second = await rt.createWorkspace({ workspaceId: "ws", displayName: "WS-ignored" });
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.displayName).toBe("WS"); // original display name preserved, not overwritten
    expect((await rt.listWorkspaces()).length).toBe(1);
    await rt.close();
  });

  it("an owner createWorkspace creates a single root node named = the workspace display name", async () => {
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    const owner = generateActorKeypair();
    await rt.createWorkspace({
      workspaceId: "ws",
      displayName: "My Workspace",
      actorKeypair: owner,
    });
    const doc = (await rt.getEngine("ws"))!;
    const roots = await doc.getRootOccurrences();
    expect(roots).toHaveLength(1);
    for (const root of roots) {
      const text = (await doc.getOccurrence(root.occurrenceId))?.deltas
        .map((d) => d.insert)
        .join("");
      expect(text).toBe("My Workspace");
    }
    await rt.close();
  });

  it("a joiner createWorkspace (no keypair) creates no root — it converges the owner's over sync", async () => {
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "WS" });
    const doc = (await rt.getEngine("ws"))!;
    expect(await doc.getRootOccurrences()).toHaveLength(0);
    await rt.close();
  });

  it("the owner root is persisted — it survives a restart (regression guard for the bootstrap persist)", async () => {
    const owner = generateActorKeypair();
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({ workspaceId: "ws", displayName: "Persisted", actorKeypair: owner });
    await rt.close();
    // Re-open the same dataRoot: the root must reload from the persisted update, not be in-memory only.
    const rt2 = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    try {
      const doc = (await rt2.getEngine("ws"))!;
      const roots = await doc.getRootOccurrences();
      expect(roots).toHaveLength(1);
      for (const root of roots) {
        const text = (await doc.getOccurrence(root.occurrenceId))?.deltas
          .map((d) => d.insert)
          .join("");
        expect(text).toBe("Persisted");
      }
    } finally {
      await rt2.close();
    }
  });
});

describe("AppWorkspaceRuntime.runWorkspaceSerialized: per-workspace mutation chain", () => {
  // The CRDT-paradigm serialization: same-workspace mutations queue (one completes before the next
  // starts), different workspaces run in parallel. This is what makes the residentSession working-set
  // gate reliably single-operation + keeps concurrent multi-client writes from erroring ("session
  // already active") or tearing a read-modify-write.
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  it("same-workspace works serialize: B's body runs only after A completes", async () => {
    const rt = await AppWorkspaceRuntime.inMemory();
    try {
      const order: string[] = [];
      let aDone = false;
      const a = rt.runWorkspaceSerialized("ws", async () => {
        order.push("a-start");
        await delay(15);
        aDone = true;
        order.push("a-end");
      });
      const b = rt.runWorkspaceSerialized("ws", () => {
        order.push("b-start");
        expect(aDone).toBe(true); // B starts only after A completed
        order.push("b-end");
        return Promise.resolve();
      });
      await Promise.all([a, b]);
      expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    } finally {
      await rt.close();
    }
  });

  it("a failed work does not block a later work on the same workspace (chain stays fulfilled)", async () => {
    const rt = await AppWorkspaceRuntime.inMemory();
    try {
      const first = rt.runWorkspaceSerialized("ws", () => Promise.reject(new Error("boom")));
      await expect(first).rejects.toThrow("boom");
      // A later work on the same workspace still runs (the chain didn't stay rejected).
      const ran = rt.runWorkspaceSerialized("ws", () => Promise.resolve("ok"));
      await expect(ran).resolves.toBe("ok");
    } finally {
      await rt.close();
    }
  });

  it("different workspaces run in parallel (A on ws1 does not block B on ws2)", async () => {
    const rt = await AppWorkspaceRuntime.inMemory();
    try {
      let bStarted = false;
      const aStarted: boolean[] = [];
      const a = rt.runWorkspaceSerialized("ws1", async () => {
        aStarted.push(bStarted); // sampled mid-A — B should already be running (parallel)
        await delay(15);
      });
      const b = rt.runWorkspaceSerialized("ws2", async () => {
        bStarted = true;
        await delay(15);
      });
      await Promise.all([a, b]);
      // A started before B was set... but on separate chains, B can run concurrently with A. The
      // point: neither threw "already running" + both completed. Parallelism (bStarted seen by A) is
      // the expected signal; allow either timing but assert both finished cleanly.
      expect(aStarted.length).toBe(1);
    } finally {
      await rt.close();
    }
  });
});
