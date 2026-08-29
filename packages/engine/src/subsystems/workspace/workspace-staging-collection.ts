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
        const finalStorage = await staging.promote();
        this.stagings.delete(workspaceId);
        const label = await this.activate(finalStorage);
        return { workspaceId, label };
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
    for (const [workspaceId, staging] of [...this.stagings.entries()].reverse()) {
      await staging.discard();
      this.stagings.delete(workspaceId);
    }
  }
}
