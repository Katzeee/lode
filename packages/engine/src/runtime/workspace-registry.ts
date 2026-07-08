/* eslint-disable max-lines -- per-workspace lifecycle + sharded persistence composition root;
   the peerId/store/createDoc/load/persist wiring is cohesive in one place */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  InMemoryDocStore,
  LoroMetaDoc,
  Workspace,
  type DocStore,
  type Engine,
  type LoadedDocBytes,
} from "../core/index.js";
import { ShardedBlockStore, TREE_SUBDOC } from "../core/store/sharded-store.js";
import { SYS_PREFIX } from "../core/store/syncable.js";
import { WorkspaceDocStore } from "./workspace-doc-store.js";
import { validateOccurrenceStructure, validateSnapshot } from "../core/invariant.js";
import { toJSON, toJSONOccurrences } from "../core/serialize.js";
import { createPlainNode } from "../domain/node.js";
import { workspaceDbPath } from "../persistence/paths.js";
import { RegistryStore, type WorkspaceRecord } from "../persistence/registry-store.js";
import { WorkspaceStore } from "../persistence/workspace-store.js";
import {
  peerKeypairFromPrivateKey,
  generatePeerKeypair,
  type PeerKeypair,
} from "../utils/crypto/index.js";
import { DocStoreMembershipPersistence } from "./membership/membership-persistence.js";
import { MembershipLog, MEMBERSHIP_DOC_ID, type LocalPeer } from "./membership/membership-log.js";
import { App, type Component } from "./app.js";
import type { ActorKeypair } from "../utils/crypto/index.js";

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

/** The workspace_meta doc id — a small marker doc carrying the clean-shutdown flag (the DocStore is
 *  generic id→bytes, so a non-`sys:` id keeps it out of the structure namespace). On a clean close
 *  the runtime writes "clean"; on load `shouldReconcile` reads it to skip the (streaming but full-
 *  scan) crash-restart reconcile, then flips it to "dirty" so a crash mid-run triggers reconcile. */
const WORKSPACE_META_ID = "workspace_meta";
const CLEAN_SHUTDOWN = "clean";
const RUNNING = "dirty";
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

export type RuntimeWorkspaceInfo = {
  workspaceId: string;
  displayName: string;
};

type LoadedWorkspace = {
  // Per-workspace sub-runtime: a ChildApp whose components (workspace + store) are stopped
  // in reverse on unload, and which is the mounting point for future per-workspace
  // subsystems (sync state, indexer, query cache).
  app: App;
  workspace: Workspace;
  store: WorkspaceStore | null;
  // The DocStore port (core's id→bytes contract) the runtime adapts the persistence leaf into.
  // Null in in-memory mode. loadOutliner/flushDirty/initOutliner speak this, not the leaf.
  docStore: DocStore | null;
  // The membership log is workspace state — owned by the engine, consumed by the sync runner via
  // membershipLog(). Created + loaded in registerLoaded; rooted at createWorkspace for an owner.
  membershipLog: MembershipLog;
};

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

export class AppWorkspaceRuntime {
  private readonly loaded = new Map<string, LoadedWorkspace>();
  private readonly memoryCatalog = new Map<string, RuntimeWorkspaceInfo>();

  private constructor(
    private readonly options: {
      dataRoot?: string;
      registry: RegistryStore | null;
      peerId?: number;
      peerKeypair?: PeerKeypair;
      snapshotEveryUpdates: number;
      shardCacheCapacity: number;
    },
    private readonly createChildApp: () => App,
  ) {}

  /** This dataRoot's stable Loro peer id (undefined in in-memory mode → Loro auto-assigns). */
  get peerId(): number | undefined {
    return this.options.peerId;
  }

  /** This dataRoot's peer X25519 keypair (the transit-wrap target / per-peer revocation unit,
   *  design §13). Persisted per-dataRoot alongside peerId; ephemeral in in-memory mode. */
  get peerKeypair(): PeerKeypair | undefined {
    return this.options.peerKeypair;
  }

  /** The LocalPeer (session actor + per-dataRoot peer key + peerId) a host uses for wire security
   *  + membership ops on this dataRoot. The actor is per-session; the peer key + peerId are this
   *  dataRoot's. Throws if this runtime has no peer identity (only in odd non-persistent configs). */
  localPeerFor(actor: ActorKeypair): LocalPeer {
    if (this.peerId === undefined || this.peerKeypair === undefined) {
      throw new Error("no peer identity on this dataRoot");
    }
    return { actor, peer: this.peerKeypair, peerId: String(this.peerId) };
  }

  static inMemory(createChildApp: () => App = () => new App()): Promise<AppWorkspaceRuntime> {
    return Promise.resolve(
      new AppWorkspaceRuntime(
        {
          registry: null,
          peerId: randomInt(1, 2 ** 48),
          peerKeypair: generatePeerKeypair(),
          snapshotEveryUpdates: Number.POSITIVE_INFINITY,
          shardCacheCapacity: Number.POSITIVE_INFINITY,
        },
        createChildApp,
      ),
    );
  }

  static async persistent(
    options: PersistenceOptions,
    createChildApp: () => App = () => new App(),
  ): Promise<AppWorkspaceRuntime> {
    const registry = await RegistryStore.open(options.dataRoot);
    const peerId = await registry.ensurePeerId();
    const peerKeypair = await ensurePeerKey(registry);
    return new AppWorkspaceRuntime(
      {
        dataRoot: options.dataRoot,
        registry,
        peerId,
        peerKeypair,
        snapshotEveryUpdates: options.snapshotEveryUpdates ?? 100,
        shardCacheCapacity: options.shardCacheCapacity ?? DEFAULT_SHARD_CACHE_CAPACITY,
      },
      createChildApp,
    );
  }

  // Wraps a loaded workspace + store in a ChildApp (started now) and records it. The load
  // logic itself (loadShardedDoc, reconcile, validate) stays in the caller; this only owns
  // the per-workspace lifecycle mounting.
  private async registerLoaded(
    workspaceId: string,
    workspace: Workspace,
    store: WorkspaceStore | null,
  ): Promise<LoadedWorkspace> {
    const app = this.createChildApp();
    app.register(new WorkspaceComponent(workspace));
    app.register(new WorkspaceStoreComponent(store));
    await app.start();
    // The engine owns the membership log (workspace state). Loaded from persistence here — empty on
    // a first create; an owner's root is appended in createWorkspace. The sync runner consumes it via
    // membershipLog() and never constructs one of its own. Membership persists via the DocStore port
    // (a content sub-doc under its own id), not a dedicated table.
    const docStore = store ? new WorkspaceDocStore(store) : null;
    const membershipLog = new MembershipLog(
      new LoroMetaDoc(MEMBERSHIP_DOC_ID),
      docStore ? new DocStoreMembershipPersistence(docStore, MEMBERSHIP_DOC_ID) : undefined,
    );
    await membershipLog.load();
    const loaded = { app, workspace, store, docStore, membershipLog };
    this.loaded.set(workspaceId, loaded);
    return loaded;
  }

  /** Create a workspace, or return it unchanged if it already exists. Idempotent and serialized: a
   *  concurrent create for the same id (two joins racing, or a re-create) runs after the in-flight one
   *  resolves, sees the ws exists, and returns it — never re-inserting, re-rooting, or re-doc'ing. */
  async createWorkspace(input: {
    workspaceId?: string;
    displayName: string;
    /** The creator's peer label ("Alice's laptop"); stored on the membership root. Advisory, UI-only. */
    peerName?: string;
    /** The creator's keypair. Present ⇒ this create OWNS the workspace: append the membership root
     *  (creator = owner, ACL-at-birth). Absent ⇒ a local-only / joiner create with no root (the owner's
     *  root converges over sync). */
    actorKeypair?: ActorKeypair;
  }): Promise<RuntimeWorkspaceInfo> {
    // Serialized on `createChain` (see runSerialized) so the existence check in doCreateWorkspace is
    // atomic w.r.t. a concurrent create — no TOCTOU into a duplicate insert.
    return this.runSerialized(() => this.doCreateWorkspace(input));
  }

  private createChain: Promise<void> = Promise.resolve();
  /** Per-workspace mutation chains — same-workspace mutations serialize (one completes before the
   *  next starts); different workspaces mutate in parallel. The CRDT-paradigm rule: same-replica
   *  operations are serial (concurrency is expressed via sync + merge, not parallel mutation). This
   *  makes the `residentSession` working-set gate reliably single-operation + `ActionHistory`
   *  begin/end grouping non-interleaving, so concurrent multi-client writes to one workspace QUEUE
   *  (ms, invisible) instead of erroring ("session already active") or tearing a read-modify-write. */
  private readonly workspaceChains = new Map<string, Promise<void>>();

  /** Run `work` serialized on `createChain` so workspace-creating ops (create, fork) are atomic w.r.t.
   *  each other. `work` never throws up — it rejects the returned promise and leaves the chain
   *  fulfilled, so a later op still runs. (createChain serializes only these ops; it does NOT guard
   *  against a concurrent `flushDirty` or peer edits to a workspace — fork's source read relies
   *  on `reconcileDurability` for that, see doForkWorkspace.) */
  private runSerialized<T>(work: () => Promise<T>): Promise<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const run = async () => {
      try {
        resolve(await work());
      } catch (e) {
        reject(e);
      }
    };
    this.createChain = this.createChain.then(run);
    return result;
  }

  /** Run `work` serialized on `workspaceId`'s chain so same-workspace MUTATIONS are atomic w.r.t.
   *  each other. Same never-throws-up semantics as `runSerialized`: `work`'s outcome rejects the
   *  returned promise while the chain stays fulfilled (a failed mutation doesn't block later ones).
   *  Per-workspace key (not global) so independent workspaces proceed in parallel. */
  runWorkspaceSerialized<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const run = async () => {
      try {
        resolve(await work());
      } catch (e) {
        reject(e);
      }
    };
    const prev = this.workspaceChains.get(workspaceId) ?? Promise.resolve();
    this.workspaceChains.set(workspaceId, prev.then(run));
    return result;
  }

  private async doCreateWorkspace(input: {
    workspaceId?: string;
    displayName: string;
    peerName?: string;
    actorKeypair?: ActorKeypair;
  }): Promise<RuntimeWorkspaceInfo> {
    // Idempotent: an existing ws is returned untouched (the serialization above guarantees this sees
    // the result of any prior in-flight create for the same id).
    if (input.workspaceId !== undefined) {
      if (!this.options.registry) {
        const existing = this.memoryCatalog.get(input.workspaceId);
        if (existing) {
          return existing;
        }
      } else {
        const record = await this.options.registry.getWorkspace(input.workspaceId);
        if (record) {
          return recordToInfo(record);
        }
      }
    }
    let info: RuntimeWorkspaceInfo;
    let loaded: LoadedWorkspace;
    if (!this.options.registry) {
      const workspaceId = input.workspaceId ?? randomUUID();
      info = { workspaceId, displayName: input.displayName };
      this.memoryCatalog.set(workspaceId, info);
      loaded = await this.registerLoaded(workspaceId, new Workspace({ id: workspaceId }), null);
    } else {
      const record = await this.options.registry.createWorkspace(input);
      info = recordToInfo(record);
      loaded = await this.loadPersistentWorkspace(record);
    }
    // Creator asserts ownership by signing the membership root with its ACTOR key, seeding the owner's
    // first PEER (the per-dataRoot peerId + X25519 enc pub) as the first admitted peer. Guarded on
    // an empty log so a re-create over an already-rooted workspace is a no-op (never double-roots).
    if (
      input.actorKeypair !== undefined &&
      this.peerId !== undefined &&
      this.peerKeypair !== undefined &&
      loaded.membershipLog.records().length === 0
    ) {
      const local: LocalPeer = {
        actor: input.actorKeypair,
        peer: this.peerKeypair,
        peerId: String(this.peerId),
      };
      loaded.membershipLog.appendRoot(local, randomBytes(32), input.peerName ?? "");
      await loaded.membershipLog.persistIfDirty();
    }
    // A ws is one outliner: auto-init the single content engine at creation. Both owner-create
    // (keypair present) and joiner-create (no keypair) get it, so the joiner converges the owner's
    // content into it. (The existence check above means this only runs on a genuine new ws.)
    const doc = await this.initOutliner(info.workspaceId);
    // Single-root tree: the owner's createWorkspace creates the one root node (named = the
    // workspace's display name), gated on the owner keypair exactly like the membership root above.
    // The joiner (no keypair) creates no root — it converges the owner's root over sync. Guarded on
    // an empty tree so a re-create never double-roots. The runtime calls the domain primitive
    // directly (parent = null), bypassing the service-layer parent-required guard the RPC path
    // enforces.
    if (input.actorKeypair !== undefined && (await doc.getRootOccurrences()).length === 0) {
      // The root op lands in the tree; flushDirty persists it (the tree's exportUpdate cursor captures
      // the delta) so a restart reloads a rooted tree, not an empty one.
      const root = await createPlainNode(doc, null);
      await doc.replaceDeltas(root.occurrenceId, [{ insert: input.displayName }]);
      await this.flushDirty(info.workspaceId);
    }
    return info;
  }

  /** Fork a workspace: copy the source's content (treeDoc + shards) into a NEW workspace (new wsId)
   *  with an EMPTY membership log + a fresh owner root signed by the forker's actor (design §13 —
   *  recovery for kicked / lost-owner / rogue-owner). The forker becomes the new owner at epoch 0;
   *  the source's log + re-key chain do NOT carry over. Content at rest is plaintext (transit is
   *  wire-only), so the copy has no decryption gap. Serialized on `createChain` like createWorkspace
   *  (fork mints a ws). Does NOT share a helper with doCreateWorkspace: fork imports source content
   *  and skips the empty-doc + root-seed, so a shared core would be a forced abstraction. */
  async forkWorkspace(input: {
    sourceWorkspaceId: string;
    displayName: string;
    /** The forker's peer label for the new root. Advisory, UI-only. */
    peerName?: string;
    /** The forker's actor keypair — signs the fresh root (forker = new owner). */
    actorKeypair: ActorKeypair;
  }): Promise<RuntimeWorkspaceInfo> {
    return this.runSerialized(() => this.doForkWorkspace(input));
  }

  private async doForkWorkspace(input: {
    sourceWorkspaceId: string;
    displayName: string;
    peerName?: string;
    actorKeypair: ActorKeypair;
  }): Promise<RuntimeWorkspaceInfo> {
    // Fork needs the SOURCE doc + shards materialized to export them → trigger-load
    // (requireWorkspace, not the peek-only membershipLog()). The source is read-only here — fork
    // never mutates it; it leaves the forker's copy of the old ws intact.
    const source = await this.requireWorkspace(input.sourceWorkspaceId);
    const sourceEngine = source.workspace.engine;
    if (sourceEngine === null) {
      throw new Error(`forkWorkspace: source has no outliner: ${input.sourceWorkspaceId}`);
    }
    const sourceSharded = sourceEngine.asOutliner();
    // Export the source's tree (always-resident) + stream its shards one at a time — never
    // materialize the full shard set in memory (invariant I). The source's own capacity bound makes
    // the sequential shard export fault→evict→next, so source memory stays bounded.
    const sourceTreeSync = sourceSharded.treeSyncDoc();
    const treeBytes: LoadedDocBytes = {
      snapshot: await sourceTreeSync.exportSnapshot(),
      updates: [],
    };
    if (this.peerId === undefined || this.peerKeypair === undefined) {
      throw new Error("forkWorkspace: no peer identity on this dataRoot");
    }
    const local: LocalPeer = {
      actor: input.actorKeypair,
      peer: this.peerKeypair,
      peerId: String(this.peerId),
    };

    let info: RuntimeWorkspaceInfo;
    let loaded: LoadedWorkspace;
    if (!this.options.registry) {
      const workspaceId = randomUUID();
      info = { workspaceId, displayName: input.displayName };
      this.memoryCatalog.set(workspaceId, info);
      // In-memory clone: materialize source shards into a seeded InMemoryDocStore (the clone is
      // ephemeral, small — no durable DocStore to stream into). Keyed by outward id, like any DocStore.
      const shardSeed = new Map<string, LoadedDocBytes>();
      for (const doc of sourceSharded.shardSyncDocs()) {
        shardSeed.set(doc.id, {
          snapshot: await doc.exportSnapshot(),
          updates: [],
        });
      }
      const workspace = await this.buildForkedWorkspace(workspaceId, treeBytes, {
        docStore: new InMemoryDocStore(shardSeed),
      });
      loaded = await this.registerLoaded(workspaceId, workspace, null);
    } else {
      if (!this.options.dataRoot) {
        throw new Error("Persistent workspace runtime missing data root");
      }
      const record = await this.options.registry.createWorkspace({
        displayName: input.displayName,
      });
      info = recordToInfo(record);
      const store = await WorkspaceStore.open(
        workspaceDbPath(this.options.dataRoot, record.relativePath),
      );
      // Stream source → fork DocStore: tree + each shard snapshot written one at a time (no full
      // materialization). The fork store then lazily faults from this DocStore.
      const forkDocStore = new WorkspaceDocStore(store);
      await forkDocStore.writeSnapshot(sourceTreeSync.id, treeBytes.snapshot ?? new Uint8Array());
      for (const doc of sourceSharded.shardSyncDocs()) {
        await forkDocStore.writeSnapshot(doc.id, await doc.exportSnapshot());
      }
      const workspace = await this.buildForkedWorkspace(record.workspaceId, treeBytes, {
        docStore: forkDocStore,
        snapshotEveryUpdates: this.options.snapshotEveryUpdates,
      });
      loaded = await this.registerLoaded(record.workspaceId, workspace, store);
    }

    // Fresh owner root: the forker's actor self-signs; transit wrapped to the forker's peer (THIS
    // dataRoot's peer — reused, not minted). The log is empty by construction (new wsId), so no
    // empty-guard is needed (unlike createWorkspace's idempotent re-create path).
    loaded.membershipLog.appendRoot(local, randomBytes(32), input.peerName ?? "");
    await loaded.membershipLog.persistIfDirty();
    return info;
  }

  /** Build the forked Workspace: one outliner eager over `treeBytes`, lazy over the shard `DocStore`
   *  (the runtime adapter for persistent forks, a seeded `InMemoryDocStore` for in-memory clones).
   *  `snapshotEveryUpdates` is omitted for in-memory clones (no compaction — ephemeral). reconcile
   *  heals any tree↔shard skew from a concurrent write to the source (the tree + shard exports are
   *  not atomic w.r.t. a racing writer); the structural check then runs TREE-ONLY (zero shard reads)
   *  so the fork does ONE shard walk (reconcile's), not a second toJSON pass. Entity existence is
   *  ensured by reconcile's heal; the treeDoc is a single atomic CRDT export, so its structure
   *  (parent↔child / cycles / detached) cannot be skewed by the non-atomic fork copy. */
  private async buildForkedWorkspace(
    workspaceId: string,
    treeBytes: LoadedDocBytes,
    sink: { docStore: DocStore; snapshotEveryUpdates?: number },
  ): Promise<Workspace> {
    const workspace = new Workspace({ id: workspaceId });
    // peerId is defined here — doForkWorkspace threw above if it weren't.
    const blockStore = new ShardedBlockStore({
      treeBytes,
      peerId: this.peerId,
      capacity: this.options.shardCacheCapacity,
      docStore: sink.docStore,
      ...(sink.snapshotEveryUpdates !== undefined
        ? { snapshotEveryUpdates: sink.snapshotEveryUpdates }
        : {}),
    });
    const doc = workspace.createEngine({ store: blockStore });
    await blockStore.reconcileDurability();
    // Persist the heal so the next open doesn't re-heal (the heal deltas land in the fork DocStore).
    await blockStore.flushDirty();
    const occ = toJSONOccurrences(doc);
    validateOccurrenceStructure(occ.occurrences, occ.rootOccurrenceIds);
    return workspace;
  }

  async listWorkspaces(): Promise<RuntimeWorkspaceInfo[]> {
    if (!this.options.registry) {
      return [...this.memoryCatalog.values()];
    }
    return (await this.options.registry.listWorkspaces()).map(recordToInfo);
  }

  async removeWorkspace(workspaceId: string): Promise<boolean> {
    const loaded = this.loaded.get(workspaceId);
    if (loaded) {
      await this.markCleanShutdown(loaded);
      await loaded.app.stop();
    }
    this.loaded.delete(workspaceId);
    if (!this.options.registry) {
      return this.memoryCatalog.delete(workspaceId);
    }
    return this.options.registry.removeWorkspace(workspaceId);
  }

  /** Mark this workspace's shutdown clean (write the "clean" meta marker). A crash skips this, so the
   *  next load sees the stale "dirty" (or absent) marker and runs reconcile. */
  private async markCleanShutdown(loaded: LoadedWorkspace): Promise<void> {
    if (loaded.docStore) {
      await loaded.docStore.writeSnapshot(WORKSPACE_META_ID, encode(CLEAN_SHUTDOWN));
    }
  }

  /** True iff the last shutdown was NOT clean (or the marker is absent — a fresh/crashed workspace).
   * Flips the marker to "dirty" so a crash before the next clean close is detected. */
  private async shouldReconcile(docStore: DocStore): Promise<boolean> {
    const meta = await docStore.load(WORKSPACE_META_ID);
    const clean =
      meta?.snapshot !== undefined &&
      meta?.snapshot !== null &&
      new TextDecoder().decode(meta.snapshot) === CLEAN_SHUTDOWN;
    await docStore.writeSnapshot(WORKSPACE_META_ID, encode(RUNNING));
    return !clean;
  }

  /** Create the workspace's single outliner engine (empty). The tree is NOT eagerly snapshotted
   *  here — an empty tree has no bytes to persist, and doc bytes have a single writer (the
   *  `ShardPersister`, via `flushDirty`). The first mutation's `flushDirty` persists the tree as an
   *  incremental delta (the cursor seeded at construction captures the empty baseline); a never-
   *  mutated workspace reloads as empty (null tree → fresh empty tree), which is consistent. */
  private async initOutliner(workspaceId: string): Promise<Engine> {
    const loaded = await this.requireWorkspace(workspaceId);
    const blockStore = new ShardedBlockStore({
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      ...(loaded.docStore
        ? { docStore: loaded.docStore, snapshotEveryUpdates: this.options.snapshotEveryUpdates }
        : {}),
      capacity: this.options.shardCacheCapacity,
    });
    return loaded.workspace.createEngine({ store: blockStore });
  }

  async getEngine(workspaceId: string): Promise<Engine | null> {
    const loaded = await this.getWorkspace(workspaceId);
    return loaded?.workspace?.engine ?? null;
  }

  /** The engine for an ALREADY-loaded workspace, WITHOUT triggering a load. Sync attaches to open
   *  workspaces; calling the load path here would race with the doc-adding load (a concurrent reload
   *  can overwrite the `loaded` entry and lose a just-added doc). Null if the workspace isn't open. */
  loadedEngine(workspaceId: string): Engine | null {
    return this.loaded.get(workspaceId)?.workspace?.engine ?? null;
  }

  /** The membership log for an ALREADY-loaded workspace (null if not open yet). Peek-only — never
   *  triggers a load. The log is created + loaded in registerLoaded and rooted at createWorkspace;
   *  the sync runner consumes it here instead of constructing its own. */
  membershipLog(workspaceId: string): MembershipLog | null {
    return this.loaded.get(workspaceId)?.membershipLog ?? null;
  }

  /** Flush every change since the last call to the workspace's DocStore — a thin delegate to the
   *  outliner's `flushDirty()` (tree + dirty shards, each an incremental delta via the persister).
   *  The single persistence entry point: local mutations, sync rounds, and lifecycle heal all route
   *  through it. No-op in-memory (no DocStore). */
  async flushDirty(workspaceId: string): Promise<void> {
    const loaded = await this.requireWorkspace(workspaceId);
    if (!loaded.docStore) {
      return;
    }
    const engine = loaded.workspace.engine;
    if (!engine) {
      throw new Error("Workspace has no engine");
    }
    await engine.asOutliner().flushDirty();
  }

  /** Close all workspace stores + the registry WITHOUT writing the clean-shutdown marker — models a
   *  crash so the next load runs reconcile + validate (the gate skips them after a clean close). For
   *  crash-recovery tests. */
  async crashClose(): Promise<void> {
    for (const loaded of this.loaded.values()) {
      await loaded.app.stop();
    }
    this.loaded.clear();
    await this.options.registry?.close();
  }

  async close(): Promise<void> {
    for (const loaded of this.loaded.values()) {
      await this.markCleanShutdown(loaded);
      await loaded.app.stop();
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
    let workspace: Workspace;
    try {
      workspace = new Workspace({ id: record.workspaceId });
      await this.loadOutliner(new WorkspaceDocStore(store), workspace);
    } catch (error) {
      // loadOutliner can reject a corrupt persisted state (validateSnapshot after reconcile).
      // No ChildApp is registered yet, so close the store directly to avoid leaking the handle.
      await store.close();
      throw error;
    }
    return this.registerLoaded(record.workspaceId, workspace, store);
  }

  /**
   * Load the workspace's outliner: eagerly load ONLY the tree (the one always-resident doc) and hand
   * the DocStore to the store so shards fault LAZILY on first access — no path here pre-reads every
   * shard (invariant I: memory is O(tree) + O(capacity), independent of content size). reconcile runs
   * only after a non-clean shutdown (a crash left tree↔shard skew); a clean load skips it. Membership
   * + other meta docs live under their own non-`sys:` ids, so they're never mistaken for the tree.
   */
  private async loadOutliner(docStore: DocStore, workspace: Workspace): Promise<void> {
    const treeBytes = await docStore.load(SYS_PREFIX + TREE_SUBDOC);
    if (treeBytes === null) {
      return; // nothing persisted (a fresh workspace inits its empty snapshot via initOutliner)
    }
    const blockStore = new ShardedBlockStore({
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      treeBytes,
      docStore,
      snapshotEveryUpdates: this.options.snapshotEveryUpdates,
      capacity: this.options.shardCacheCapacity,
    });
    const engine = workspace.createEngine({ store: blockStore });
    if (await this.shouldReconcile(docStore)) {
      // reconcileDurability self-heals create/delete orphans a crash left between treeDoc and shards;
      // validateSnapshot then rejects anything it CANNOT heal. Streaming (one shard at a time).
      await blockStore.reconcileDurability();
      // Persist the heal (tree edits + swept shards) + unpin the shards reconcile pinned via
      // shardForWrite, restoring the residency bound. Without this the heal is lost on the next crash
      // and the pinned shards keep resident beyond capacity (the pin leak).
      await blockStore.flushDirty();
      validateSnapshot(await toJSON(engine));
    }
  }
}

function recordToInfo(record: WorkspaceRecord): RuntimeWorkspaceInfo {
  return {
    workspaceId: record.workspaceId,
    displayName: record.displayName,
  };
}

const PEER_PRIV_KEY_META = "peerPrivKey";

/** Get-or-create this dataRoot's peer X25519 keypair (design §13). The private scalar is persisted
 *  in registry_meta (opaque bytes — the registry leaf stores it without knowing it is a key); the
 *  public is deterministic from the private. Random, NOT mnemonic-derived — a lost mnemonic must not
 *  let a revoked peer re-derive its key. */
async function ensurePeerKey(registry: RegistryStore): Promise<PeerKeypair> {
  const stored = await registry.getMeta(PEER_PRIV_KEY_META);
  if (stored !== null) {
    try {
      return peerKeypairFromPrivateKey(new Uint8Array(Buffer.from(stored, "hex")));
    } catch {
      // A corrupt/stale value — fall through and re-generate.
    }
  }
  const kp = generatePeerKeypair();
  await registry.setMeta(PEER_PRIV_KEY_META, Buffer.from(kp.privateKey).toString("hex"));
  return kp;
}
