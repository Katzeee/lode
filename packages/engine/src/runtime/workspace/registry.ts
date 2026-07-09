import {
  InMemoryDocStore,
  LoroMetaDoc,
  Workspace,
  type DocStore,
  type Engine,
} from "../../core/index.js";
import { workspaceDbPath } from "../../persistence/paths.js";
import {
  SqliteRegistryStore,
  type RegistryStore,
  type WorkspaceRecord,
} from "../../persistence/registry-store.js";
import { InMemoryRegistryStore } from "../../persistence/in-memory-registry-store.js";
import { WorkspaceStore } from "../../persistence/workspace-store.js";
import { WorkspaceDocStore } from "./doc-store.js";
import { DocStoreMembershipPersistence } from "../membership/membership-persistence.js";
import { MEMBERSHIP_DOC_ID, MembershipLog } from "../membership/membership-log.js";
import { App, type Component } from "../app.js";
import { PeerIdentity } from "../identity/peer-identity.js";
import { WorkspacePersistence } from "./persistence.js";
import type { SessionManager } from "../../session/session-manager.js";
import type { SyncRegistry } from "../sync/registry.js";
import {
  WorkspaceFactory,
  type CreateWorkspaceInput,
  type ForkWorkspaceInput,
  type WorkspaceContentOpener,
} from "./factory.js";
import type { LoadedWorkspace, RuntimeWorkspaceInfo } from "./types.js";

export type { CreateWorkspaceInput, ForkWorkspaceInput } from "./factory.js";
export type { RuntimeWorkspaceInfo } from "./types.js";

export type PersistenceOptions = {
  dataRoot: string;
  snapshotEveryUpdates?: number;
  /** Max resident shard LoroDocs per workspace (the parsed-CRDT memory bound). Default 32 — caps the
   *  heavy memory while colder shards evict (write-back to the DocStore) + re-fault on access. Tune
   *  per deployment profile (more = hotter working set, more memory). */
  shardCacheCapacity?: number;
};

/** Default resident shard bound — caps parsed CRDTs at 32; the treeDoc stays always-resident. */
const DEFAULT_SHARD_CACHE_CAPACITY = 32;

// Per-workspace lifecycle components. App.stop runs them in reverse registration order, so
// workspace is registered before store → store closes before workspace disposes (matching
// the prior hand-coded teardown order).
class WorkspaceComponent implements Component {
  readonly name = "workspace";
  constructor(private readonly workspace: Workspace) {}
  stop(): void {
    this.workspace.dispose();
  }
}

class WorkspaceStoreComponent implements Component {
  readonly name = "workspace-store";
  constructor(private readonly store: WorkspaceStore | null) {}
  async stop(): Promise<void> {
    await this.store?.close();
  }
}

/**
 * The per-workspace lifecycle + persistence composition root — a thin facade. Three collaborators do
 * the work: PeerIdentity (peer id + keypair), WorkspacePersistence (load/persist/reconcile), and
 * WorkspaceFactory (create/fork + ACL-at-birth + single-root seed). The facade owns the loaded map,
 * the ChildApp mounting, the serialization chains, and the lifecycle (close/crashClose).
 *
 * Persistent vs in-memory is NOT a scattered `if`: it is which RegistryStore + WorkspaceContentOpener
 * are injected at construction. Both modes run the same create/fork/load path.
 */
export class AppWorkspaceRuntime {
  private readonly loaded = new Map<string, LoadedWorkspace>();
  private readonly persistence: WorkspacePersistence;
  private readonly factory: WorkspaceFactory;
  /** Cross-component holders of per-workspace state (sync registrations/sub-graphs, session
   *  subscribers). Set once at runtime assembly — after this registry, since both depend on it — so a
   *  workspace's death can purge them too. Optional because a registry constructed directly (tests)
   *  may never wire sync/sessions; `unloadWorkspace` then skips the purge. */
  private syncRegistry?: SyncRegistry;
  private sessions?: SessionManager;

  private constructor(
    private readonly config: {
      snapshotEveryUpdates: number;
      shardCacheCapacity: number;
      registry: RegistryStore;
      opener: WorkspaceContentOpener;
    },
    private readonly peer: PeerIdentity,
    private readonly createChildApp: () => App,
  ) {
    this.persistence = new WorkspacePersistence(
      peer.peerId,
      config.shardCacheCapacity,
      config.snapshotEveryUpdates,
    );
    const host = {
      mount: (id: string, ws: Workspace, store: WorkspaceStore | null, docStore: DocStore) =>
        this.mount(id, ws, store, docStore),
      flushDirty: (id: string) => this.flushDirty(id),
      requireLoaded: (id: string) => this.requireLoaded(id),
      loadPersistent: (record: WorkspaceRecord) => this.loadPersistent(record),
    };
    this.factory = new WorkspaceFactory(
      peer,
      this.persistence,
      {
        registry: config.registry,
        opener: config.opener,
        snapshotEveryUpdates: config.snapshotEveryUpdates,
      },
      host,
    );
  }

  /** This dataRoot's stable Loro peer id. */
  get peerId(): number | undefined {
    return this.peer.peerId;
  }

  /** The peer's string routing id — the single peerId→string label (see PeerIdentity.routingId). */
  routingId(): string | undefined {
    return this.peer.routingId();
  }

  /** The session-origin node label for changes emitted from this runtime (PeerIdentity.originLabel). */
  originLabel(): string {
    return this.peer.originLabel();
  }

  /** The LocalPeer (session actor + per-dataRoot peer key + peerId) a host uses for wire security
   *  + membership ops on this dataRoot. */
  localPeerFor(actor: Parameters<PeerIdentity["localPeerFor"]>[0]) {
    return this.peer.localPeerFor(actor);
  }

  static async inMemory(createChildApp: () => App = () => new App()): Promise<AppWorkspaceRuntime> {
    const registry = new InMemoryRegistryStore();
    return new AppWorkspaceRuntime(
      {
        snapshotEveryUpdates: Number.POSITIVE_INFINITY,
        shardCacheCapacity: Number.POSITIVE_INFINITY,
        registry,
        opener: inMemoryContentOpener(),
      },
      await PeerIdentity.persistent(registry),
      createChildApp,
    );
  }

  static async persistent(
    options: PersistenceOptions,
    createChildApp: () => App = () => new App(),
  ): Promise<AppWorkspaceRuntime> {
    const registry = await SqliteRegistryStore.open(options.dataRoot);
    return new AppWorkspaceRuntime(
      {
        snapshotEveryUpdates: options.snapshotEveryUpdates ?? 100,
        shardCacheCapacity: options.shardCacheCapacity ?? DEFAULT_SHARD_CACHE_CAPACITY,
        registry,
        opener: persistentContentOpener(options.dataRoot),
      },
      await PeerIdentity.persistent(registry),
      createChildApp,
    );
  }

  /** Wrap a loaded workspace + store in a ChildApp (started now) and record it. Owns the per-workspace
   *  lifecycle mounting + the membership log (workspace state, loaded here, consumed by the sync
   *  runner via membershipLog()). */
  private async mount(
    workspaceId: string,
    workspace: Workspace,
    store: WorkspaceStore | null,
    docStore: DocStore,
  ): Promise<LoadedWorkspace> {
    const app = this.createChildApp();
    app.register(new WorkspaceComponent(workspace));
    app.register(new WorkspaceStoreComponent(store));
    await app.start();
    const membershipLog = new MembershipLog(
      new LoroMetaDoc(MEMBERSHIP_DOC_ID),
      new DocStoreMembershipPersistence(docStore, MEMBERSHIP_DOC_ID),
    );
    await membershipLog.load();
    const loaded: LoadedWorkspace = { app, workspace, store, docStore, membershipLog };
    this.loaded.set(workspaceId, loaded);
    return loaded;
  }

  /** Create a workspace, or return it unchanged if it already exists. Idempotent and serialized: a
   *  concurrent create for the same id runs after the in-flight one resolves, sees the ws exists, and
   *  returns it — never re-inserting, re-rooting, or re-doc'ing. */
  async createWorkspace(input: CreateWorkspaceInput): Promise<RuntimeWorkspaceInfo> {
    return this.runSerialized(() => this.factory.create(input));
  }

  async forkWorkspace(input: ForkWorkspaceInput): Promise<RuntimeWorkspaceInfo> {
    return this.runSerialized(() => this.factory.fork(input));
  }

  private createChain: Promise<void> = Promise.resolve();
  /** Per-workspace mutation chains — same-workspace mutations serialize (one completes before the
   *  next starts); different workspaces mutate in parallel. The CRDT-paradigm rule: same-replica
   *  operations are serial (concurrency is expressed via sync + merge, not parallel mutation). This
   *  makes the `residentSession` working-set gate reliably single-operation + `ActionHistory`
   *  begin/end grouping non-interleaving, so concurrent multi-client writes to one workspace QUEUE
   *  (ms, invisible) instead of erroring ("session already active") or tearing a read-modify-write. */
  private readonly workspaceChains = new Map<string, Promise<void>>();

  /** Run `work` on a serialized chain: `work` never throws up — it rejects the returned promise and
   *  leaves the chain fulfilled, so a later op still runs. Returns the deferred result + the chain's
   *  next link (the caller stores it on whichever chain it picked). */
  private runOnChain<T>(
    chain: Promise<void>,
    work: () => Promise<T>,
  ): { result: Promise<T>; next: Promise<void> } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const next = chain.then(async () => {
      try {
        resolve(await work());
      } catch (e) {
        reject(e);
      }
    });
    return { result, next };
  }

  /** Run `work` serialized on `createChain` so workspace-creating ops (create, fork) are atomic w.r.t.
   *  each other. */
  private runSerialized<T>(work: () => Promise<T>): Promise<T> {
    const { result, next } = this.runOnChain(this.createChain, work);
    this.createChain = next;
    return result;
  }

  /** Run `work` serialized on `workspaceId`'s chain so same-workspace MUTATIONS are atomic w.r.t.
   *  each other. Per-workspace key (not global) so independent workspaces proceed in parallel. */
  runWorkspaceSerialized<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.workspaceChains.get(workspaceId) ?? Promise.resolve();
    const { result, next } = this.runOnChain(prev, work);
    this.workspaceChains.set(workspaceId, next);
    return result;
  }

  async listWorkspaces(): Promise<RuntimeWorkspaceInfo[]> {
    return (await this.config.registry.listWorkspaces()).map((record) => ({
      workspaceId: record.workspaceId,
      displayName: record.displayName,
    }));
  }

  /** Wire the cross-component holders of per-workspace state so a workspace's death purges them too.
   *  Called once at runtime assembly, after these are constructed (both depend on this registry). */
  attachWorkspaceStateHolders(sync: SyncRegistry, sessions: SessionManager): void {
    this.syncRegistry = sync;
    this.sessions = sessions;
  }

  /** Fail-loud if the two-phase wiring never happened. A workspace's death would otherwise silently
   *  leak its sync registration + session subscribers (ghosts) — `attachWorkspaceStateHolders` MUST
   *  run before the registry goes live. Called from the lifecycle `start()`; direct tests that bypass
   *  the App lifecycle never reach it. */
  assertStateHoldersAttached(): void {
    if (this.syncRegistry === undefined || this.sessions === undefined) {
      throw new Error(
        "workspace registry state holders not attached — call attachWorkspaceStateHolders before start",
      );
    }
  }

  async removeWorkspace(workspaceId: string): Promise<boolean> {
    await this.unloadWorkspace(workspaceId, true);
    return this.config.registry.removeWorkspace(workspaceId);
  }

  /** The single per-workspace death funnel: stop the ChildApp (collapsing engine + store + the sync
   *  sub-graph via its holder), drop the loaded record, and purge EVERY keyed-by-wsId holder — this
   *  registry's mutation chain plus the cross-component sync/session bookkeeping — so a removed
   *  workspace leaves no ghost and a same-id rebuild starts clean. `markClean` writes the
   *  clean-shutdown marker (clean removal/close); a crash-close omits it so the next load reconciles
   *  + validates. Every death path (removeWorkspace, close, crashClose) routes through here. */
  private async unloadWorkspace(workspaceId: string, markClean: boolean): Promise<void> {
    const loaded = this.loaded.get(workspaceId);
    if (loaded) {
      if (markClean) {
        await this.persistence.markCleanShutdown(loaded.docStore);
      }
      await loaded.app.stop();
      this.loaded.delete(workspaceId);
    }
    this.workspaceChains.delete(workspaceId);
    this.syncRegistry?.purge(workspaceId);
    this.sessions?.purgeWorkspace(workspaceId);
  }

  async getEngine(workspaceId: string): Promise<Engine | null> {
    const loaded = await this.getWorkspace(workspaceId);
    return loaded?.workspace?.engine ?? null;
  }

  /** The engine for an ALREADY-loaded workspace, WITHOUT triggering a load. Sync attaches to open
   *  workspaces; calling the load path here would race with the doc-adding load. Null if not open. */
  loadedEngine(workspaceId: string): Engine | null {
    return this.loaded.get(workspaceId)?.workspace?.engine ?? null;
  }

  /** The ChildApp for an ALREADY-loaded workspace (null if not open). Sync wires its sub-graph onto
   *  this as a child so `removeWorkspace`'s `app.stop()` tears engine + store + sync down in one
   *  graph. Peek-only — never triggers a load. */
  loadedApp(workspaceId: string): App | null {
    return this.loaded.get(workspaceId)?.app ?? null;
  }

  /** The membership log for an ALREADY-loaded workspace (null if not open yet). Peek-only — never
   *  triggers a load. The log is created + loaded in mount() and rooted at createWorkspace; the sync
   *  runner consumes it here instead of constructing its own. */
  membershipLog(workspaceId: string): MembershipLog | null {
    return this.loaded.get(workspaceId)?.membershipLog ?? null;
  }

  /** Flush every change since the last call to the workspace's DocStore — a thin delegate to the
   *  outliner's `flushDirty()`. The single persistence entry point: local mutations, sync rounds, and
   *  lifecycle heal all route through it. */
  async flushDirty(workspaceId: string): Promise<void> {
    const loaded = await this.requireLoaded(workspaceId);
    const engine = loaded.workspace.engine;
    if (!engine) {
      throw new Error("Workspace has no engine");
    }
    await engine.asOutliner().flushDirty();
  }

  /** Close all workspace stores + the registry WITHOUT writing the clean-shutdown marker — models a
   *  crash so the next load runs reconcile + validate. For crash-recovery tests. Routes each
   *  workspace through `unloadWorkspace` so per-wsId state is purged here too. */
  async crashClose(): Promise<void> {
    for (const workspaceId of [...this.loaded.keys()]) {
      await this.unloadWorkspace(workspaceId, false);
    }
    await this.config.registry.close();
  }

  async close(): Promise<void> {
    for (const workspaceId of [...this.loaded.keys()]) {
      await this.unloadWorkspace(workspaceId, true);
    }
    await this.config.registry.close();
  }

  private async requireLoaded(workspaceId: string): Promise<LoadedWorkspace> {
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
    const record = await this.config.registry.getWorkspace(workspaceId);
    if (!record) {
      return null;
    }
    return this.loadPersistent(record);
  }

  private async loadPersistent(record: WorkspaceRecord): Promise<LoadedWorkspace> {
    const { store, docStore } = await this.config.opener.open(record);
    let workspace: Workspace;
    try {
      workspace = new Workspace({ id: record.workspaceId });
      await this.persistence.loadOutliner(docStore, workspace);
    } catch (error) {
      // loadOutliner can reject a corrupt persisted state (validateSnapshot after reconcile).
      // No ChildApp is registered yet, so close the store directly to avoid leaking the handle.
      await store?.close();
      throw error;
    }
    return this.mount(record.workspaceId, workspace, store, docStore);
  }
}

/** Persistent content opener: each workspace gets its own SQLite WorkspaceStore + WorkspaceDocStore. */
function persistentContentOpener(dataRoot: string): WorkspaceContentOpener {
  return {
    open: async (record) => {
      const store = await WorkspaceStore.open(workspaceDbPath(dataRoot, record.relativePath));
      return { store, docStore: new WorkspaceDocStore(store) };
    },
  };
}

/** In-memory content opener: each workspace gets a fresh ephemeral InMemoryDocStore (no WorkspaceStore
 *  — content lives in resident Loro docs, flushed into the throwaway DocStore). */
function inMemoryContentOpener(): WorkspaceContentOpener {
  return {
    open: () => Promise.resolve({ store: null, docStore: new InMemoryDocStore() }),
  };
}
