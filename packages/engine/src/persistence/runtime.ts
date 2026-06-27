import { randomUUID } from "node:crypto";
import { Workspace, type Engine, type VersionVector } from "../core/index.js";
import { ShardedBlockStore } from "../core/sharded-store.js";
import { validateSnapshot } from "../core/invariant.js";
import { toJSON } from "../core/serializers/json.js";
import { workspaceDbPath } from "./paths.js";
import { RegistryStore, type WorkspaceRecord } from "./registry-store.js";
import { MAIN_SUBDOC, WorkspaceStore } from "./workspace-store.js";

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
    const doc = loaded.workspace.createDoc(input.docId, { store: new ShardedBlockStore() });
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

  async getEngine(workspaceId: string): Promise<Engine | null> {
    const loaded = await this.getWorkspace(workspaceId);
    return this.singleEngine(loaded?.workspace);
  }

  async persistMutation(workspaceId: string, beforeVersion: VersionVector): Promise<void> {
    const loaded = await this.requireWorkspace(workspaceId);
    if (!loaded.store) {
      return;
    }
    const workspace = loaded.workspace;
    const docId = this.singleDocId(workspace);
    const doc = workspace.getDoc(docId);
    if (!doc) {
      throw new Error(`Doc not found: ${docId}`);
    }
    const sharded = doc.getShardedStore();
    if (sharded) {
      // treeDoc persists incrementally via the main sub-doc (exportUpdateFrom/getVersion
      // are treeDoc-only on the sharded store, so beforeVersion is the treeDoc's VV).
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
      // Each loaded shard persists as its latest snapshot (snapshot-only; shards are
      // small, lazy-load is the win). Correctness over incremental shard updates.
      for (const shardId of sharded.shardIds()) {
        await loaded.store.writeSnapshot({
          docId,
          subDoc: shardId,
          coveredUpdateSeq: 0,
          snapshotBytes: sharded.getShardDoc(shardId).export({ mode: "snapshot" }),
        });
      }
      return;
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

  // One doc per workspace — the engine accessor + the storage key derive from the
  // single entry. (Lifecycle RPCs createDoc/listDocs/removeDoc still name the doc.)
  private singleEngine(workspace: Workspace | undefined): Engine | null {
    if (!workspace) {
      return null;
    }
    return [...workspace.docs.values()][0] ?? null;
  }

  private singleDocId(workspace: Workspace): string {
    const ids = [...workspace.docs.keys()];
    const id = ids[0];
    if (id === undefined) {
      throw new Error("Workspace has no doc");
    }
    return id;
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
    try {
      const docIds = await store.listDocs();
      const workspace = new Workspace({ id: record.workspaceId });
      for (const docId of docIds) {
        await this.loadShardedDoc(store, workspace, docId);
      }
      const loaded = { workspace, store };
      this.loaded.set(record.workspaceId, loaded);
      return loaded;
    } catch (error) {
      // loadShardedDoc can reject a corrupt persisted state (validateSnapshot after
      // reconcile). The workspace isn't registered in `loaded`, so close() wouldn't
      // reach this store — close it here to avoid leaking the SQLite handle.
      await store.close();
      throw error;
    }
  }

  /**
   * Load a sharded doc: the treeDoc (main sub-doc) eagerly (snapshot + updates), and
   * shard snapshots pre-loaded into the sync `shardLoader` map. The shard LoroDocs
   * themselves still materialize lazily on first access; full lazy shard LOAD (not
   * even reading the bytes until touched) needs an async shardLoader and is deferred.
   * reconcileDurability runs for cross-doc crash recovery.
   */
  private async loadShardedDoc(
    store: WorkspaceStore,
    workspace: Workspace,
    docId: string,
  ): Promise<void> {
    const main = await store.loadDocBytes(docId);
    if (!main) {
      return;
    }
    const shardSnaps = new Map<string, Uint8Array>();
    for (const subDoc of await store.listSubDocs(docId)) {
      if (subDoc === MAIN_SUBDOC) {
        continue;
      }
      const shardBytes = await store.loadDocBytes(docId, subDoc);
      if (shardBytes?.snapshotBytes) {
        shardSnaps.set(subDoc, shardBytes.snapshotBytes);
      }
    }
    const shardLoader = (shardId: string): Uint8Array | null => shardSnaps.get(shardId) ?? null;
    const blockStore = new ShardedBlockStore({
      ...(main.snapshotBytes ? { initialTreeBytes: main.snapshotBytes } : {}),
      shardLoader,
    });
    const doc = workspace.createDoc(docId, { store: blockStore });
    for (const updateBytes of main.updateBytes) {
      doc.importUpdate(updateBytes);
    }
    // reconcileDurability self-heals create/delete orphans between treeDoc and shards;
    // validateSnapshot then rejects anything it CANNOT heal (a broken canonical ref, a
    // detached subtree, bytes from an incompatible version). This is the sharded analog
    // of the old single-doc constructor import validation.
    blockStore.reconcileDurability();
    validateSnapshot(toJSON(doc));
  }
}

function recordToInfo(record: WorkspaceRecord): RuntimeWorkspaceInfo {
  return {
    workspaceId: record.workspaceId,
    displayName: record.displayName,
  };
}
