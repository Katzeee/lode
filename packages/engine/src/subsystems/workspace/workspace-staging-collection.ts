import type { WorkspaceStorage, WorkspaceStorageFactory } from "../persistence/index.js";
import { createWorkspaceStaging, failWorkspaceCleanup, type WorkspaceStaging } from "./workspace-staging.js";

export class WorkspaceStagingCollection {
  private readonly stagings = new Map<string, WorkspaceStaging>();

  constructor(
    private readonly storage: WorkspaceStorageFactory,
    private readonly activate: (storage: WorkspaceStorage) => Promise<string>,
  ) {}

  async open(workspaceId: string): Promise<WorkspaceStaging> {
    if (this.stagings.has(workspaceId)) {
      throw new Error(`Workspace ${workspaceId} already has active staging`);
    }
    const stagedStorage = await this.storage.stage(workspaceId);
    let staging: Awaited<ReturnType<typeof createWorkspaceStaging>>;
    try {
      staging = await createWorkspaceStaging(stagedStorage);
    } catch (error) {
      return failWorkspaceCleanup(error, stagedStorage.discard, "Workspace staging failed to clean up storage");
    }
    const tracked: WorkspaceStaging = {
      workspace: staging.workspace,
      replica: staging.replica,
      promote: async () => {
        const promotion = await staging.promote();
        try {
          const label = await this.activate(promotion.storage);
          this.stagings.delete(workspaceId);
          return { workspaceId, label };
        } catch (error) {
          this.stagings.delete(workspaceId);
          return failWorkspaceCleanup(
            error,
            promotion.rollback,
            "Workspace promotion failed to roll back final storage",
          );
        }
      },
      discard: async () => {
        if (this.stagings.get(workspaceId) !== tracked) {
          return;
        }
        await staging.discard();
        this.stagings.delete(workspaceId);
      },
    };
    this.stagings.set(workspaceId, tracked);
    return tracked;
  }

  async stop(): Promise<void> {
    const failures: Error[] = [];
    for (const [workspaceId, staging] of [...this.stagings.entries()].reverse()) {
      try {
        await staging.discard();
      } catch (error) {
        failures.push(toError(error));
      } finally {
        this.stagings.delete(workspaceId);
      }
    }
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "Workspace stagings failed to stop cleanly");
    }
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
