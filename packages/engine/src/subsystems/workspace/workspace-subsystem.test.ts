import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEngine, type Engine, type EngineOptions } from "../../engine.js";
import { makeFact } from "../../domain/fact/index.js";
import type {
  PersistenceBackend,
  PhysicalIdentityStorage,
  PhysicalWorkspaceStorage,
  PhysicalWorkspaceStorageStage,
} from "../persistence/backend.js";
import { NodePersistenceBackend } from "../persistence/node-persistence-backend.js";
import { SyncExchange } from "../synchronization/sync-exchange.js";
import { InMemoryReplicaPeer } from "../../../tests/support/sync.js";
import { buildEngineSubsystems } from "../index.js";
import { createEventSubsystemDefinition } from "../event/event-subsystem.js";
import { createIdentitySubsystemDefinition } from "../identity/identity-subsystem.js";
import { createPersistenceSubsystemDefinition } from "../persistence/persistence-subsystem.js";
import { createWorkspaceSubsystemDefinition } from "./workspace-subsystem.js";
import { workspaceGenesisFact } from "./workspace-genesis-validation.js";

const temporaryDirectories: string[] = [];
const vaultPassphrase = "catalog-test-passphrase";

async function createWorkspaceAs(engine: Engine, workspaceId: string, label: string): Promise<string> {
  const actor = await engine.api.identity.createActor({ label: `${label} Owner`, passphrase: vaultPassphrase });
  await engine.api.workspaces.createWorkspace({ workspaceId, label, ownerActorId: actor.actorId });
  return actor.actorId;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Workspace durable inventory", () => {
  it("rejects established authority that omits the Workspace genesis", () => {
    const owner = `actor_${"0".repeat(64)}`;
    const replicaId = "101";
    const establishment = makeFact({
      workspaceId: "workspace",
      replicaId,
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "governance",
        actorId: owner,
        action: { kind: "workspace-establish", ownerActorId: owner },
      },
    });

    expect(() => workspaceGenesisFact("workspace", [establishment])).toThrow("exactly one Workspace bootstrap action");
  });

  it("rejects a bootstrap marker that does not establish the system structure atomically", () => {
    const owner = `actor_${"0".repeat(64)}`;
    const establishment = makeFact({
      workspaceId: "workspace",
      replicaId: "101",
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "governance",
        actorId: owner,
        action: { kind: "workspace-establish", ownerActorId: owner },
      },
    });
    const incomplete = makeFact({
      workspaceId: "workspace",
      replicaId: "101",
      sequence: 2,
      observed: { "101": 1 },
      lamport: 2,
      body: {
        kind: "action",
        actorId: owner,
        intent: "direct",
        actions: [{ kind: "workspace-bootstrap", workspaceNodeId: "workspace" }],
      },
    });

    expect(() => workspaceGenesisFact("workspace", [establishment, incomplete])).toThrow(
      "complete Workspace system structure",
    );
  });

  it("creates only through CreateWorkspace and opens every promoted Workspace at boot", async () => {
    const dataRoot = await recordTemporaryHome();
    const engine = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    try {
      const owner = await createWorkspaceAs(engine, "ws-personal", "Personal");
      expect(await engine.api.workspaces.listWorkspaces()).toEqual([{ workspaceId: "ws-personal", label: "Personal" }]);
      await expect(
        engine.api.application.execute({
          kind: "edit",
          workspaceId: "ws-personal",
          invocationId: "rename-workspace",
          actorId: owner,
          intent: "direct",
          historyChannelId: "test",
          actions: [
            {
              kind: "rich-text-splice",
              nodeId: "ws-personal",
              deleteAtomIds: [],
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
              insert: " Updated",
            },
          ],
        }),
      ).resolves.toMatchObject({ status: "published" });
      expect(await engine.api.workspaces.listWorkspaces()).toEqual([
        { workspaceId: "ws-personal", label: "Personal Updated" },
      ]);
      await expect(
        engine.api.application.execute({
          kind: "edit",
          workspaceId: "ws-personal",
          invocationId: "catalog-boot",
          actorId: owner,
          intent: "direct",
          historyChannelId: "test",
          actions: [
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
      await engine.stop();
    }

    // A fresh host enumerates final storage without any client-driven open;
    // the created node survives.
    const restarted = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    try {
      expect(await restarted.api.workspaces.listWorkspaces()).toEqual([
        { workspaceId: "ws-personal", label: "Personal Updated" },
      ]);
      expect(
        await restarted.api.application.query({
          kind: "projection",
          workspaceId: "ws-personal",
          perspective: "origin",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
    } finally {
      await restarted.stop();
    }
  });

  it("rejects unknown workspace ids without creating storage or catalog entries", async () => {
    const dataRoot = await recordTemporaryHome();
    const engine = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    try {
      expect(
        await engine.api.application.query({ kind: "projection", workspaceId: "ghost", perspective: "origin" }),
      ).toMatchObject({ status: "rejected", error: { code: "workspace-not-found" } });
      await expect(engine.api.replicas.synchronize("ghost", "unreachable")).rejects.toThrow("does not exist");
      expect(await engine.api.workspaces.listWorkspaces()).toEqual([]);
      await createWorkspaceAs(engine, "ghost", "Ghost");
      await expect(
        engine.api.workspaces.createWorkspace({ workspaceId: "ghost", label: "Other", ownerActorId: "actor_x" }),
      ).rejects.toThrow("already exists");
      expect(await engine.api.workspaces.listWorkspaces()).toEqual([{ workspaceId: "ghost", label: "Ghost" }]);
      expect(await readdir(join(dataRoot, "workspaces"))).toContain("workspace-Z2hvc3Q.sqlite");
      await expect(readFile(join(dataRoot, "workspace-catalog.json"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await engine.stop();
    }
  });

  it("keeps the catalog empty when no workspace was ever created", async () => {
    const dataRoot = await recordTemporaryHome();
    const engine = await startEngine({ persistence: new NodePersistenceBackend(dataRoot) });
    await engine.stop();
    await expect(readFile(join(dataRoot, "workspace-catalog.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("discards an active staging Workspace when its owner stops", async () => {
    const dataRoot = await recordTemporaryHome();
    const source = await sourceWithWorkspace("interrupted");
    const first = buildWorkspaceSubsystem(dataRoot);
    await first.lifecycle.start();
    const staging = await first.api.stage("interrupted");
    await new SyncExchange(staging.sync, new InMemoryReplicaPeer(source.api.replica("interrupted").sync)).sync();
    await first.lifecycle.stop();
    expect((await readdir(join(dataRoot, "workspaces"))).some((name) => name.startsWith(".staging-"))).toBe(false);

    const restarted = buildWorkspaceSubsystem(dataRoot);
    await restarted.lifecycle.start();
    expect(await restarted.api.list()).toEqual([]);
    expect((await readdir(join(dataRoot, "workspaces"))).some((name) => name.startsWith(".staging-"))).toBe(false);
    await restarted.lifecycle.stop();
    await source.lifecycle.stop();
  }, 30_000);

  it("promotes a complete staging Workspace into restart-stable final inventory", async () => {
    const dataRoot = await recordTemporaryHome();
    const source = await sourceWithWorkspace("adopted");
    const first = buildWorkspaceSubsystem(dataRoot);
    await first.lifecycle.start();
    const staging = await first.api.stage("adopted");
    await new SyncExchange(staging.sync, new InMemoryReplicaPeer(source.api.replica("adopted").sync)).sync();
    await expect(staging.promote()).resolves.toEqual({ workspaceId: "adopted", label: "Adopted" });
    expect(await first.api.list()).toEqual([{ workspaceId: "adopted", label: "Adopted" }]);
    await first.lifecycle.stop();

    const restarted = buildWorkspaceSubsystem(dataRoot);
    await restarted.lifecycle.start();
    expect(await restarted.api.list()).toEqual([{ workspaceId: "adopted", label: "Adopted" }]);
    await restarted.lifecycle.stop();
    await source.lifecycle.stop();
  }, 30_000);

  it("finishes an admitted promotion while its owner stops", async () => {
    const dataRoot = await recordTemporaryHome();
    const source = await sourceWithWorkspace("concurrent-promotion");
    const backend = new GatedPromotionBackend(new NodePersistenceBackend(dataRoot));
    const first = buildWorkspaceSubsystem(dataRoot, backend);
    await first.lifecycle.start();
    const staging = await first.api.stage("concurrent-promotion");
    await new SyncExchange(
      staging.sync,
      new InMemoryReplicaPeer(source.api.replica("concurrent-promotion").sync),
    ).sync();

    const promotion = staging.promote();
    await backend.promotionEntered;
    const stopping = first.lifecycle.stop();
    backend.continuePromotion();

    await expect(promotion).resolves.toEqual({ workspaceId: "concurrent-promotion", label: "Interrupted" });
    await expect(stopping).resolves.toBeUndefined();

    const restarted = buildWorkspaceSubsystem(dataRoot);
    await restarted.lifecycle.start();
    expect(await restarted.api.list()).toEqual([{ workspaceId: "concurrent-promotion", label: "Interrupted" }]);
    await restarted.lifecycle.stop();
    await source.lifecycle.stop();
  }, 30_000);
});

function buildWorkspaceSubsystem(dataRoot: string, backend: PersistenceBackend = new NodePersistenceBackend(dataRoot)) {
  const persistence = createPersistenceSubsystemDefinition(backend);
  const event = createEventSubsystemDefinition();
  const identity = createIdentitySubsystemDefinition(persistence);
  const workspace = createWorkspaceSubsystemDefinition(persistence, event, identity);
  return buildEngineSubsystems(
    [workspace, identity, event, persistence] as const,
    ({ workspace: capability, identity: identityCapability }) => ({
      ...capability,
      createActor: identityCapability.vault.createActor,
    }),
  );
}

async function sourceWithWorkspace(workspaceId: string) {
  const dataRoot = await recordTemporaryHome();
  const source = buildWorkspaceSubsystem(dataRoot);
  await source.lifecycle.start();
  const owner = await source.api.createActor({ label: "Owner", passphrase: vaultPassphrase });
  await source.api.create({
    workspaceId,
    label: workspaceId === "adopted" ? "Adopted" : "Interrupted",
    ownerActorId: owner.actorId,
  });
  return source;
}

async function startEngine(options?: EngineOptions): Promise<Engine> {
  const engine = createEngine(options);
  await engine.start();
  return engine;
}

async function recordTemporaryHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lode-workspace-inventory-"));
  temporaryDirectories.push(directory);
  return directory;
}

class GatedPromotionBackend implements PersistenceBackend {
  private releasePromotion!: () => void;
  private markPromotionEntered!: () => void;
  private readonly promotionGate = new Promise<void>((resolve) => {
    this.releasePromotion = resolve;
  });
  readonly promotionEntered = new Promise<void>((resolve) => {
    this.markPromotionEntered = resolve;
  });

  constructor(private readonly backend: PersistenceBackend) {}

  continuePromotion(): void {
    this.releasePromotion();
  }

  openIdentityStorage(): Promise<PhysicalIdentityStorage> {
    return this.backend.openIdentityStorage();
  }

  listWorkspaceIds(): Promise<readonly string[]> {
    return this.backend.listWorkspaceIds();
  }

  openWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorage> {
    return this.backend.openWorkspace(workspaceId);
  }

  async stageWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorageStage> {
    const stage = await this.backend.stageWorkspace(workspaceId);
    return {
      ...stage,
      promote: async () => {
        this.markPromotionEntered();
        await this.promotionGate;
        return stage.promote();
      },
    };
  }

  discardStagedWorkspaces(): Promise<void> {
    return this.backend.discardStagedWorkspaces();
  }

  close(): void | Promise<void> {
    return this.backend.close();
  }
}
