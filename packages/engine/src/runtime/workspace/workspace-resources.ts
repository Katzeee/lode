import type { Workspace } from "../../core/index.js";
import type { DocStore } from "../../core/store/doc-store.js";
import type { WorkspaceStore } from "../../persistence/workspace-store.js";
import type { RuntimeResource } from "../kernel/resource.js";
import type { WorkspacePersistence } from "./persistence.js";

export class WorkspaceResource implements RuntimeResource {
  readonly id = "workspace";
  constructor(private readonly workspace: Workspace) {}
  release(): void {
    this.workspace.dispose();
  }
}

export class WorkspaceStoreResource implements RuntimeResource {
  readonly id = "workspace-store";
  constructor(private readonly store: WorkspaceStore | null) {}
  async release(): Promise<void> {
    await this.store?.close();
  }
}

export class WorkspaceCheckpointResource implements RuntimeResource {
  readonly id = "workspace-checkpoint";
  constructor(
    private readonly persistence: WorkspacePersistence,
    private readonly docStore: DocStore,
  ) {}

  async checkpoint(): Promise<void> {
    await this.persistence.markCleanShutdown(this.docStore);
  }
}
