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
    const failures: Error[] = [];
    for (const release of [...this.releases].reverse()) {
      try {
        await release();
      } catch (error) {
        failures.push(...errorsFrom(error));
      }
    }
    throwCleanupFailures(failures, "Persistence storage resources failed to close");
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
          const failures: Error[] = [];
          try {
            await registry.closeAll();
          } catch (error) {
            failures.push(...errorsFrom(error));
          }
          try {
            await backend.close();
          } catch (error) {
            failures.push(...errorsFrom(error));
          }
          throwCleanupFailures(failures, "Persistence subsystem failed to close cleanly");
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

  const promote = () =>
    registry.runAccepted(async () => {
      await storage.release();
      const promotion = await physical.promote();
      await discardArtifact();
      const finalStorage = openWorkspaceStorage(promotion.storage, registry);
      return {
        storage: finalStorage,
        rollback: async () => {
          await finalStorage.release();
          await promotion.rollback();
        },
      };
    });

  return { storage, promote, discard: discardArtifact };
}

function scoped(physical: PhysicalWorkspaceStorage, namespace: string): DocumentStore {
  return new ScopedDocumentStore(physical.documents, namespace);
}

async function failAfterCleanup(primary: unknown, cleanup: () => void | Promise<void>): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    const failure = new AggregateError(
      [toError(primary), toError(cleanupError)],
      "Persistence operation and cleanup failed",
      {
        cause: primary,
      },
    );
    throw failure;
  }
  throw primary;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function errorsFrom(value: unknown): readonly Error[] {
  return value instanceof AggregateError ? value.errors.map(toError) : [toError(value)];
}

function throwCleanupFailures(failures: readonly Error[], message: string): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, message);
  }
}
