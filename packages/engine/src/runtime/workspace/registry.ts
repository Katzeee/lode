import { LoroMetaDoc, Workspace, type DocStore } from "../../core/index.js";
import {
  SqliteRegistryStore,
  type RegistryStore,
  type WorkspaceRecord,
} from "../../persistence/registry-store.js";
import { DocNotFoundError } from "../../errors/index.js";
import { InMemoryRegistryStore } from "../../persistence/in-memory-registry-store.js";
import type { WorkspaceStore } from "../../persistence/workspace-store.js";
import { DocStoreMembershipPersistence } from "../membership/membership-persistence.js";
import { MEMBERSHIP_DOC_ID, MembershipLog } from "../membership/membership-log.js";
import { Bus } from "../../events/bus.js";
import type { RuntimeInstance } from "../kernel/runtime.js";
import type { RuntimeResource } from "../kernel/resource.js";
import { PeerIdentity } from "../identity/peer-identity.js";
import { WorkspacePersistence } from "./persistence.js";
import {
  WorkspaceFactory,
  type CreateWorkspaceInput,
  type ForkWorkspaceInput,
  type WorkspaceContentOpener,
} from "./factory.js";
import type { RuntimeWorkspaceInfo } from "./types.js";
import { WorkspaceRuntime } from "./workspace-runtime.js";
import { inMemoryContentOpener, persistentContentOpener } from "./content-openers.js";
import {
  WorkspaceCheckpointResource,
  WorkspaceResource,
  WorkspaceStoreResource,
} from "./workspace-resources.js";

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

/**
 * The per-workspace lifecycle + persistence composition root — a thin facade. Three collaborators do
 * the work: PeerIdentity (peer id + keypair), WorkspacePersistence (load/persist/reconcile), and
 * WorkspaceFactory (create/fork + ACL-at-birth + single-root seed). The facade owns the non-owning
 * loaded index and serialization chains; its RuntimeInstance exclusively owns child lifetimes.
 *
 * Persistent vs in-memory is NOT a scattered `if`: it is which RegistryStore + WorkspaceContentOpener
 * are injected at construction. Both modes run the same create/fork/load path.
 */
export class WorkspaceRegistry implements RuntimeResource {
  readonly id = "workspace-registry";

  private readonly loaded = new Map<string, WorkspaceRuntime>();
  private readonly persistence: WorkspacePersistence;
  private readonly factory: WorkspaceFactory;
  private constructor(
    private readonly config: {
      snapshotEveryUpdates: number;
      shardCacheCapacity: number;
      registry: RegistryStore;
      opener: WorkspaceContentOpener;
    },
    private readonly peer: PeerIdentity,
    private readonly instance: RuntimeInstance,
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
      runWorkspace: <T>(id: string, operation: (runtime: WorkspaceRuntime) => Promise<T>) =>
        this.runWorkspace(id, operation),
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

  /** The LocalPeer (session actor + per-dataRoot peer key + peerId) for wire security + membership ops. */
  localPeerFor(actor: Parameters<PeerIdentity["localPeerFor"]>[0]) {
    return this.peer.localPeerFor(actor);
  }

  static async inMemory(instance: RuntimeInstance): Promise<WorkspaceRegistry> {
    const registry = new InMemoryRegistryStore();
    const result = new WorkspaceRegistry(
      {
        snapshotEveryUpdates: Number.POSITIVE_INFINITY,
        shardCacheCapacity: Number.POSITIVE_INFINITY,
        registry,
        opener: inMemoryContentOpener(),
      },
      await PeerIdentity.persistent(registry),
      instance,
    );
    instance.own(result);
    return result;
  }

  static async persistent(
    options: PersistenceOptions,
    instance: RuntimeInstance,
  ): Promise<WorkspaceRegistry> {
    const registry = await SqliteRegistryStore.open(options.dataRoot);
    const result = new WorkspaceRegistry(
      {
        snapshotEveryUpdates: options.snapshotEveryUpdates ?? 100,
        shardCacheCapacity: options.shardCacheCapacity ?? DEFAULT_SHARD_CACHE_CAPACITY,
        registry,
        opener: persistentContentOpener(options.dataRoot),
      },
      await PeerIdentity.persistent(registry),
      instance,
    );
    instance.own(result);
    return result;
  }

  /** Atomically mount a loaded workspace component and index it. The component is the owner of the
   *  workspace engine, persistence, membership, events, operations, and attached sync session. */
  private async mount(
    workspaceId: string,
    workspace: Workspace,
    store: WorkspaceStore | null,
    docStore: DocStore,
  ): Promise<WorkspaceRuntime> {
    const mounted = await this.instance.mount(`workspace:${workspaceId}`, async (instance) => {
      instance.own(new WorkspaceResource(workspace));
      instance.own(new WorkspaceStoreResource(store));
      instance.own(new WorkspaceCheckpointResource(this.persistence, docStore));
      const facts = new Bus(`workspace:${workspaceId}`);
      instance.own({ id: "workspace-facts", release: () => facts.dispose() });
      const membershipLog = new MembershipLog(
        new LoroMetaDoc(MEMBERSHIP_DOC_ID),
        new DocStoreMembershipPersistence(docStore, MEMBERSHIP_DOC_ID),
      );
      await membershipLog.load();
      return new WorkspaceRuntime(
        workspaceId,
        instance,
        workspace,
        store,
        docStore,
        membershipLog,
        facts,
      );
    });
    const runtime = mounted.api;
    this.loaded.set(workspaceId, runtime);
    mounted.instance.onStopped(() => {
      if (this.loaded.get(workspaceId) === runtime) {
        this.loaded.delete(workspaceId);
      }
    });
    return runtime;
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

  /** Run `work` serialized on `createChain` so workspace-creating ops (create, fork) are atomic w.r.t.
   *  each other. */
  private runSerialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.createChain.then(work);
    this.createChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async runWorkspace<T>(
    workspaceId: string,
    operation: (runtime: WorkspaceRuntime) => T | Promise<T>,
  ): Promise<T> {
    return (await this.requireLoaded(workspaceId)).run(operation);
  }

  async runWorkspaceExclusive<T>(
    workspaceId: string,
    operation: (runtime: WorkspaceRuntime) => T | Promise<T>,
  ): Promise<T> {
    return (await this.requireLoaded(workspaceId)).runExclusive(operation);
  }

  async listWorkspaces(): Promise<RuntimeWorkspaceInfo[]> {
    return (await this.config.registry.listWorkspaces()).map((record) => ({
      workspaceId: record.workspaceId,
      displayName: record.displayName,
    }));
  }

  async release(): Promise<void> {
    this.loaded.clear();
    await this.config.registry.close();
  }

  async removeWorkspace(workspaceId: string): Promise<boolean> {
    await this.unloadWorkspace(workspaceId, true);
    return this.config.registry.removeWorkspace(workspaceId);
  }

  /** The single per-workspace death funnel. Shutdown closes admission, drains accepted operations,
   *  optionally checkpoints, disposes the ownership tree, then removes the loaded record. */
  private async unloadWorkspace(workspaceId: string, markClean: boolean): Promise<void> {
    const loaded = this.loaded.get(workspaceId);
    if (loaded) {
      const report = await loaded.instance.stop({
        reason: { kind: "removed", message: workspaceId },
        checkpoint: markClean,
      });
      if (markClean && !report.graceful) {
        throw new AggregateError(
          report.errors,
          `workspace ${workspaceId} did not shut down cleanly`,
        );
      }
    }
  }

  async hasWorkspace(workspaceId: string): Promise<boolean> {
    return (await this.config.registry.getWorkspace(workspaceId)) !== null;
  }

  /** Flush every change since the last call to the workspace's DocStore — a thin delegate to the
   *  outliner's `flushDirty()`. The single persistence entry point: local mutations, sync rounds, and
   *  lifecycle heal all route through it. */
  async flushDirty(workspaceId: string): Promise<void> {
    const loaded = await this.requireLoaded(workspaceId);
    await loaded.flush();
  }

  private async requireLoaded(workspaceId: string): Promise<WorkspaceRuntime> {
    const loaded = await this.getWorkspace(workspaceId);
    if (!loaded) {
      throw new DocNotFoundError(workspaceId);
    }
    return loaded;
  }

  private async getWorkspace(workspaceId: string): Promise<WorkspaceRuntime | null> {
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

  private async loadPersistent(record: WorkspaceRecord): Promise<WorkspaceRuntime> {
    const { store, docStore } = await this.config.opener.open(record);
    let workspace: Workspace;
    try {
      workspace = new Workspace({ id: record.workspaceId });
      await this.persistence.loadOutliner(docStore, workspace);
    } catch (error) {
      // loadOutliner can reject a corrupt persisted state (validateSnapshot after reconcile).
      // No child component exists yet, so close the store directly to avoid leaking the handle.
      await store?.close();
      throw error;
    }
    return this.mount(record.workspaceId, workspace, store, docStore);
  }
}
