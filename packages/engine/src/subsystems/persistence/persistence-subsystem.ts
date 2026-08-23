import type { PersistenceBackend, PhysicalWorkspaceStorageStage, PhysicalWorkspaceStorage } from "./backend.js";
import { ScopedDocumentStore } from "./scoped-document-store.js";
import { defineEngineSubsystem } from "../definition.js";
import type { EngineSubsystemControl } from "../subsystem.js";
import type { PersistenceCapability, WorkspaceStorageStage, WorkspaceStorage } from "./capability.js";
import type { DocumentStore } from "./document-store.js";

class StorageResources {
  private readonly releases: (() => Promise<void>)[] = [];
  private readonly operations = new Set<Promise<void>>();

  constructor(private readonly control: EngineSubsystemControl) {}

  own(close: () => void | Promise<void>): () => Promise<void> {
    let releaseTask: Promise<void> | undefined;
    const release = (): Promise<void> => {
      releaseTask ??= Promise.resolve()
        .then(close)
        .then(() => {
          const index = this.releases.indexOf(release);
          if (index >= 0) {
            this.releases.splice(index, 1);
          }
        });
      return releaseTask;
    };
    this.releases.push(release);
    return release;
  }

  run<Output>(operation: () => Promise<Output>): Promise<Output> {
    if (this.control.stopRequested) {
      return Promise.reject(new Error("Persistence subsystem is stopping"));
    }
    return this.runAccepted(operation);
  }

  runAccepted<Output>(operation: () => Promise<Output>): Promise<Output> {
    const result = Promise.resolve().then(operation);
    const settled = result.then(
      () => {},
      () => {},
    );
    this.operations.add(settled);
    void settled.then(() => this.operations.delete(settled));
    return result;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.operations]);
    for (const release of [...this.releases].reverse()) {
      await release();
    }
  }
}

export function createPersistenceSubsystemDefinition(backend: PersistenceBackend) {
  return defineEngineSubsystem({
    id: "persistence",
    dependencies: {},
    create: (_dependencies, control) => {
      const registry = new StorageResources(control);
      return {
        capability: createCapability(backend, registry, control),
        init: () => backend.discardStagedWorkspaces(),
        stop: async () => {
          await registry.closeAll();
          await backend.close();
        },
      };
    },
  });
}

function createCapability(
  backend: PersistenceBackend,
  registry: StorageResources,
  control: EngineSubsystemControl,
): PersistenceCapability {
  const assertRunning = (): void => {
    if (control.stopRequested) {
      throw new Error("Persistence subsystem is stopping");
    }
  };
  return {
    identityStorage: {
      open: () => registry.run(() => backend.openIdentityStorage()),
    },
    workspaceStorage: {
      list: () => registry.run(() => backend.listWorkspaceIds()),
      open: (workspaceId) =>
        registry.run(async () => {
          const physical = await backend.openWorkspace(workspaceId);
          const opened = openWorkspaceStorage(physical, registry);
          try {
            assertRunning();
            return opened;
          } catch (error) {
            return failAfterCleanup(error, opened.release);
          }
        }),
      stage: (workspaceId) =>
        registry.run(async () => {
          const physical = await backend.stageWorkspace(workspaceId);
          const staged = stageWorkspaceStorage(physical, registry);
          try {
            assertRunning();
            return staged;
          } catch (error) {
            return failAfterCleanup(error, staged.discard);
          }
        }),
    },
  };
}

function openWorkspaceStorage(physical: PhysicalWorkspaceStorage, registry: StorageResources): WorkspaceStorage {
  return workspaceStorage(physical, registry.own(physical.close));
}

function workspaceStorage(physical: PhysicalWorkspaceStorage, release: () => Promise<void>): WorkspaceStorage {
  return {
    workspaceId: physical.workspaceId,
    facts: scoped(physical, "facts"),
    projection: scoped(physical, "projection"),
    metadata: scoped(physical, "metadata"),
    release,
  };
}

function stageWorkspaceStorage(
  physical: PhysicalWorkspaceStorageStage,
  registry: StorageResources,
): WorkspaceStorageStage {
  const storage = workspaceStorage(physical.storage, registry.own(physical.storage.close));
  const discardArtifact = registry.own(async () => {
    await storage.release();
    await physical.discard();
  });

  const promote = (): Promise<WorkspaceStorage> =>
    registry.runAccepted(async () => {
      await storage.release();
      const final = await physical.promote();
      await discardArtifact();
      return openWorkspaceStorage(final, registry);
    });

  return { storage, promote, discard: discardArtifact };
}

function scoped(physical: PhysicalWorkspaceStorage, namespace: string): DocumentStore {
  return new ScopedDocumentStore(physical.documents, namespace);
}

async function failAfterCleanup(primary: unknown, cleanup: () => void | Promise<void>): Promise<never> {
  await cleanup();
  throw primary;
}
