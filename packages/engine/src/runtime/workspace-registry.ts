/* eslint-disable max-lines -- per-workspace lifecycle + sharded persistence composition root;
   the peerId/store/createDoc/load/persist wiring is cohesive in one place */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  LoroMetaDoc,
  Workspace,
  type DocStore,
  type Engine,
  type LoadedDocBytes,
  type SyncBytes,
} from "../core/index.js";
import { ShardedBlockStore } from "../core/sharded-store.js";
import { WorkspaceDocStore } from "./workspace-doc-store.js";
import { validateSnapshot } from "../core/invariant.js";
import { toJSON } from "../core/serializers/json.js";
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
};

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
  // Null in in-memory mode. loadOutliner/persistMutation/initOutliner speak this, not the leaf.
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

  /** Run `work` serialized on `createChain` so workspace-creating ops (create, fork) are atomic w.r.t.
   *  each other. `work` never throws up — it rejects the returned promise and leaves the chain
   *  fulfilled, so a later op still runs. (createChain serializes only these ops; it does NOT guard
   *  against a concurrent `persistMutation` or peer edits to a workspace — fork's source read relies
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
    if (input.actorKeypair !== undefined && doc.getRootOccurrences().length === 0) {
      // Capture the pre-create version (via the tree SyncableDoc) so the root op is appended as one
      // update; otherwise a restart reloads an empty tree.
      const tree = doc.asOutliner().treeSyncDoc();
      if (!tree) {
        throw new Error("createWorkspace: outliner has no syncable tree");
      }
      const beforeVersion = tree.version();
      const root = createPlainNode(doc, null);
      doc.replaceDeltas(root.occurrenceId, [{ insert: input.displayName }]);
      await this.persistMutation(info.workspaceId, beforeVersion);
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
    // Export the source's full current state as a residentBytes map keyed by outward SyncableDoc ids
    // — the same shape the load path produces. The store's partition identifies tree + shards from it.
    const residentBytes = new Map<string, LoadedDocBytes>();
    const sourceTree = sourceSharded.treeSyncDoc().exportSnapshot();
    residentBytes.set(sourceSharded.treeSyncDoc().id, { snapshot: sourceTree, updates: [] });
    for (const doc of sourceSharded.shardSyncDocs()) {
      residentBytes.set(doc.id, { snapshot: doc.exportSnapshot(), updates: [] });
    }
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
      const workspace = this.buildForkedWorkspace(workspaceId, residentBytes);
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
      const workspace = this.buildForkedWorkspace(record.workspaceId, residentBytes);
      // Persist the copied content as pure snapshots via the DocStore port — the residentBytes map IS
      // the new outliner's state, so this is exactly what reload reconstructs. The port is the
      // canonical write surface; each doc keyed by its outward SyncableDoc id.
      const forkDocStore = new WorkspaceDocStore(store);
      for (const [id, bytes] of residentBytes) {
        if (bytes.snapshot) {
          await forkDocStore.writeSnapshot(id, bytes.snapshot);
        }
      }
      loaded = await this.registerLoaded(record.workspaceId, workspace, store);
    }

    // Fresh owner root: the forker's actor self-signs; transit wrapped to the forker's peer (THIS
    // dataRoot's peer — reused, not minted). The log is empty by construction (new wsId), so no
    // empty-guard is needed (unlike createWorkspace's idempotent re-create path).
    loaded.membershipLog.appendRoot(local, randomBytes(32), input.peerName ?? "");
    await loaded.membershipLog.persistIfDirty();
    return info;
  }

  /** Build the forked Workspace: one outliner seeded from the source's exported residentBytes map —
   *  the write-side mirror of loadOutliner. The new treeDoc re-derives its ownership map from the
   *  imported tree bytes, so its shardIds() match the map's shard keys (deterministic
   *  nodeId→bucket→shardId, same numShards on both sides). */
  private buildForkedWorkspace(
    workspaceId: string,
    residentBytes: Map<string, LoadedDocBytes>,
  ): Workspace {
    const workspace = new Workspace({ id: workspaceId });
    // peerId is defined here — doForkWorkspace threw above if it weren't — so no conditional spread.
    const blockStore = new ShardedBlockStore({
      residentBytes,
      peerId: this.peerId,
    });
    const doc = workspace.createEngine({ store: blockStore });
    // reconcileDurability self-heals create/delete orphans between treeDoc and shards; validateSnapshot
    // rejects anything it cannot heal (mirrors loadOutliner's post-import checks). This is also
    // fork's safety net for a concurrent write to the source: the treeDoc + shard snapshots are not
    // taken atomically (createChain serializes fork only against other create/fork ops, not against
    // persistMutation or peer edits), so reconcileDurability heals any tree↔shard skew a racing
    // writer could introduce between the two exports.
    blockStore.reconcileDurability();
    validateSnapshot(toJSON(doc));
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
      await loaded.app.stop();
    }
    this.loaded.delete(workspaceId);
    if (!this.options.registry) {
      return this.memoryCatalog.delete(workspaceId);
    }
    return this.options.registry.removeWorkspace(workspaceId);
  }

  /** Create the workspace's single outliner engine (empty) + persist its initial empty snapshot via
   *  the DocStore port (the canonical write surface), keyed by the tree SyncableDoc id — not a raw
   *  store.writeSnapshot with a literal sub_doc. */
  private async initOutliner(workspaceId: string): Promise<Engine> {
    const loaded = await this.requireWorkspace(workspaceId);
    const blockStore = new ShardedBlockStore(
      this.peerId !== undefined ? { peerId: this.peerId } : {},
    );
    const engine = loaded.workspace.createEngine({ store: blockStore });
    if (loaded.docStore) {
      try {
        const tree = blockStore.treeSyncDoc();
        await loaded.docStore.writeSnapshot(tree.id, tree.exportSnapshot());
      } catch (error) {
        loaded.workspace.dispose();
        throw error;
      }
    }
    return engine;
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

  async persistMutation(workspaceId: string, beforeVersion: SyncBytes): Promise<void> {
    const loaded = await this.requireWorkspace(workspaceId);
    if (!loaded.docStore) {
      return;
    }
    const engine = loaded.workspace.engine;
    if (!engine) {
      throw new Error("Workspace has no engine");
    }
    const sharded = engine.asOutliner();
    // Persist via the structural SyncableDoc accessors over the DocStore port: the tree persists
    // incrementally (update stream + periodic snapshot); shards persist as their latest snapshot
    // only (overwritten — shards are small, lazy-load is the win). The port hides coveredUpdateSeq.
    const tree = sharded.treeSyncDoc();
    const seq = await loaded.docStore.appendUpdate(tree.id, tree.exportUpdate(beforeVersion));
    if (seq % this.options.snapshotEveryUpdates === 0) {
      await loaded.docStore.writeSnapshot(tree.id, tree.exportSnapshot());
    }
    for (const doc of sharded.shardSyncDocs()) {
      await loaded.docStore.writeSnapshot(doc.id, doc.exportSnapshot());
    }
  }

  async close(): Promise<void> {
    for (const loaded of this.loaded.values()) {
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
   * Load the workspace's outliner: read every persisted doc via the DocStore port into a
   * residentBytes map and hand it to the store. The store's `partitionResident` identifies the tree
   * + shards by the `sys:` prefix, so this load path carries no structure-id literal (and a
   * non-structure doc persisted alongside, like membership later, is naturally excluded). Shards
   * still materialize lazily on first access; true lazy disk read (not pre-reading every doc) is
   * deferred to the buffer-pool phase. reconcileDurability runs for cross-doc crash recovery.
   */
  private async loadOutliner(docStore: DocStore, workspace: Workspace): Promise<void> {
    const ids = await docStore.listIds();
    if (ids.length === 0) {
      return; // nothing persisted (a fresh workspace inits its empty snapshot via initOutliner)
    }
    // Load every persisted doc and hand the store the full map — the store's partition identifies
    // the tree + shards by the sys: prefix, so the load path carries no structure-id literal and a
    // non-structure doc persisted alongside (membership, later) is naturally excluded.
    const residentBytes = new Map<string, LoadedDocBytes>();
    for (const id of ids) {
      const bytes = await docStore.load(id);
      if (bytes) {
        residentBytes.set(id, bytes);
      }
    }
    const blockStore = new ShardedBlockStore({
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      residentBytes,
    });
    const engine = workspace.createEngine({ store: blockStore });
    // reconcileDurability self-heals create/delete orphans between treeDoc and shards;
    // validateSnapshot then rejects anything it CANNOT heal (a broken canonical ref, a detached
    // subtree, bytes from an incompatible version).
    blockStore.reconcileDurability();
    validateSnapshot(toJSON(engine));
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
