import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type {
  PersistenceBackend,
  PhysicalIdentityStorage,
  PhysicalWorkspaceStorage,
  PhysicalWorkspaceStorageStage,
} from "./backend.js";
import { InMemoryPersistenceBackend } from "../../../tests/support/persistence/in-memory-persistence-backend.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { NodePersistenceBackend } from "@lode/engine-platform-desktop";
import { buildEngineSubsystems } from "../index.js";
import type { PersistenceCapability } from "./capability.js";
import { createPersistenceSubsystemDefinition } from "./persistence-subsystem.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("PersistenceSubsystem", () => {
  it("owns identity and role-scoped Workspace storage through one capability", async () => {
    const { lifecycle, api } = buildPersistence(new InMemoryPersistenceBackend());
    await lifecycle.start();

    const identity = await api.identityStorage.open();
    await identity.vault.write(bytes("vault"));
    expect(text(await identity.vault.read())).toBe("vault");

    const staged = await api.workspaceStorage.stage("workspace/with a special id");
    await staged.storage.facts.writeSnapshot("state", bytes("authority"));
    await staged.storage.metadata.writeSnapshot("identity", bytes("local"));
    expect(text((await staged.storage.facts.load("state"))?.snapshot ?? null)).toBe("authority");
    expect(text((await staged.storage.metadata.load("identity"))?.snapshot ?? null)).toBe("local");
    expect(await api.workspaceStorage.list()).toEqual([]);

    await staged.promote();
    expect(await api.workspaceStorage.list()).toEqual(["workspace/with a special id"]);
    const reopened = await api.workspaceStorage.open("workspace/with a special id");
    expect(text((await reopened.facts.load("state"))?.snapshot ?? null)).toBe("authority");
    expect(text((await reopened.metadata.load("identity"))?.snapshot ?? null)).toBe("local");
    await Promise.all([reopened.release(), reopened.release()]);
    await lifecycle.stop();
  });

  it("enumerates promoted SQLite storage after a new backend opens", async () => {
    const dataRoot = await temporaryDirectory();
    const first = buildPersistence(new NodePersistenceBackend(dataRoot));
    await first.lifecycle.start();
    const staged = await first.api.workspaceStorage.stage("workspace/跨平台");
    await staged.storage.metadata.writeSnapshot("identity-proof", bytes("stored"));
    await staged.promote();
    await first.lifecycle.stop();

    const second = buildPersistence(new NodePersistenceBackend(dataRoot));
    await second.lifecycle.start();
    expect(await second.api.workspaceStorage.list()).toEqual(["workspace/跨平台"]);
    const reopened = await second.api.workspaceStorage.open("workspace/跨平台");
    expect(text((await reopened.metadata.load("identity-proof"))?.snapshot ?? null)).toBe("stored");
    await second.lifecycle.stop();
  });

  it("rolls back promoted SQLite storage before the owner accepts it", async () => {
    const dataRoot = await temporaryDirectory();
    const built = buildPersistence(new NodePersistenceBackend(dataRoot));
    await built.lifecycle.start();
    const staged = await built.api.workspaceStorage.stage("activation-failed");
    await staged.storage.metadata.writeSnapshot("identity-proof", bytes("stored"));

    const promotion = await staged.promote();
    expect(await built.api.workspaceStorage.list()).toEqual(["activation-failed"]);
    await promotion.rollback();

    expect(await built.api.workspaceStorage.list()).toEqual([]);
    await expect(built.api.workspaceStorage.open("activation-failed")).rejects.toThrow(
      "Workspace storage does not exist",
    );
    await built.lifecycle.stop();
  });

  it("discards orphan staging storage without making it visible", async () => {
    const dataRoot = await temporaryDirectory();
    const abandoned = new NodePersistenceBackend(dataRoot);
    const staged = await abandoned.stageWorkspace("interrupted");
    await staged.storage.documents.writeSnapshot("metadata/partial", bytes("partial"));
    await staged.storage.close();
    abandoned.close();

    const built = buildPersistence(new NodePersistenceBackend(dataRoot));
    await built.lifecycle.start();
    expect(await built.api.workspaceStorage.list()).toEqual([]);
    expect((await readdir(join(dataRoot, "workspaces"))).some((name) => name.startsWith(".staging-"))).toBe(false);
    await built.lifecycle.stop();
  });

  it("does not create final storage when asked to open an absent Workspace", async () => {
    const dataRoot = await temporaryDirectory();
    const backend = new NodePersistenceBackend(dataRoot);

    await expect(backend.openWorkspace("absent")).rejects.toThrow("Workspace storage does not exist");
    expect(await backend.listWorkspaceIds()).toEqual([]);
  });

  it("does not reinterpret an unreadable Workspace directory as an empty registry", async () => {
    const dataRoot = await temporaryDirectory();
    await writeFile(join(dataRoot, "workspaces"), "not a directory", "utf8");
    const backend = new NodePersistenceBackend(dataRoot);

    await expect(backend.listWorkspaceIds()).rejects.toThrow();
    await expect(backend.discardStagedWorkspaces()).rejects.toThrow();
  });

  it("surfaces a corrupt identity in a reserved Workspace authority filename", async () => {
    const dataRoot = await temporaryDirectory();
    const workspaces = join(dataRoot, "workspaces");
    await mkdir(workspaces, { recursive: true });
    await writeFile(join(workspaces, "workspace-not+base64.sqlite"), "corrupt", "utf8");

    const backend = new NodePersistenceBackend(dataRoot);
    await expect(backend.listWorkspaceIds()).rejects.toThrow("Workspace storage filename contains a corrupt identity");
  });

  it("continues orphan cleanup after an independent staging artifact fails", async () => {
    const dataRoot = await temporaryDirectory();
    const workspaces = join(dataRoot, "workspaces");
    const invalid = join(workspaces, ".staging-0.sqlite");
    const removable = join(workspaces, ".staging-1.sqlite");
    await mkdir(invalid, { recursive: true });
    await writeFile(removable, "orphan", "utf8");

    const backend = new NodePersistenceBackend(dataRoot);
    await expect(backend.discardStagedWorkspaces()).rejects.toThrow();
    await expect(access(removable)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(invalid)).resolves.toBeUndefined();
  });

  it("attempts every resource and backend close and reports every failure", async () => {
    const closeAttempts: string[] = [];
    const backend = failingCloseBackend(closeAttempts);
    const { lifecycle, api } = buildPersistence(backend);
    await lifecycle.start();
    await api.workspaceStorage.open("first");
    await api.workspaceStorage.open("second");

    const stopping = lifecycle.stop();
    await expect(stopping).rejects.toBeInstanceOf(AggregateError);
    await expect(stopping).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "close second" }),
        expect.objectContaining({ message: "close first" }),
        expect.objectContaining({ message: "close backend" }),
      ],
    });
    expect(closeAttempts).toEqual(["second", "first", "backend"]);
  });

  it("discards a staging artifact acquired concurrently with stop", async () => {
    const dataRoot = await temporaryDirectory();
    const backend = new GatedStageBackend(new NodePersistenceBackend(dataRoot));
    const { lifecycle, api } = buildPersistence(backend);
    await lifecycle.start();

    const staging = api.workspaceStorage.stage("stop-race");
    await backend.stageEntered;
    const stopping = lifecycle.stop();
    backend.continueStage();

    await expect(staging).rejects.toThrow("Persistence subsystem is stopping");
    await expect(stopping).resolves.toBeUndefined();
    expect((await readdir(join(dataRoot, "workspaces"))).some((name) => name.startsWith(".staging-"))).toBe(false);
  });
});

function buildPersistence(backend: PersistenceBackend) {
  const persistence = createPersistenceSubsystemDefinition(backend);
  return buildEngineSubsystems([persistence], (capabilities): PersistenceCapability => capabilities.persistence);
}

function failingCloseBackend(closeAttempts: string[]): PersistenceBackend {
  return {
    openIdentityStorage: () => Promise.reject(new Error("Identity storage is not part of this test")),
    listWorkspaceIds: () => Promise.resolve(["first", "second"]),
    openWorkspace: (workspaceId) =>
      Promise.resolve({
        workspaceId,
        documents: new InMemoryDocumentStore(),
        close: () => {
          closeAttempts.push(workspaceId);
          throw new Error(`close ${workspaceId}`);
        },
      }),
    stageWorkspace: () => Promise.reject(new Error("Workspace staging is not part of this test")),
    discardStagedWorkspaces: () => Promise.resolve(),
    close: () => {
      closeAttempts.push("backend");
      throw new Error("close backend");
    },
  };
}

class GatedStageBackend implements PersistenceBackend {
  private releaseStage!: () => void;
  private markStageEntered!: () => void;
  private readonly stageGate = new Promise<void>((resolve) => {
    this.releaseStage = resolve;
  });
  readonly stageEntered = new Promise<void>((resolve) => {
    this.markStageEntered = resolve;
  });

  constructor(private readonly backend: PersistenceBackend) {}

  continueStage(): void {
    this.releaseStage();
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
    const staged = await this.backend.stageWorkspace(workspaceId);
    this.markStageEntered();
    await this.stageGate;
    return staged;
  }

  discardStagedWorkspaces(): Promise<void> {
    return this.backend.discardStagedWorkspaces();
  }

  close(): void | Promise<void> {
    return this.backend.close();
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lode-persistence-"));
  temporaryDirectories.push(directory);
  return directory;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function text(value: Uint8Array | null): string | null {
  return value === null ? null : new TextDecoder().decode(value);
}
