import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEngine } from "../../engine.js";

const temporaryDirectories: string[] = [];
const vaultPassphrase = "catalog-test-passphrase";

async function createWorkspaceAs(
  engine: Awaited<ReturnType<typeof createEngine>>,
  workspaceId: string,
  label: string,
): Promise<string> {
  const actor = await engine.identity.createActor({ label: `${label} Owner`, passphrase: vaultPassphrase });
  await engine.workspaces.createWorkspace({ workspaceId, label, ownerActorId: actor.actorId });
  return actor.actorId;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("workspace catalog", () => {
  it("creates only through CreateWorkspace and starts every session at boot", async () => {
    const dataRoot = await recordTemporaryHome();
    const engine = await createEngine({ persistence: { dataRoot } });
    try {
      const owner = await createWorkspaceAs(engine, "ws-personal", "Personal");
      expect(await engine.workspaces.listWorkspaces()).toEqual([
        { workspaceId: "ws-personal", label: "Personal", state: "active" },
      ]);
      await expect(
        engine.application.execute({
          kind: "mutate",
          workspaceId: "ws-personal",
          invocationId: "catalog-boot",
          actorId: owner,
          intent: "direct",
          historyChannelId: "test",
          mutations: [
            {
              kind: "node-create",
              nodeId: "node",
              occurrenceId: "occurrence",
              parentNodeId: "ws-personal",
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
          ],
        }),
      ).resolves.toMatchObject({ status: "published" });
    } finally {
      await engine.close();
    }

    // A fresh host over the same data root boots the cataloged session without
    // any client-driven open; the created node survives.
    const restarted = await createEngine({ persistence: { dataRoot } });
    try {
      expect(await restarted.workspaces.listWorkspaces()).toEqual([
        { workspaceId: "ws-personal", label: "Personal", state: "active" },
      ]);
      expect(
        await restarted.application.query({
          kind: "projection",
          workspaceId: "ws-personal",
          perspective: "origin",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
    } finally {
      await restarted.close();
    }
  });

  it("rejects unknown workspace ids without creating storage or catalog entries", async () => {
    const dataRoot = await recordTemporaryHome();
    const engine = await createEngine({ persistence: { dataRoot } });
    try {
      expect(
        await engine.application.query({ kind: "projection", workspaceId: "ghost", perspective: "origin" }),
      ).toMatchObject({ status: "rejected", error: { code: "workspace-not-found" } });
      await expect(
        engine.replicas.synchronize("ghost", {
          profile: async () => await Promise.resolve([]),
          fetch: async () => await Promise.resolve(new Uint8Array()),
          send: async () => {},
        }),
      ).rejects.toThrow("does not exist");
      expect(await engine.workspaces.listWorkspaces()).toEqual([]);
      await createWorkspaceAs(engine, "ghost", "Ghost");
      await expect(
        engine.workspaces.createWorkspace({ workspaceId: "ghost", label: "Other", ownerActorId: "actor_x" }),
      ).rejects.toThrow("already exists");
      expect(await engine.workspaces.listWorkspaces()).toEqual([
        { workspaceId: "ghost", label: "Ghost", state: "active" },
      ]);
      expect(JSON.parse(await readFile(join(dataRoot, "workspace-catalog.json"), "utf8"))).toEqual([
        { workspaceId: "ghost", label: "Ghost" },
      ]);
    } finally {
      await engine.close();
    }
  });

  it("keeps the catalog empty when no workspace was ever created", async () => {
    const dataRoot = await recordTemporaryHome();
    const engine = await createEngine({ persistence: { dataRoot } });
    await engine.close();
    await expect(readFile(join(dataRoot, "workspace-catalog.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

async function recordTemporaryHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lode-workspace-catalog-"));
  temporaryDirectories.push(directory);
  return directory;
}
