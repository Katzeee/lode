import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEngine, type Engine, type EngineOptions } from "../src/engine.js";
import { NodePersistenceBackend } from "../src/subsystems/persistence/node-persistence-backend.js";
import type { TrashEvidenceResult } from "@lode/sdk";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const vaultPassphrase = "workspace-host-passphrase";

async function createWorkspaceAs(engine: Engine, workspaceId: string, label: string): Promise<string> {
  const actor = await engine.api.identity.createActor({ label: `${label} Owner`, passphrase: vaultPassphrase });
  await engine.api.workspaces.createWorkspace({ workspaceId, label, ownerActorId: actor.actorId });
  return actor.actorId;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Engine workspace host capabilities", () => {
  it("creates a named Workspace, lists it with its label, and keeps the registry across restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-workspace-host-"));
    temporaryDirectories.push(dataRoot);

    const engine = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    await createWorkspaceAs(engine, "personal", "Personal");
    await createWorkspaceAs(engine, "tasks", "Task and Project");

    expect(await engine.api.workspaces.listWorkspaces()).toEqual([
      { workspaceId: "personal", label: "Personal", state: "active" },
      { workspaceId: "tasks", label: "Task and Project", state: "active" },
    ]);

    await expect(
      engine.api.workspaces.createWorkspace({ workspaceId: "personal", label: "Other", ownerActorId: "actor_x" }),
    ).rejects.toThrow("already exists");

    await engine.stop();

    const restarted = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    expect(await restarted.api.workspaces.listWorkspaces()).toEqual([
      { workspaceId: "personal", label: "Personal", state: "active" },
      { workspaceId: "tasks", label: "Task and Project", state: "active" },
    ]);
    await restarted.stop();
  });

  it("serves Trash Evidence for restore and clears it after restore", async () => {
    const engine = await startEngine();
    const tester = await createWorkspaceAs(engine, "workspace", "Workspace");
    await engine.api.application.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "setup",
      actorId: tester,
      intent: "direct",
      historyChannelId: "test",
      mutations: [
        {
          kind: "node-create",
          nodeId: "parent",
          occurrenceId: "parent-original",
          parentNodeId: "workspace",
          anchor: end,
        },
        { kind: "node-create", nodeId: "draft", occurrenceId: "draft-original", parentNodeId: "parent", anchor: end },
      ],
    });
    const activeDraft = await trashEvidence(engine, "workspace", "draft");
    expect(activeDraft.available).toBe(false);

    await engine.api.application.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "trash-draft",
      actorId: tester,
      intent: "direct",
      historyChannelId: "test",
      mutations: [{ kind: "node-delete", nodeId: "draft" }],
    });

    const parentEvidence = await trashEvidence(engine, "workspace", "parent");
    expect(parentEvidence.available).toBe(false);

    const draftEvidence = await trashEvidence(engine, "workspace", "draft");
    expect(draftEvidence.available).toBe(true);
    expect(draftEvidence.occurrenceId).toBe("draft-original");
    expect(draftEvidence.previousParentNodeId).toBe("parent");
    expect(draftEvidence.previousOwnerNodeId).toBe("parent");
    expect(draftEvidence.deletionFactId).not.toBe("");

    const restored = await engine.api.application.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "restore-draft",
      actorId: tester,
      intent: "direct",
      historyChannelId: "test",
      mutations: [
        {
          kind: "node-restore",
          nodeId: "draft",
          deletionFactId: draftEvidence.deletionFactId,
          occurrenceId: draftEvidence.occurrenceId,
          ownerNodeId: draftEvidence.previousOwnerNodeId,
          parentNodeId: draftEvidence.previousParentNodeId,
          anchor: draftEvidence.previousAnchor ?? end,
        },
      ],
    });
    expect(restored.status).toBe("published");
    expect((await trashEvidence(engine, "workspace", "draft")).available).toBe(false);
    await engine.stop();
  });
});

async function trashEvidence(engine: Engine, workspaceId: string, nodeId: string): Promise<TrashEvidenceResult> {
  const result = await engine.api.application.query({
    kind: "trash-evidence",
    workspaceId,
    perspective: "origin",
    nodeId,
  });
  if (result.status !== "ok") {
    throw new Error(`trash-evidence query rejected: ${result.error.message}`);
  }
  return result.value as TrashEvidenceResult;
}

async function startEngine(options?: EngineOptions): Promise<Engine> {
  const engine = createEngine(options);
  await engine.start();
  return engine;
}
