import { Workspace, type DocStore, type Engine, type LoadedDocBytes } from "../../core/index.js";
import { ShardedBlockStore, TREE_SUBDOC } from "../../core/store/sharded-store.js";
import { SYS_PREFIX } from "../../core/store/syncable.js";
import { validateOccurrenceStructure, validateSnapshot } from "../../core/invariant.js";
import { toJSON, toJSONOccurrences } from "../../core/serialize.js";

/** workspace_meta marker doc — a small doc carrying the clean-shutdown flag (the DocStore is generic
 *  id→bytes, so a non-`sys:` id keeps it out of the structure namespace). On a clean close the
 *  runtime writes "clean"; on load `shouldReconcile` reads it to skip the (streaming but full-scan)
 *  crash-restart reconcile, then flips it to "dirty" so a crash mid-run triggers reconcile. */
const WORKSPACE_META_ID = "workspace_meta";
const CLEAN_SHUTDOWN = "clean";
const RUNNING = "dirty";
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * The DocStore-facing load/persist/reconcile ops for a workspace — pure structure over the
 * workspace + DocStore + shard-store config. Holds no lifecycle, no registry, no loaded map: the
 * WorkspaceRegistry facade resolves a workspaceId to its (workspace, docStore) and delegates here.
 */
export class WorkspacePersistence {
  constructor(
    private readonly peerId: number | undefined,
    private readonly shardCacheCapacity: number,
    private readonly snapshotEveryUpdates: number,
  ) {}

  /** Create the workspace's single outliner engine (empty). The tree is NOT eagerly snapshotted
   *  here — an empty tree has no bytes to persist, and doc bytes have a single writer (the
   *  `ShardPersister`, via `flushDirty`). The first mutation's `flushDirty` persists the tree as an
   *  incremental delta (the cursor seeded at construction captures the empty baseline); a never-
   *  mutated workspace reloads as empty (null tree → fresh empty tree), which is consistent. */
  initOutliner(workspace: Workspace, docStore: DocStore): Engine {
    const blockStore = new ShardedBlockStore({
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      docStore,
      snapshotEveryUpdates: this.snapshotEveryUpdates,
      capacity: this.shardCacheCapacity,
    });
    return workspace.createEngine({ store: blockStore });
  }

  /**
   * Load the workspace's outliner: eagerly load ONLY the tree (the one always-resident doc) and hand
   * the DocStore to the store so shards fault LAZILY on first access — no path here pre-reads every
   * shard (invariant I: memory is O(tree) + O(capacity), independent of content size). reconcile runs
   * only after a non-clean shutdown (a crash left tree↔shard skew); a clean load skips it. Membership
   * + other meta docs live under their own non-`sys:` ids, so they're never mistaken for the tree.
   */
  async loadOutliner(docStore: DocStore, workspace: Workspace): Promise<void> {
    const treeBytes = await docStore.load(SYS_PREFIX + TREE_SUBDOC);
    if (treeBytes === null) {
      return; // nothing persisted (a fresh workspace inits its empty snapshot via initOutliner)
    }
    const blockStore = new ShardedBlockStore({
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      treeBytes,
      docStore,
      snapshotEveryUpdates: this.snapshotEveryUpdates,
      capacity: this.shardCacheCapacity,
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

  /** True iff the last shutdown was NOT clean (or the marker is absent — a fresh/crashed workspace).
   *  Flips the marker to "dirty" so a crash before the next clean close is detected. */
  async shouldReconcile(docStore: DocStore): Promise<boolean> {
    const meta = await docStore.load(WORKSPACE_META_ID);
    const clean =
      meta?.snapshot !== undefined &&
      meta?.snapshot !== null &&
      new TextDecoder().decode(meta.snapshot) === CLEAN_SHUTDOWN;
    await docStore.writeSnapshot(WORKSPACE_META_ID, encode(RUNNING));
    return !clean;
  }

  /** Mark this workspace's shutdown clean (write the "clean" meta marker). A crash skips this, so the
   *  next load sees the stale "dirty" (or absent) marker and runs reconcile. */
  async markCleanShutdown(docStore: DocStore): Promise<void> {
    await docStore.writeSnapshot(WORKSPACE_META_ID, encode(CLEAN_SHUTDOWN));
  }

  /** Build the forked Workspace: one outliner eager over `treeBytes`, lazy over the shard `DocStore`
   *  (the runtime adapter for persistent forks, a seeded `InMemoryDocStore` for in-memory clones).
   *  `snapshotEveryUpdates` is omitted for in-memory clones (no compaction — ephemeral). reconcile
   *  heals any tree↔shard skew from a concurrent write to the source (the tree + shard exports are
   *  not atomic w.r.t. a racing writer); the structural check then runs TREE-ONLY (zero shard reads)
   *  so the fork does ONE shard walk (reconcile's), not a second toJSON pass. Entity existence is
   *  ensured by reconcile's heal; the treeDoc is a single atomic CRDT export, so its structure
   *  (parent↔child / cycles / detached) cannot be skewed by the non-atomic fork copy. */
  async buildForkedWorkspace(
    workspaceId: string,
    treeBytes: LoadedDocBytes,
    sink: { docStore: DocStore; snapshotEveryUpdates?: number },
  ): Promise<Workspace> {
    const workspace = new Workspace({ id: workspaceId });
    const blockStore = new ShardedBlockStore({
      treeBytes,
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      capacity: this.shardCacheCapacity,
      docStore: sink.docStore,
      ...(sink.snapshotEveryUpdates !== undefined
        ? { snapshotEveryUpdates: sink.snapshotEveryUpdates }
        : {}),
    });
    const engine = workspace.createEngine({ store: blockStore });
    await blockStore.reconcileDurability();
    // Persist the heal so the next open doesn't re-heal (the heal deltas land in the fork DocStore).
    await blockStore.flushDirty();
    const occ = toJSONOccurrences(engine);
    validateOccurrenceStructure(occ.occurrences, occ.rootOccurrenceIds);
    return workspace;
  }
}
