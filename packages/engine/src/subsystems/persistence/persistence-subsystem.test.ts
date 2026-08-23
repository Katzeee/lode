import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type {
  PersistenceBackend,
  PhysicalIdentityStorage,
  PhysicalWorkspaceStorage,
  PhysicalWorkspaceStorageStage,
} from "./backend.js";
import { InMemoryPersistenceBackend } from "./in-memory-persistence-backend.js";
import { NodePersistenceBackend } from "./node-persistence-backend.js";
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
    await staged.storage.projection.writeSnapshot("state", bytes("projection"));
    expect(text((await staged.storage.facts.load("state"))?.snapshot ?? null)).toBe("authority");
    expect(text((await staged.storage.projection.load("state"))?.snapshot ?? null)).toBe("projection");
    expect(await api.workspaceStorage.list()).toEqual([]);

    await staged.promote();
    expect(await api.workspaceStorage.list()).toEqual(["workspace/with a special id"]);
    const reopened = await api.workspaceStorage.open("workspace/with a special id");
    expect(text((await reopened.facts.load("state"))?.snapshot ?? null)).toBe("authority");
    expect(text((await reopened.projection.load("state"))?.snapshot ?? null)).toBe("projection");
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
