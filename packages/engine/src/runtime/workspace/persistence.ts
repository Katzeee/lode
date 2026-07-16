import { Workspace, type DocStore, type Engine, type LoadedDocBytes } from "../../core/index.js";
import { ShardedBlockStore, TREE_SUBDOC } from "../../core/store/sharded-store.js";
import { SYS_PREFIX } from "../../core/store/syncable.js";
import type { LoroWriteGuard } from "../../core/store/write-guard.js";
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
  initOutliner(workspace: Workspace, docStore: DocStore, writeGuard?: LoroWriteGuard): Engine {
    const blockStore = new ShardedBlockStore({
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      docStore,
      snapshotEveryUpdates: this.snapshotEveryUpdates,
      capacity: this.shardCacheCapacity,
      writeGuard,
    });
    return workspace.createEngine({ store: blockStore, writeGuard });
  }

  /**
   * Load the workspace's outliner: eagerly load ONLY the tree (the one always-resident doc) and hand
   * the DocStore to the store so shards fault LAZILY on first access — no path here pre-reads every
   * shard (invariant I: memory is O(tree) + O(capacity), independent of content size). The tree's
   * persisted bytes hydrate the store at construction (the pre-exposure raw import). Returns whether a
   * crash-restart reconcile is needed; the reconcile itself (a runtime loro write) is deferred to
   * `reconcileLoaded`, which the caller runs under the workspace's exclusive boundary. Membership +
   * other meta docs live under their own non-`sys:` ids, so they're never mistaken for the tree.
   */
  async loadOutliner(
    docStore: DocStore,
    workspace: Workspace,
    writeGuard?: LoroWriteGuard,
  ): Promise<boolean> {
    const treeBytes = await docStore.load(SYS_PREFIX + TREE_SUBDOC);
    if (treeBytes === null) {
      return false; // nothing persisted (a fresh workspace inits its empty snapshot via initOutliner)
    }
    const blockStore = new ShardedBlockStore({
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      treeBytes,
      docStore,
      snapshotEveryUpdates: this.snapshotEveryUpdates,
      capacity: this.shardCacheCapacity,
      writeGuard,
    });
    workspace.createEngine({ store: blockStore, writeGuard });
    return this.shouldReconcile(docStore);
  }

  /** Post-load crash-restart reconcile: heal tree↔shard orphans a crash left, persist the heal, then
   *  reject anything unhealable. A RUNTIME loro write (the heal) — the caller runs this under the
   *  workspace's exclusive boundary so it is single-entry + the write guard admits it. */
  async reconcileLoaded(engine: Engine): Promise<void> {
    const outliner = engine.asOutliner();
    await outliner.reconcileDurability();
    // Persist the heal (tree edits + swept shards), restoring the residency bound. Without this the
    // heal is lost on the next crash + the pinned shards keep resident beyond capacity (the pin leak).
    await outliner.flushDirty();
    validateSnapshot(await toJSON(engine));
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

  /** Build the forked Workspace: one outliner hydrated from `treeBytes` (the pre-exposure raw import),
   *  lazy over the shard `DocStore` (the runtime adapter for persistent forks, a seeded
   *  `InMemoryDocStore` for in-memory clones). `snapshotEveryUpdates` is omitted for in-memory clones
   *  (no compaction — ephemeral). The reconcile (heal any tree↔shard skew from a concurrent write to
   *  the source) is deferred to `reconcileForked`, which the caller runs under the workspace's
   *  exclusive boundary — a runtime loro write. */
  buildForkedWorkspace(
    workspaceId: string,
    treeBytes: LoadedDocBytes,
    sink: { docStore: DocStore; snapshotEveryUpdates?: number },
    writeGuard?: LoroWriteGuard,
  ): Workspace {
    const workspace = new Workspace({ id: workspaceId });
    const blockStore = new ShardedBlockStore({
      treeBytes,
      ...(this.peerId !== undefined ? { peerId: this.peerId } : {}),
      capacity: this.shardCacheCapacity,
      docStore: sink.docStore,
      ...(sink.snapshotEveryUpdates !== undefined
        ? { snapshotEveryUpdates: sink.snapshotEveryUpdates }
        : {}),
      writeGuard,
    });
    workspace.createEngine({ store: blockStore, writeGuard });
    return workspace;
  }

  /** Post-fork reconcile: heal tree↔shard skew (the source's tree + shard exports are not atomic
   *  w.r.t. a racing writer), persist the heal, then a TREE-ONLY structural check (zero shard reads
   *  beyond reconcile's one walk). A RUNTIME loro write — the caller runs this under the workspace's
   *  exclusive boundary. Entity existence is ensured by reconcile's heal; the treeDoc is a single
   *  atomic CRDT export, so its structure cannot be skewed by the non-atomic fork copy. */
  async reconcileForked(engine: Engine): Promise<void> {
    const outliner = engine.asOutliner();
    await outliner.reconcileDurability();
    // Persist the heal so the next open doesn't re-heal (the heal deltas land in the fork DocStore).
    await outliner.flushDirty();
    const occ = toJSONOccurrences(engine);
    validateOccurrenceStructure(occ.occurrences, occ.rootOccurrenceIds);
  }
}
