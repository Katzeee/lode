import { randomUUID } from "node:crypto";
import { Workspace, type Engine, type VersionVector } from "../core/index.js";
import { workspaceDbPath } from "./paths.js";
import { RegistryStore, type WorkspaceRecord } from "./registry-store.js";
import { WorkspaceStore } from "./workspace-store.js";

export type PersistenceOptions = {
  dataRoot: string;
  snapshotEveryUpdates?: number;
};

export type RuntimeWorkspaceInfo = {
  workspaceId: string;
  displayName: string;
};

type LoadedWorkspace = {
  workspace: Workspace;
  store: WorkspaceStore | null;
};

export class AppWorkspaceRuntime {
  private readonly loaded = new Map<string, LoadedWorkspace>();
  private readonly memoryCatalog = new Map<string, RuntimeWorkspaceInfo>();

  private constructor(
    private readonly options: {
      dataRoot?: string;
      registry: RegistryStore | null;
      snapshotEveryUpdates: number;
    },
  ) {}

  static inMemory(): Promise<AppWorkspaceRuntime> {
    return Promise.resolve(
      new AppWorkspaceRuntime({
        registry: null,
        snapshotEveryUpdates: Number.POSITIVE_INFINITY,
      }),
    );
  }

  static async persistent(options: PersistenceOptions): Promise<AppWorkspaceRuntime> {
    return new AppWorkspaceRuntime({
      dataRoot: options.dataRoot,
      registry: await RegistryStore.open(options.dataRoot),
      snapshotEveryUpdates: options.snapshotEveryUpdates ?? 100,
    });
  }

  async createWorkspace(input: {
    workspaceId?: string;
    displayName: string;
  }): Promise<RuntimeWorkspaceInfo> {
    if (!this.options.registry) {
      const workspaceId = input.workspaceId ?? randomUUID();
      const info = { workspaceId, displayName: input.displayName };
      this.memoryCatalog.set(workspaceId, info);
      this.loaded.set(workspaceId, {
        workspace: new Workspace({ id: workspaceId }),
        store: null,
      });
      return info;
    }

    const record = await this.options.registry.createWorkspace(input);
    await this.loadPersistentWorkspace(record);
    return recordToInfo(record);
  }

  async listWorkspaces(): Promise<RuntimeWorkspaceInfo[]> {
    if (!this.options.registry) {
      return [...this.memoryCatalog.values()];
    }
    return (await this.options.registry.listWorkspaces()).map(recordToInfo);
  }

  async removeWorkspace(workspaceId: string): Promise<boolean> {
    const loaded = this.loaded.get(workspaceId);
    if (loaded?.store) {
      await loaded.store.close();
    }
    this.loaded.delete(workspaceId);
    if (!this.options.registry) {
      return this.memoryCatalog.delete(workspaceId);
    }
    return this.options.registry.removeWorkspace(workspaceId);
  }

  async createDoc(input: {
    workspaceId: string;
    docId?: string;
    displayName?: string;
  }): Promise<string> {
    const loaded = await this.requireWorkspace(input.workspaceId);
    const doc = loaded.workspace.createDoc(input.docId);
    if (loaded.store) {
      try {
        await loaded.store.createDoc({
          docId: doc.id,
          displayName: input.displayName ?? doc.id,
          snapshotBytes: doc.exportSnapshot(),
        });
      } catch (error) {
        loaded.workspace.removeDoc(doc.id);
        throw error;
      }
    }
    return doc.id;
  }

  async listDocs(workspaceId: string): Promise<string[]> {
    const loaded = await this.requireWorkspace(workspaceId);
    return [...loaded.workspace.docs.keys()];
  }

  async removeDoc(workspaceId: string, docId: string): Promise<boolean> {
    const loaded = await this.requireWorkspace(workspaceId);
    const existed = loaded.workspace.getDoc(docId) != null;
    loaded.workspace.removeDoc(docId);
    if (loaded.store) {
      await loaded.store.removeDoc(docId);
    }
    return existed;
  }

  async getDoc(workspaceId: string, docId: string): Promise<Engine | null> {
    const loaded = await this.getWorkspace(workspaceId);
    return loaded?.workspace.getDoc(docId) ?? null;
  }

  async persistMutation(
    workspaceId: string,
    docId: string,
    beforeVersion: VersionVector,
  ): Promise<void> {
    const loaded = await this.requireWorkspace(workspaceId);
    if (!loaded.store) {
      return;
    }
    const doc = loaded.workspace.getDoc(docId);
    if (!doc) {
      throw new Error(`Doc not found: ${docId}`);
    }
    const seq = await loaded.store.appendUpdate({
      docId,
      updateBytes: doc.exportUpdateFrom(beforeVersion),
    });
    if (seq % this.options.snapshotEveryUpdates === 0) {
      await loaded.store.writeSnapshot({
        docId,
        coveredUpdateSeq: seq,
        snapshotBytes: doc.exportSnapshot(),
      });
    }
  }

  async close(): Promise<void> {
    for (const loaded of this.loaded.values()) {
      await loaded.store?.close();
      loaded.workspace.dispose();
    }
    this.loaded.clear();
    await this.options.registry?.close();
  }

  private async requireWorkspace(workspaceId: string): Promise<LoadedWorkspace> {
    const loaded = await this.getWorkspace(workspaceId);
    if (!loaded) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return loaded;
  }

  private async getWorkspace(workspaceId: string): Promise<LoadedWorkspace | null> {
    const existing = this.loaded.get(workspaceId);
    if (existing) {
      return existing;
    }
    if (!this.options.registry) {
      return null;
    }
    const record = await this.options.registry.getWorkspace(workspaceId);
    if (!record) {
      return null;
    }
    return this.loadPersistentWorkspace(record);
  }

  private async loadPersistentWorkspace(record: WorkspaceRecord): Promise<LoadedWorkspace> {
    if (!this.options.dataRoot) {
      throw new Error("Persistent workspace runtime missing data root");
    }
    const store = await WorkspaceStore.open(
      workspaceDbPath(this.options.dataRoot, record.relativePath),
    );
    const workspace = new Workspace({ id: record.workspaceId });
    for (const docId of await store.listDocs()) {
      const loaded = await store.loadDocBytes(docId);
      if (!loaded) {
        continue;
      }
      const doc = workspace.createDoc(docId, {
        ...(loaded.snapshotBytes ? { initialBytes: loaded.snapshotBytes } : {}),
      });
      for (const updateBytes of loaded.updateBytes) {
        doc.importUpdate(updateBytes);
      }
    }
    const loaded = { workspace, store };
    this.loaded.set(record.workspaceId, loaded);
    return loaded;
  }
}

function recordToInfo(record: WorkspaceRecord): RuntimeWorkspaceInfo {
  return {
    workspaceId: record.workspaceId,
    displayName: record.displayName,
  };
}
