import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toJSON } from "../../core/serialize.js";
import { generateActorKeypair } from "../../crypto/index.js";
import { TestWorkspaceRegistry as WorkspaceRegistry } from "../../../tests/support/workspace-registry.js";

async function engineOf(registry: WorkspaceRegistry, workspaceId: string) {
  return registry.runWorkspace(workspaceId, ({ engine }) => engine);
}

async function membershipOf(registry: WorkspaceRegistry, workspaceId: string) {
  return registry.runWorkspace(workspaceId, ({ membership }) => membership);
}

/**
 * forkWorkspace — the recovery primitive (design sync-identity-persistence §13). A fork
 * copies the source's content (treeDoc + shards) into a NEW wsId with an EMPTY membership log +
 * a fresh owner root signed by the forker. These tests pin the three guarantees: content is
 * copied verbatim (incl. across a restart, so persistence is real), the new governance starts
 * from a forker-signed epoch-0 root with exactly one peer, and the source is left untouched.
 */

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lode-fork-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("WorkspaceRegistry.forkWorkspace", () => {
  it("copies the source content verbatim and roots a fresh owner (epoch 0, one peer)", async () => {
    const rt = await WorkspaceRegistry.inMemory();
    try {
      const owner = generateActorKeypair();
      await rt.createWorkspace({
        workspaceId: "src",
        displayName: "Source",
        actorKeypair: owner,
      });
      // Write content beyond the auto-created root so the copy exercises shards, not just the
      // treeDoc root node. (flushDirty is a no-op in-memory; content lives in the resident docs.)
      const src = await engineOf(rt, "src");
      const root = (await src.getRootOccurrences()).at(0)!;
      for (let i = 0; i < 5; i++) {
        await src.createNode(root.occurrenceId);
      }
      await rt.flushDirty("src");

      const forked = await rt.forkWorkspace({
        sourceWorkspaceId: "src",
        displayName: "Fork",
        actorKeypair: owner,
      });

      // New wsId + byte-independent content equality (toJSON is the logical DocSnapshot).
      expect(forked.workspaceId).not.toBe("src");
      expect(forked.displayName).toBe("Fork");
      const forkedDoc = await engineOf(rt, forked.workspaceId);
      expect(await toJSON(forkedDoc)).toEqual(await toJSON(src));

      // Fresh governance: exactly one record (a root), forker = owner, epoch 0, one peer (the
      // forker's, on this dataRoot). The source's log + re-key chain did NOT carry over.
      const log = await membershipOf(rt, forked.workspaceId);
      expect(log.records()).toHaveLength(1);
      expect(log.records().at(0)!.body.case).toBe("root");
      const { state } = log.deriveState();
      expect(state.owner).toBe(owner.actorId);
      expect(state.currentEpoch).toBe(0);
      expect(state.peers.size).toBe(1);
      const peer = state.peers.get(rt.routingId()!);
      expect(peer).toBeDefined();
      expect(peer!.owningActorId).toBe(owner.actorId);
    } finally {
      await rt.close();
    }
  });

  it("leaves the source workspace's content and membership log untouched", async () => {
    const rt = await WorkspaceRegistry.inMemory();
    try {
      const owner = generateActorKeypair();
      await rt.createWorkspace({
        workspaceId: "src",
        displayName: "Source",
        actorKeypair: owner,
      });
      const src = await engineOf(rt, "src");
      await src.createNode((await src.getRootOccurrences()).at(0)!.occurrenceId);
      await rt.flushDirty("src");
      const srcSnapshot = await toJSON(src);
      const srcLogLen = (await membershipOf(rt, "src")).records().length;

      await rt.forkWorkspace({
        sourceWorkspaceId: "src",
        displayName: "Fork",
        actorKeypair: owner,
      });

      expect(await toJSON(src)).toEqual(srcSnapshot);
      expect((await membershipOf(rt, "src")).records().length).toBe(srcLogLen);
    } finally {
      await rt.close();
    }
  });

  it("persists the forked content + root so they survive a restart", async () => {
    const owner = generateActorKeypair();
    const rt = await WorkspaceRegistry.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({
      workspaceId: "src",
      displayName: "Source",
      actorKeypair: owner,
    });
    const src = await engineOf(rt, "src");
    await src.createNode((await src.getRootOccurrences()).at(0)!.occurrenceId);
    await rt.flushDirty("src");
    const expected = await toJSON(src);
    const forked = await rt.forkWorkspace({
      sourceWorkspaceId: "src",
      displayName: "Fork",
      actorKeypair: owner,
    });
    await rt.close();

    // Reopen the same dataRoot: the forked ws reloads its content (snapshot + shards persisted) and
    // its fresh owner root (membership persisted) — not just the in-memory copy.
    const rt2 = await WorkspaceRegistry.persistent({ dataRoot: tempDir });
    try {
      const forkedDoc = await engineOf(rt2, forked.workspaceId);
      expect(await toJSON(forkedDoc)).toEqual(expected);
      const log = await membershipOf(rt2, forked.workspaceId);
      expect(log.records()).toHaveLength(1);
      expect(log.deriveState().state.owner).toBe(owner.actorId);
    } finally {
      await rt2.close();
    }
  });
});
