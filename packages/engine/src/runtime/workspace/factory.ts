import { randomBytes } from "node:crypto";
import { type DocStore, type Engine, type LoadedDocBytes, Workspace } from "../../core/index.js";
import { createWorkspaceRoot } from "../../domain/node/node.js";
import type { RegistryStore, WorkspaceRecord } from "../../persistence/registry-store.js";
import type { WorkspaceStore } from "../../persistence/workspace-store.js";
import type { ActorKeypair } from "../../utils/crypto/index.js";
import type { PeerIdentity } from "../identity/peer-identity.js";
import type { LocalPeer } from "../membership/membership-log.js";
import type { WorkspacePersistence } from "./persistence.js";
import type { LoadedWorkspace, RuntimeWorkspaceInfo } from "./types.js";

export type CreateWorkspaceInput = {
  workspaceId?: string;
  displayName: string;
  /** The creator's peer label ("Alice's laptop"); stored on the membership root. Advisory, UI-only. */
  peerName?: string;
  /** The creator's keypair. Present ⇒ this create OWNS the workspace: append the membership root
   *  (creator = owner, ACL-at-birth) + seed the single-root tree. Absent ⇒ a local-only / joiner
   *  create with no root (the owner's root converges over sync). */
  actorKeypair?: ActorKeypair;
};

export type ForkWorkspaceInput = {
  sourceWorkspaceId: string;
  displayName: string;
  /** The forker's peer label for the new root. Advisory, UI-only. */
  peerName?: string;
  /** The forker's actor keypair — signs the fresh root (forker = new owner). */
  actorKeypair: ActorKeypair;
};

/** What the factory needs from the AppWorkspaceRuntime facade: the stateful ops that touch the
 *  loaded map (mount / flush / require) and persistent loading. The facade implements this. */
export type WorkspaceFactoryHost = {
  mount(
    workspaceId: string,
    workspace: Workspace,
    store: WorkspaceStore | null,
    docStore: DocStore,
  ): Promise<LoadedWorkspace>;
  flushDirty(workspaceId: string): Promise<void>;
  requireLoaded(workspaceId: string): Promise<LoadedWorkspace>;
  loadPersistent(record: WorkspaceRecord): Promise<LoadedWorkspace>;
};

/** Opens a workspace's content store (the per-workspace persistence) for a freshly-created record.
 *  Persistent: a SQLite WorkspaceStore + its WorkspaceDocStore. In-memory: a fresh InMemoryDocStore +
 *  no WorkspaceStore. Injecting this lets create/fork run one code path for both modes. */
export type WorkspaceContentOpener = {
  open(record: WorkspaceRecord): Promise<{ store: WorkspaceStore | null; docStore: DocStore }>;
};

/** Record + content storage — always a RegistryStore (SQLite or in-memory) + the content-store
 *  opener. No `if (!registry)` / memoryCatalog: "persistent vs in-memory" is which impls are injected. */
export type WorkspaceFactoryStorage = {
  registry: RegistryStore;
  opener: WorkspaceContentOpener;
  snapshotEveryUpdates: number;
};

/**
 * Workspace creation + fork — the product policy that runs at "a workspace is born." Owns ACL-at-birth
 * (the membership owner root) + the single-root content seed, expressed via a seed policy so the
 * owner/joiner difference is a null-object, not a scattered `if (actorKeypair)`. Holds no loaded map:
 * the facade resolves stateful ops via the host interface.
 */
export class WorkspaceFactory {
  constructor(
    private readonly peer: PeerIdentity,
    private readonly persistence: WorkspacePersistence,
    private readonly storage: WorkspaceFactoryStorage,
    private readonly host: WorkspaceFactoryHost,
  ) {}

  /** Create a workspace, or return it unchanged if it already exists. Idempotent (the facade
   *  serializes create/fork on the createChain, so the existence check is atomic w.r.t. a concurrent
   *  create — no TOCTOU into a duplicate insert). */
  async create(input: CreateWorkspaceInput): Promise<RuntimeWorkspaceInfo> {
    if (input.workspaceId !== undefined) {
      const existing = await this.lookupExisting(input.workspaceId);
      if (existing) {
        return existing;
      }
    }
    // One path for both modes: the registry stores the record; the opener provides the content store
    // (SQLite WorkspaceStore + DocStore, or an in-memory DocStore). The content engine is initialized
    // AFTER mount so the membership log (a separate doc) and the outliner are both ready before the
    // seed policy runs.
    const record = await this.storage.registry.createWorkspace(input);
    const { store, docStore } = await this.storage.opener.open(record);
    const loaded = await this.host.mount(
      record.workspaceId,
      new Workspace({ id: record.workspaceId }),
      store,
      docStore,
    );
    // A ws is one outliner: auto-init the single content engine at creation. Both owner-create
    // (keypair present) and joiner-create (no keypair) get it, so the joiner converges the owner's
    // content into it.
    const engine = this.persistence.initOutliner(loaded.workspace, docStore);
    // ACL-at-birth + single-root seed — owner does both, joiner (no actor) is a no-op. The one
    // sanctioned root is planted via createWorkspaceRoot (the domain's only rooting entry).
    await seedPolicyFor(input, this.peer).apply({
      log: loaded.membershipLog,
      engine,
      displayName: input.displayName,
      flush: () => this.host.flushDirty(record.workspaceId),
    });
    return recordToInfo(record);
  }

  /** Fork: copy the source's content (treeDoc + shards) into a NEW workspace (new wsId) with an EMPTY
   *  membership log + a fresh owner root signed by the forker's actor (design §13 — recovery for
   *  kicked / lost-owner / rogue-owner). The forker becomes the new owner at epoch 0; the source's
   *  log + re-key chain do NOT carry over. Content at rest is plaintext (transit is wire-only), so
   *  the copy has no decryption gap. */
  async fork(input: ForkWorkspaceInput): Promise<RuntimeWorkspaceInfo> {
    // Fork needs the SOURCE doc + shards materialized to export them → trigger-load (requireLoaded,
    // not the peek-only membershipLog). The source is read-only here — fork never mutates it.
    const source = await this.host.requireLoaded(input.sourceWorkspaceId);
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
    const local = this.peer.localPeerFor(input.actorKeypair);

    // One path for both modes: registry stores the record; opener provides the content DocStore
    // (SQLite or in-memory); source tree + shards stream into it one at a time (invariant I — never
    // materialize the full shard set); the fork store then lazily faults from it.
    const record = await this.storage.registry.createWorkspace({ displayName: input.displayName });
    const { store, docStore } = await this.storage.opener.open(record);
    await docStore.writeSnapshot(sourceTreeSync.id, treeBytes.snapshot ?? new Uint8Array());
    for (const doc of sourceSharded.shardSyncDocs()) {
      await docStore.writeSnapshot(doc.id, await doc.exportSnapshot());
    }
    const workspace = await this.persistence.buildForkedWorkspace(record.workspaceId, treeBytes, {
      docStore,
      snapshotEveryUpdates: this.storage.snapshotEveryUpdates,
    });
    const loaded = await this.host.mount(record.workspaceId, workspace, store, docStore);

    // Fresh owner root: the forker's actor self-signs; transit wrapped to the forker's peer (THIS
    // dataRoot's peer — reused, not minted). The log is empty by construction (new wsId), so no
    // empty-guard is needed (unlike create's idempotent re-create path).
    loaded.membershipLog.appendRoot(local, randomBytes(32), input.peerName ?? "");
    await loaded.membershipLog.persistIfDirty();
    return recordToInfo(record);
  }

  private async lookupExisting(workspaceId: string): Promise<RuntimeWorkspaceInfo | null> {
    const record = await this.storage.registry.getWorkspace(workspaceId);
    return record ? recordToInfo(record) : null;
  }
}

function recordToInfo(record: WorkspaceRecord): RuntimeWorkspaceInfo {
  return { workspaceId: record.workspaceId, displayName: record.displayName };
}

// ── create-time seed policy (owner/joiner null-object) ──────────────────────────

type SeedArgs = {
  log: LoadedWorkspace["membershipLog"];
  engine: Engine;
  displayName: string;
  flush: () => Promise<void>;
};

type WorkspaceSeed = {
  /** Append the membership owner root (ACL-at-birth) + seed the single-root content node — guarded
   *  for idempotency (empty log / empty tree) so a re-create never double-roots. No-op for a joiner:
   *  no actor ⇒ the owner's root converges over sync. */
  apply(args: SeedArgs): Promise<void>;
};

/** The owner's create-time seeding: ACL-at-birth (membership root) + the one sanctioned content root. */
class OwnerSeed implements WorkspaceSeed {
  constructor(
    private readonly local: LocalPeer,
    private readonly peerName: string,
  ) {}

  async apply({ log, engine, displayName, flush }: SeedArgs): Promise<void> {
    if (log.records().length === 0) {
      log.appendRoot(this.local, randomBytes(32), this.peerName);
      await log.persistIfDirty();
    }
    // The one sanctioned root: createWorkspaceRoot is the domain's only rooting entry (idempotent —
    // a no-op once a root exists), so seeding never bypasses the single-root policy.
    await createWorkspaceRoot(engine, displayName);
    await flush();
  }
}

/** A joiner / local-only create: seeds nothing — the owner's membership root + content root converge
 *  over sync. */
class JoinerSeed implements WorkspaceSeed {
  async apply(): Promise<void> {}
}

/** Select the seed policy from the create input + this dataRoot's peer identity. The ONE branch that
 *  distinguishes owner from joiner; everywhere else the policy is applied uniformly. */
function seedPolicyFor(input: CreateWorkspaceInput, peer: PeerIdentity): WorkspaceSeed {
  if (
    input.actorKeypair !== undefined &&
    peer.peerId !== undefined &&
    peer.peerKeypair !== undefined
  ) {
    return new OwnerSeed(peer.localPeerFor(input.actorKeypair), input.peerName ?? "");
  }
  return new JoinerSeed();
}
