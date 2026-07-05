import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toJSON } from "../core/serializers/json.js";
import { generateActorKeypair } from "../utils/crypto/index.js";
import { AppWorkspaceRuntime } from "./workspace-registry.js";

/**
 * forkWorkspace — the Phase 3 recovery primitive (design sync-identity-persistence §13). A fork
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

describe("AppWorkspaceRuntime.forkWorkspace", () => {
  it("copies the source content verbatim and roots a fresh owner (epoch 0, one peer)", async () => {
    const rt = await AppWorkspaceRuntime.inMemory();
    try {
      const owner = generateActorKeypair();
      await rt.createWorkspace({
        workspaceId: "src",
        displayName: "Source",
        actorKeypair: owner,
      });
      // Write content beyond the auto-created root so the copy exercises shards, not just the
      // treeDoc root node. persistMutation is a no-op in-memory, but keeps the doc state current.
      const src = (await rt.getEngine("src"))!;
      const before = src.getVersion();
      const root = src.getRootOccurrences().at(0)!;
      for (let i = 0; i < 5; i++) {
        src.createNode(root.occurrenceId);
      }
      await rt.persistMutation("src", before);

      const forked = await rt.forkWorkspace({
        sourceWorkspaceId: "src",
        displayName: "Fork",
        actorKeypair: owner,
      });

      // New wsId + byte-independent content equality (toJSON is the logical DocSnapshot).
      expect(forked.workspaceId).not.toBe("src");
      expect(forked.displayName).toBe("Fork");
      const forkedDoc = (await rt.getEngine(forked.workspaceId))!;
      expect(toJSON(forkedDoc)).toEqual(toJSON(src));

      // Fresh governance: exactly one record (a root), forker = owner, epoch 0, one peer (the
      // forker's, on this dataRoot). The source's log + re-key chain did NOT carry over.
      const log = rt.membershipLog(forked.workspaceId)!;
      expect(log.records()).toHaveLength(1);
      expect(log.records().at(0)!.body.case).toBe("root");
      const { state } = log.deriveState();
      expect(state.owner).toBe(owner.actorId);
      expect(state.currentEpoch).toBe(0);
      expect(state.peers.size).toBe(1);
      const peer = state.peers.get(String(rt.peerId));
      expect(peer).toBeDefined();
      expect(peer!.owningActorId).toBe(owner.actorId);
    } finally {
      await rt.close();
    }
  });

  it("leaves the source workspace's content and membership log untouched", async () => {
    const rt = await AppWorkspaceRuntime.inMemory();
    try {
      const owner = generateActorKeypair();
      await rt.createWorkspace({
        workspaceId: "src",
        displayName: "Source",
        actorKeypair: owner,
      });
      const src = (await rt.getEngine("src"))!;
      const before = src.getVersion();
      src.createNode(src.getRootOccurrences().at(0)!.occurrenceId);
      await rt.persistMutation("src", before);
      const srcSnapshot = toJSON(src);
      const srcLogLen = rt.membershipLog("src")!.records().length;

      await rt.forkWorkspace({
        sourceWorkspaceId: "src",
        displayName: "Fork",
        actorKeypair: owner,
      });

      expect(toJSON(src)).toEqual(srcSnapshot);
      expect(rt.membershipLog("src")!.records().length).toBe(srcLogLen);
    } finally {
      await rt.close();
    }
  });

  it("persists the forked content + root so they survive a restart", async () => {
    const owner = generateActorKeypair();
    const rt = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    await rt.createWorkspace({
      workspaceId: "src",
      displayName: "Source",
      actorKeypair: owner,
    });
    const src = (await rt.getEngine("src"))!;
    const before = src.getVersion();
    src.createNode(src.getRootOccurrences().at(0)!.occurrenceId);
    await rt.persistMutation("src", before);
    const expected = toJSON(src);
    const forked = await rt.forkWorkspace({
      sourceWorkspaceId: "src",
      displayName: "Fork",
      actorKeypair: owner,
    });
    await rt.close();

    // Reopen the same dataRoot: the forked ws reloads its content (snapshot + shards persisted) and
    // its fresh owner root (membership persisted) — not just the in-memory copy.
    const rt2 = await AppWorkspaceRuntime.persistent({ dataRoot: tempDir });
    try {
      const forkedDoc = (await rt2.getEngine(forked.workspaceId))!;
      expect(toJSON(forkedDoc)).toEqual(expected);
      const log = rt2.membershipLog(forked.workspaceId)!;
      expect(log.records()).toHaveLength(1);
      expect(log.deriveState().state.owner).toBe(owner.actorId);
    } finally {
      await rt2.close();
    }
  });
});
