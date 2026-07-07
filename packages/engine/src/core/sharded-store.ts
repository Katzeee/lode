/* eslint-disable max-lines -- one internal storage boundary */
import {
  LoroDoc,
  LoroMap,
  LoroText,
  type LoroTree,
  type LoroTreeNode,
  type TreeID,
  VersionVector,
} from "loro-crdt";
import type { SyncableComposite, SyncableDoc, SyncBytes } from "./syncable.js";
import { SYS_PREFIX } from "./syncable.js";
import type { DocStore, LoadedDocBytes } from "./doc-store.js";
import { ShardCache } from "./shard-cache.js";
import { bucketOf, shardIdOf, shardIdOfBucket } from "./sharding.js";
import type { Delta, DeltaInsert, MarkRange, NodeId, OccurrenceId } from "./types.js";

/**
 * The treeDoc's bare internal key. The OUTWARD id (what `SyncableDoc.id` returns, what persistence
 * keys bytes by, what the wire carries) is `SYS_PREFIX + TREE_SUBDOC` = `"sys:tree"`. Exported so the
 * runtime load path (`loadOutliner` reads `sys:tree` eagerly) and the fork copy can name it.
 */
export const TREE_SUBDOC = "tree";

/**
 * The sync/persist surface of a sharded outliner — a `SyncableComposite` (generic sync: docs/heal)
 * plus the structural tree/shards accessors persistence orchestration needs, and the crash-restart
 * lifecycle heal. The single impl is `ShardedBlockStore`; orchestration depends on THIS abstraction
 * (via `Engine.asOutliner()`), not the concrete class — so `ShardedBlockStore`'s ~50 CRUD methods
 * stay out of the orchestration call sites' view.
 */
export type Outliner = SyncableComposite & {
  /** The structure doc — synced first, persisted incrementally. */
  treeSyncDoc(): SyncableDoc;
  /** The content shards — materialized lazily, persisted incrementally (delta + periodic snapshot). */
  shardSyncDocs(): SyncableDoc[];
  /** Crash-restart lifecycle heal (create/delete orphans between tree + shards). Async — the orphan
   *  sweep faults shards through the async cache. */
  reconcileDurability(): Promise<void>;
  /** Persist only the dirty shards (revision > persisted) to the store's DocStore as incremental
   *  updates (`exportUpdate(lastPersistedVersion)`) with periodic snapshot compaction — the same path
   *  the tree uses. Advances each flushed shard's persist cursor + unpins it. No-op for a clean store
   *  or in-memory mode (no DocStore). */
  persistDirtyShards(): Promise<void>;
  /**
   * Pin the operation's working set: fault each shard holding `nodeIds` into the cache + pin it, and
   * arm the residency assertion — any later shard access NOT in this set throws (a dev-aid that
   * catches an operation touching a shard it didn't declare). `release()` ends the session. Async so
   * Phase 5 can fault from the async DocStore port (today the fault is sync from pre-read shardSnaps,
   * so this resolves immediately). nodeIds may include not-yet-created nodes — `shardIdOf` is the hash,
   * not an ownership lookup. Opt-in: outside a session, shard access faults freely (today's behavior).
   */
  ensureResident(nodeIds: readonly NodeId[]): Promise<void>;
  /** End the working-set session: unpin the declared shards, disarm the assertion. Idempotent. */
  release(): void;
};

/** Resident per-shard persistence metadata. Always resident (survives shard LoroDoc eviction) and
 *  local-only (never synced — each replica has its own persist cursor). The single source of truth
 *  for shard dirty-tracking + the incremental-persist delta cursor.
 *
 *  - `revision` bumps on every local write OR remote import — monotonic per shard.
 *  - `persistedRevision` is the revision at the last persist flush. Dirty iff `revision > persistedRevision`.
 *  - `lastPersistedVersion` is the encoded Loro version at the last persist — the `exportUpdate` "from"
 *    cursor so the next persist exports only the delta.
 *  - `pinned` records the write-pin a `shardForWrite` placed on a clean→dirty shard; `persistDirtyShards`
 *    unpins it after flushing. Import-dirty shards are NOT pinned (they may evict; a re-fault reads the
 *    evict-flushed bytes back), so the flag gates the balanced unpin. */
type ShardMeta = {
  revision: number;
  persistedRevision: number;
  lastPersistedVersion?: SyncBytes;
  pinned: boolean;
};

/**
 * Sharded storage: the production outliner store (an `Outliner`). State is split across
 * many LoroDocs so structure and content can load/sync independently.
 *
 *   treeDoc  → occurrenceTree (full structure: nodeId + per-occ props/meta)
 *              + ownership (nodeId → permanent virtual bucket)
 *   shard*   → one content doc per shardId, `entities` map keyed by nodeId
 *              (canonicalOccurrenceId + content + props + meta)
 *
 * The tree doc is the single structural authority; a node's owning shard is derived
 * from the immutable bucket in `ownership`, so it converges with the tree doc and
 * never splits. Shards fault their pre-read snapshot in lazily from `residentBytes`
 * (via `partitionResident`'s shardSnaps). Ported from the verified
 * prototype (`experiments/multi-shard-tree/src/sharded-engine.ts`), adapted to the
 * FULL production data model (entity meta + per-occurrence props/meta).
 *
 * The cascade is NOT here (production keeps it domain-level); this store offers only
 * the low-level `deleteOccurrenceRecord` / `deleteEntity` the domain cascade drives.
 *
 * SYNC/PERSIST SURFACE: the class implements `SyncableComposite`; byte movement (version /
 * export / import / snapshot) lives on the `SyncableDoc`s — the tree via `treeSyncDoc()`, each
 * owned shard via `shardSyncDocs()`. `docs()` is their concatenation (tree first) for the generic
 * sync driver, which iterates without knowing which is the tree. Persistence orchestration that
 * treats the tree specially (incremental) vs shards (snapshots) uses the structural accessors
 * instead of indexing `docs()`.
 */
export class ShardedBlockStore implements Outliner {
  /** The structure CRDT — private; reach it through `treeSyncDoc()` (the opaque `SyncableDoc`).
   *  The raw `LoroDoc` is an impl detail, not part of the public surface. */
  private readonly treeDoc: LoroDoc;
  private readonly occurrenceTree: LoroTree;
  private readonly ownership: LoroMap;
  /** The shard buffer pool — shards fault in here on first access (lazily from the DocStore, or from
   *  `shardSnaps` in in-memory mode), with pin/unpin + LRU eviction + write-back. The runtime passes
   *  a finite capacity so resident LoroDocs are capped; a dirty evicted shard is flushed before drop.
   *  The treeDoc is NOT in the cache — it is always resident (the load-path invariant), owned here. */
  private readonly shardCache: ShardCache<LoroDoc>;
  /** In-memory shard bytes (BARE id → full persisted bytes), used ONLY in in-memory mode (no
   *  DocStore): seeded by clones/tests, and the onEvict write-back target so an evicted shard's
   *  mutation survives a re-fault. Persistent mode leaves this empty — shards fault from the
   *  DocStore and evict back to it (bounded memory). */
  private readonly shardSnaps = new Map<string, LoadedDocBytes>();
  /** Resident per-shard persistence metadata — ALWAYS resident (survives shard LoroDoc eviction),
   *  NOT in the treeDoc (these are local-replica concerns that must not sync to peers). The single
   *  source of truth for "did this shard change?" + the incremental-persist cursor. */
  private readonly shardMeta = new Map<string, ShardMeta>();
  /** Shard count (config readout — not a CRDT handle). Read by tests that clone the sharding. */
  readonly numShards: number;
  /** The active working-set session (null outside `ensureResident`…`release`). When set, `shard()`
   *  asserts every touched shard is in it — the dev-aid that catches an operation reaching beyond its
   *  declared working set. Null during load / heal / sync (no session → fault-in, today's behavior). */
  private residentSession: Set<string> | null = null;
  /**
   * Stable per-dataRoot peer id set on every LoroDoc this store creates. Without it, Loro
   * auto-assigns a fresh random peer per `new LoroDoc()` per process, so every restart
   * fragments the version vector with a new peer and sync can no longer diff cleanly. One
   * stable peerId per dataRoot = one replica site id (design §3/§5). Same value across the
   * treeDoc + all shards is correct: they are independent CRDTs with independent VVs, so a
   * shared local peer id never collides (collision only matters among concurrent editors of
   * the SAME doc, i.e. across replicas, which carry different per-dataRoot peerIds).
   */
  private readonly peerId?: number;
  /** The DocStore port — the lazy fault source AND the write-back target (a dirty shard evicted
   *  before persist is flushed here). Undefined in in-memory mode (tests / ephemeral): shards fault
   *  from `shardSnaps` and evict back to it. The cache's whole reason to exist is lazy load from
   *  this port, so the store owns the reference (core→core; the runtime supplies the adapter). */
  private readonly docStore?: DocStore;
  /** Snapshot-compaction cadence (every N appended updates → writeSnapshot). Passed by the runtime
   *  (persistent mode); Infinity for in-memory (no durable writes). Used by `flushShard`. */
  private readonly snapshotEveryUpdates: number;

  constructor(
    options: {
      numShards?: number;
      /** The tree doc's persisted bytes — eagerly imported (the tree is the ONE always-resident doc,
       *  the load-path invariant). Shards are NOT pre-read; they fault lazily from `docStore`. */
      treeBytes?: LoadedDocBytes;
      /** The DocStore port shards fault from + evict back to (write-back). Omit for in-memory mode:
       *  shards then fault from `shardSnaps` and evict back to it (tests / ephemeral clones). */
      docStore?: DocStore;
      /** In-memory shard bytes seed (BARE shardId → bytes), for clones/tests with no DocStore. Each
       *  entry is the doc's full persisted bytes (snapshot + post-snapshot updates). */
      shardSnaps?: Map<string, LoadedDocBytes>;
      /** Snapshot-compaction cadence for `flushShard` (every N appended updates → writeSnapshot).
       *  Default ∞ (no compaction; in-memory). */
      snapshotEveryUpdates?: number;
      /** Stable peer id for every LoroDoc (see field doc). Omit to let Loro auto-assign. */
      peerId?: number;
      /** Diagnostic/test seam: called each time a shard LoroDoc is materialized. Lets a test assert
       *  an operation (e.g. undo) materializes only the shards it touches. */
      onFault?: (shardId: string) => void;
      /** Max resident shard LoroDocs. Default ∞ (tests/in-memory — no eviction). The runtime passes a
       *  finite bound so the parsed CRDTs (the heavy memory) are capped. */
      capacity?: number;
    } = {},
  ) {
    this.numShards = options.numShards ?? 256;
    this.peerId = options.peerId;
    this.docStore = options.docStore;
    this.snapshotEveryUpdates = options.snapshotEveryUpdates ?? Number.POSITIVE_INFINITY;
    this.treeDoc = new LoroDoc();
    if (this.peerId !== undefined) {
      this.treeDoc.setPeerId(this.peerId);
    }
    const treeBytes = options.treeBytes;
    if (treeBytes) {
      if (treeBytes.snapshot && treeBytes.snapshot.length > 0) {
        this.treeDoc.import(treeBytes.snapshot);
      }
      for (const updateBytes of treeBytes.updates) {
        this.treeDoc.import(updateBytes);
      }
    }
    if (options.shardSnaps) {
      for (const [id, bytes] of options.shardSnaps) {
        this.shardSnaps.set(id, bytes);
      }
    }
    this.shardCache = new ShardCache<LoroDoc>({
      // faultIn: prefer an in-memory shardSnaps entry (a clone seed / an evict-flush in in-memory
      // mode), else read the DocStore lazily (the lazy-load path — no pre-read of every shard).
      faultIn: async (id) => {
        const snapped = this.shardSnaps.get(id);
        if (snapped) {
          return snapped;
        }
        return this.docStore ? await this.docStore.load(SYS_PREFIX + id) : null;
      },
      createDoc: (bytes) => this.createShardDoc(bytes),
      capacity: options.capacity ?? Number.POSITIVE_INFINITY,
      onFault: options.onFault,
      // Write-back: a dirty shard evicted before persist is flushed so its bytes survive; a clean
      // shard (already persisted) is just dropped. In-memory mode (no docStore) snapshots every
      // evict — shardSnaps is the only store, so a re-fault reads it back.
      onEvict: async (id, doc) => {
        if (this.docStore) {
          await this.flushShard(id, doc);
        } else {
          this.shardSnaps.set(id, { snapshot: doc.export({ mode: "snapshot" }), updates: [] });
        }
      },
    });
    this.occurrenceTree = this.treeDoc.getTree("occurrences");
    this.ownership = this.treeDoc.getMap("ownership");
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  commit(): void {
    this.treeDoc.commit();
    for (const [, s] of this.shardCache.residentEntries()) {
      s.commit();
    }
  }

  // ── working-set session (operation boundary) ───────────────────────────────

  async ensureResident(nodeIds: readonly NodeId[]): Promise<void> {
    if (this.residentSession !== null) {
      throw new Error("ensureResident: a working-set session is already active — release it first");
    }
    // shardIdOf is the hash (not an ownership lookup), so this covers not-yet-created nodes too —
    // the exact shard createEntity will write to. Dedupe; fault each in + pin atomically (getAndPin
    // pins BEFORE evictToFit, so a capacity-bound cache full of session-pinned shards can't evict
    // the shard faulted just before its pin). If a later fault throws, unpin the partial set so no
    // pin leaks (the session isn't armed until the whole set is pinned).
    const shardIds = new Set(nodeIds.map((n) => shardIdOf(n, this.numShards)));
    const pinned: string[] = [];
    try {
      for (const id of shardIds) {
        await this.shardCache.getAndPin(id);
        pinned.push(id);
      }
    } catch (err) {
      for (const id of pinned) {
        this.shardCache.unpin(id);
      }
      throw err;
    }
    this.residentSession = shardIds;
  }

  release(): void {
    const session = this.residentSession;
    if (session === null) {
      return; // idempotent — releasing without a session is a no-op
    }
    for (const id of session) {
      this.shardCache.unpin(id);
    }
    this.residentSession = null;
  }

  // ── entity (node content) CRUD — content lives in the owning shard ──────────

  async createEntity(
    nodeId: NodeId,
    canonicalOccurrenceId: OccurrenceId,
    props?: Record<string, unknown>,
  ): Promise<void> {
    if (this.ownership.get(nodeId) !== undefined) {
      throw new Error(`Node already exists: ${nodeId}`);
    }
    // Record immutable ownership (the permanent bucket, not the shardId).
    this.ownership.set(nodeId, bucketOf(nodeId));
    // Entity lives in the shard.
    const entity = (await this.shardForWrite(shardIdOf(nodeId, this.numShards)))
      .getMap("entities")
      .setContainer(nodeId, new LoroMap());
    entity.set("canonicalOccurrenceId", canonicalOccurrenceId);
    entity.setContainer("content", new LoroText());
    const propsMap = entity.setContainer("props", new LoroMap());
    entity.setContainer("meta", new LoroMap());
    for (const [key, value] of Object.entries(props ?? {})) {
      propsMap.set(key, value as never);
    }
  }

  async requireEntity(nodeId: NodeId): Promise<void> {
    await this.entityOf(nodeId);
  }

  async deleteEntity(nodeId: NodeId): Promise<void> {
    // Idempotent if already gone (the domain cascade may call after the occurrence
    // side is already deleted).
    if (this.ownership.get(nodeId) === undefined) {
      return;
    }
    (await this.shardForWrite(this.shardIdOfNode(nodeId))).getMap("entities").delete(nodeId);
    this.ownership.delete(nodeId);
  }

  async setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(nodeId));
    (await this.entityOf(nodeId)).set("canonicalOccurrenceId", occurrenceId);
  }

  async canonicalOccurrenceIdOf(nodeId: NodeId): Promise<OccurrenceId> {
    const id = (await this.entityOf(nodeId)).get("canonicalOccurrenceId");
    if (typeof id !== "string") {
      throw new Error(`Canonical occurrence not found: ${nodeId}`);
    }
    return id;
  }

  // ── occurrence (tree position) CRUD — structure lives in the treeDoc ────────

  createOccurrenceRecord(
    nodeId: NodeId,
    occId: string,
    parentOccurrenceId?: OccurrenceId | null,
    index?: number,
  ): OccurrenceId {
    const parent = parentOccurrenceId == null ? undefined : (parentOccurrenceId as TreeID);
    const node = this.occurrenceTree.createNode(parent, index);
    const occurrenceId = String(node.id);
    node.data.set("nodeId", nodeId);
    node.data.set("occId", occId);
    node.data.setContainer("props", new LoroMap());
    node.data.setContainer("meta", new LoroMap());
    return occurrenceId;
  }

  moveOccurrenceRecord(
    occurrenceId: OccurrenceId,
    parentOccurrenceId: OccurrenceId | null,
    index?: number,
  ): void {
    // Pre-check: LoroTree's cycle check throws a non-recoverable WASM error on a
    // cycle-forming move (caught synchronously but also delivered as an uncaught
    // exception that kills a long-running host). Reject it cleanly first.
    if (parentOccurrenceId != null) {
      let cur = this.treeNodeOf(parentOccurrenceId);
      while (cur) {
        if (String(cur.id) === occurrenceId) {
          throw new Error(`Move would create a cycle: ${occurrenceId} → ${parentOccurrenceId}`);
        }
        cur = cur.parent() ?? null;
      }
    }
    const parent = parentOccurrenceId == null ? undefined : (parentOccurrenceId as TreeID);
    this.occurrenceTree.move(occurrenceId as TreeID, parent, index);
  }

  deleteOccurrenceRecord(occurrenceId: OccurrenceId): void {
    this.occurrenceTree.delete(occurrenceId as TreeID);
  }

  nodeIdOf(occurrenceId: OccurrenceId): NodeId {
    const node = this.treeNodeOf(occurrenceId);
    const nodeId = node?.data.get("nodeId");
    if (typeof nodeId !== "string") {
      throw new Error(`Occurrence not found: ${occurrenceId}`);
    }
    return nodeId;
  }

  occIdOf(occurrenceId: OccurrenceId): string {
    const node = this.treeNodeOf(occurrenceId);
    const occId = node?.data.get("occId");
    if (typeof occId !== "string") {
      throw new Error(`Occurrence not found: ${occurrenceId}`);
    }
    return occId;
  }

  occurrenceExists(occurrenceId: OccurrenceId): boolean {
    return this.treeNodeOf(occurrenceId) != null;
  }

  async getOccurrenceIdsForNode(nodeId: NodeId): Promise<OccurrenceId[]> {
    // `entityOf` is the guard: it throws if the node's content shard is not present.
    // Mid-sync this is reachable when ownership has arrived via the treeDoc but the owning
    // content shard has not been delivered yet (a pending-shard state). This throw is the async
    // gate — real network transport must not surface a node for reading before its shard lands.
    await this.entityOf(nodeId);
    return this.occurrenceTree
      .getNodes({ withDeleted: false })
      .filter((node) => node.data.get("nodeId") === nodeId)
      .map((node) => String(node.id));
  }

  getRootOccurrenceIds(): OccurrenceId[] {
    return this.occurrenceTree.roots().map((node) => String(node.id));
  }

  getParentOccurrenceId(occurrenceId: OccurrenceId): OccurrenceId | null {
    const node = this.treeNodeOf(occurrenceId);
    if (!node) {
      return null;
    }
    const parent = node.parent();
    return parent ? String(parent.id) : null;
  }

  getChildOccurrenceIds(occurrenceId: OccurrenceId): OccurrenceId[] {
    const node = this.treeNodeOf(occurrenceId);
    if (!node) {
      return [];
    }
    return node.children()?.map((child) => String(child.id)) ?? [];
  }

  // ── rich text (resolve nodeId from occurrence, content from shard) ──────────

  async getDeltas(occurrenceId: OccurrenceId): Promise<Delta> {
    const raw = (await this.contentOf(occurrenceId)).toDelta() as Record<string, unknown>[];
    return raw
      .filter(
        (d): d is { insert: string; attributes?: Record<string, unknown> } =>
          typeof d.insert === "string",
      )
      .map((d) => {
        const out: DeltaInsert = { insert: d.insert };
        if (d.attributes && Object.keys(d.attributes).length > 0) {
          out.attributes = d.attributes;
        }
        return out;
      });
  }

  async replaceDeltas(occurrenceId: OccurrenceId, deltas: Delta): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    const text = await this.contentOf(occurrenceId);
    const len = text.length;
    if (len > 0) {
      text.delete(0, len);
    }
    const fullText = deltas.map((d) => d.insert).join("");
    if (fullText.length > 0) {
      text.insert(0, fullText);
    }
    let pos = 0;
    for (const span of deltas) {
      const end = pos + span.insert.length;
      if (span.attributes) {
        for (const [key, value] of Object.entries(span.attributes)) {
          text.mark({ start: pos, end }, key, value);
        }
      }
      pos = end;
    }
  }

  async mark(
    occurrenceId: OccurrenceId,
    range: MarkRange,
    key: string,
    value: unknown,
  ): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.contentOf(occurrenceId)).mark({ start: range.start, end: range.end }, key, value);
  }

  async unmark(occurrenceId: OccurrenceId, range: MarkRange, key: string): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.contentOf(occurrenceId)).unmark({ start: range.start, end: range.end }, key);
  }

  // ── entity props + meta (resolve nodeId from occurrence) ────────────────────

  async getProp(occurrenceId: OccurrenceId, key: string): Promise<unknown> {
    return (await this.propsOf(occurrenceId)).get(key);
  }
  async setProp(occurrenceId: OccurrenceId, key: string, value: unknown): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.propsOf(occurrenceId)).set(key, value as never);
  }
  async unsetProp(occurrenceId: OccurrenceId, key: string): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.propsOf(occurrenceId)).delete(key);
  }
  async setProps(occurrenceId: OccurrenceId, props: Record<string, unknown>): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    const propsMap = await this.propsOf(occurrenceId);
    for (const [key, value] of Object.entries(props)) {
      propsMap.set(key, value as never);
    }
  }
  async getProps(occurrenceId: OccurrenceId): Promise<Record<string, unknown>> {
    return this.mapToRecord(await this.propsOf(occurrenceId));
  }
  async getEntityMeta(occurrenceId: OccurrenceId, key: string): Promise<unknown> {
    return (await this.entityMetaOf(occurrenceId)).get(key);
  }
  async setEntityMeta(occurrenceId: OccurrenceId, key: string, value: unknown): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.entityMetaOf(occurrenceId)).set(key, value as never);
  }
  async unsetEntityMeta(occurrenceId: OccurrenceId, key: string): Promise<void> {
    await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.entityMetaOf(occurrenceId)).delete(key);
  }
  async getEntityMetaRecord(occurrenceId: OccurrenceId): Promise<Record<string, unknown>> {
    return this.mapToRecord(await this.entityMetaOf(occurrenceId));
  }

  // ── occurrence props + meta (on the tree node's `data`) ─────────────────────

  getOccurrenceProp(occurrenceId: OccurrenceId, key: string): unknown {
    return this.occurrencePropsOf(occurrenceId).get(key);
  }
  setOccurrenceProp(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.occurrencePropsOf(occurrenceId).set(key, value as never);
  }
  unsetOccurrenceProp(occurrenceId: OccurrenceId, key: string): void {
    this.occurrencePropsOf(occurrenceId).delete(key);
  }
  getOccurrenceProps(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.mapToRecord(this.occurrencePropsOf(occurrenceId));
  }
  getOccurrenceMeta(occurrenceId: OccurrenceId, key: string): unknown {
    return this.occurrenceMetaOf(occurrenceId).get(key);
  }
  setOccurrenceMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.occurrenceMetaOf(occurrenceId).set(key, value as never);
  }
  unsetOccurrenceMeta(occurrenceId: OccurrenceId, key: string): void {
    this.occurrenceMetaOf(occurrenceId).delete(key);
  }
  getOccurrenceMetaRecord(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.mapToRecord(this.occurrenceMetaOf(occurrenceId));
  }

  // ── SyncableComposite ────────────────────────────────────────────────────────

  /** The structure doc — the single structural authority (carries ownership, so it reveals which
   *  shards exist). Persisted incrementally; synced first. */
  treeSyncDoc(): SyncableDoc {
    // The tree is always resident — its getDoc resolves immediately (no fault). Still a Promise so
    // the SyncableDoc method shape is uniform with shard docs (no dual sync/async path).
    return this.syncableDoc(() => Promise.resolve(this.treeDoc), TREE_SUBDOC);
  }

  /** The content shards — one per owned shard id, materialized lazily. Persisted incrementally. */
  shardSyncDocs(): SyncableDoc[] {
    return this.shardIds().map((id) => this.shardSyncableDoc(id));
  }

  /** The per-doc sync surface: tree first, then every owned shard. Each entry is an independent
   *  CRDT; the sync engine diffs opaque versions and exchanges updates per id, re-reading `docs()`
   *  after each exchange so shards revealed by the tree sync are picked up. Generic sync iterates
   *  this; callers that need the tree or shards specifically use `treeSyncDoc()` / `shardSyncDocs()`. */
  docs(): SyncableDoc[] {
    return [this.treeSyncDoc(), ...this.shardSyncDocs()];
  }

  /** Push fast-path: the tree (always materialized) + already-materialized shards only — a shard
   *  never touched locally has no local ops to push, so don't force-load every owned shard on each
   *  push (preserves lazy shard load between restart and the first full sync round). */
  pushDocs(): SyncableDoc[] {
    return [
      this.treeSyncDoc(),
      ...this.shardCache.residentEntries().map(([id]) => this.shardSyncableDoc(id)),
    ];
  }

  /** Post-exchange sync heal — delegates to the ownership-based orphan sweep. */
  async heal(): Promise<void> {
    await this.sweepOrphans();
  }

  async persistDirtyShards(): Promise<void> {
    if (this.docStore === undefined) {
      return; // in-memory mode: no durable sink (shards evict to shardSnaps instead)
    }
    // Only dirty shards (revision > persistedRevision) — a clean store faults nothing. Iterating the
    // resident meta map (not shardSyncDocs) avoids faulting clean shards just to skip them.
    for (const [shardId, meta] of this.shardMeta) {
      if (meta.revision === meta.persistedRevision) {
        continue;
      }
      // Resident if write-pinned; else re-faults from the DocStore (evict-flush kept it current).
      const doc = await this.shardForRead(shardId);
      await this.flushShard(shardId, doc);
      if (meta.pinned) {
        this.shardCache.unpin(shardId);
        meta.pinned = false;
      }
    }
    // Reclaim now-evictable shards so resident stays ≤ capacity at the quiescent point (unpinning
    // alone doesn't evict — eviction fires on the next fault otherwise).
    await this.shardCache.evictToFit();
  }

  /** Flush one shard's delta to the DocStore + advance its persist cursor. Shared by
   *  `persistDirtyShards` (the explicit post-mutation flush) and `onEvict` (write-back before
   *  dropping a dirty shard). No-op if the shard is clean. `doc` is the shard's current LoroDoc
   *  (passed in so the evict path need not re-fault). */
  private async flushShard(shardId: string, doc: LoroDoc): Promise<void> {
    if (this.docStore === undefined) {
      return;
    }
    const meta = this.metaFor(shardId);
    if (meta.revision === meta.persistedRevision) {
      return; // clean — the DocStore already has its state
    }
    const outwardId = SYS_PREFIX + shardId;
    const currentVersion = doc.version().encode();
    const delta =
      meta.lastPersistedVersion === undefined
        ? doc.export({ mode: "update" })
        : doc.export({ mode: "update", from: VersionVector.decode(meta.lastPersistedVersion) });
    if (delta.length > 0) {
      const seq = await this.docStore.appendUpdate(outwardId, delta);
      if (seq % this.snapshotEveryUpdates === 0) {
        await this.docStore.writeSnapshot(outwardId, doc.export({ mode: "snapshot" }));
      }
    }
    meta.lastPersistedVersion = currentVersion;
    meta.persistedRevision = meta.revision;
  }

  /** A shard's SyncableDoc: re-resolves the LoroDoc per access (eviction-safe). `importUpdate`
   *  pins around the fault+import — a capacity-bound cache full of pinned-dirty shards would
   *  otherwise evict a cold imported shard between fault and the bytes landing, silently dropping
   *  the import on an orphaned doc. */
  private shardSyncableDoc(id: string): SyncableDoc {
    const base = this.syncableDoc(() => this.shardForRead(id), id);
    return {
      ...base,
      importUpdate: async (bytes) => {
        await this.shardCache.getAndPin(id);
        try {
          (await this.shardForRead(id)).import(bytes);
          this.markImport(id);
        } finally {
          this.shardCache.unpin(id);
        }
      },
    };
  }

  private syncableDoc(getDoc: () => Promise<LoroDoc>, id: string): SyncableDoc {
    // The VV ↔ bytes round-trip is internal to this loro-backed adapter; callers see SyncBytes. The
    // outward id carries the structure prefix; the internal map keys stay bare (`s{k}`).
    //
    // `getDoc` RE-RESOLVES the LoroDoc on each access (not a captured reference) so the doc is
    // eviction-safe: a shard evicted between sync accesses re-faults from shardSnaps (which an
    // evict-flush keeps current). The tree uses `() => Promise.resolve(this.treeDoc)` (always
    // resident); shards override `importUpdate` to pin around the import (see shardSyncableDoc).
    return {
      id: SYS_PREFIX + id,
      version: async () => (await getDoc()).version().encode(),
      exportUpdate: async (from) =>
        (await getDoc()).export(
          from ? { mode: "update", from: VersionVector.decode(from) } : { mode: "update" },
        ),
      exportSnapshot: async () => (await getDoc()).export({ mode: "snapshot" }),
      importUpdate: async (bytes) => {
        (await getDoc()).import(bytes);
      },
    };
  }

  /** Get (lazily creating) a shard's raw `LoroDoc` by id. INTERNAL/test-seam — production reaches
   *  shards through the `SyncableDoc`s from `docs()`. Exposed for the durability unit test, which
   *  inspects shard entity maps to verify `reconcileDurability` / `sweepOrphans` directly. */
  async getShardDoc(shardId: string): Promise<LoroDoc> {
    return this.shardForRead(shardId);
  }

  /** Number of shard LoroDocs currently resident (diagnostic — the buffer-pool bound check). */
  get residentShardCount(): number {
    return this.shardCache.size;
  }

  /** Every shard id referenced by the ownership map. */
  shardIds(): string[] {
    const out = new Set<string>();
    for (const [, bucketRaw] of this.ownership.entries()) {
      if (typeof bucketRaw === "number") {
        out.add(shardIdOfBucket(bucketRaw, this.numShards));
      }
    }
    return [...out];
  }

  /** Per-shard revision (the change marker), keyed by OUTWARD SyncableDoc id. The tree is absent
   *  (no revision → the sync driver always exchanges it). Drives incremental sync: a round skips
   *  shards whose revision hasn't advanced since the last exchange AND whose peer version is unchanged. */
  revisions(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [shardId, meta] of this.shardMeta) {
      out.set(SYS_PREFIX + shardId, meta.revision);
    }
    return out;
  }

  /**
   * Crash recovery: reconcile treeDoc ↔ shards after a non-atomic restart. The tree
   * doc and each shard are independent LoroDocs (persisted separately in Step 5), so
   * a crash between their writes leaves two kinds of incompleteness:
   *   CREATE-direction: occurrence + ownership present, shard entity absent.
   *   DELETE-direction: shard entity present, ownership already gone.
   * Run to a fixpoint; deterministic given tree-doc + shard state.
   */
  async reconcileDurability(): Promise<void> {
    for (let iter = 0; iter < 100; iter++) {
      let changed = false;
      // CREATE-direction: drop live occurrences pointing at a missing entity.
      const occsToDrop: TreeID[] = [];
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string" && !(await this.entityPresent(nid))) {
          occsToDrop.push(node.id);
        }
      }
      for (const id of occsToDrop) {
        this.occurrenceTree.delete(id);
        changed = true;
      }
      // Ownership with neither a live occurrence nor an entity: crashed-create residue.
      const liveOccNodeIds = new Set<NodeId>();
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string") {
          liveOccNodeIds.add(nid);
        }
      }
      for (const nid of [...(this.ownership.keys() as string[])]) {
        if (!liveOccNodeIds.has(nid) && !(await this.entityPresent(nid))) {
          this.ownership.delete(nid);
          changed = true;
        }
      }
      // DELETE-direction: orphan shard entities whose ownership is gone. Streaming — fault each shard
      // one at a time under the normal capacity (empty shards fault null + evict; a shard with an
      // orphan deletion is marked dirty so onEvict/persist preserves it). Gated to non-clean restart,
      // so this full scan only runs after a crash.
      for (let i = 0; i < this.numShards; i++) {
        const shardId = `s${i}`;
        const ents = (await this.shardForRead(shardId)).getMap("entities");
        const stale: NodeId[] = [];
        for (const [nid] of ents.entries()) {
          if (typeof nid === "string" && this.ownership.get(nid) === undefined) {
            stale.push(nid);
          }
        }
        for (const nid of stale) {
          ents.delete(nid);
          changed = true;
        }
        if (stale.length > 0) {
          // Mark the shard dirty so the orphan deletion persists (else it reappears on reload).
          await this.shardForWrite(shardId);
        }
      }
      if (!changed) {
        break;
      }
    }
    this.treeDoc.commit();
    for (const [, s] of this.shardCache.residentEntries()) {
      s.commit();
    }
  }

  /**
   * Sync heal (ownership-based). After exchanging treeDoc + shards, a live occurrence may
   * reference a node whose ownership was hard-deleted on another replica (a ref to X created
   * concurrently with X's deletion); such orphan occurrences are swept, and the entity +
   * ownership of any node left with no live occurrence are dropped. Ownership-based on purpose:
   * an occurrence whose shard is merely PENDING (ownership present, entity not yet delivered)
   * is NOT swept, so partial delivery self-heals when the shard arrives. (No-resurrection
   * rests on the CRDT permanence of `ownership.delete`, not on a tombstone — the tombstone
   * machinery was removed once verified not to carry correctness.) This is distinct from
   * `reconcileDurability` (entity-based, crash-restart healing) which must NOT run mid-sync.
   * Deterministic given tree-doc state, so every replica that exchanges the same bytes
   * converges identically.
   */
  async sweepOrphans(): Promise<void> {
    for (let iter = 0; iter < 100; iter++) {
      let changed = false;
      const occToRemove: TreeID[] = [];
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string" && this.ownership.get(nid) === undefined) {
          occToRemove.push(node.id);
        }
      }
      for (const id of occToRemove) {
        this.occurrenceTree.delete(id);
        changed = true;
      }
      const liveOccNodeIds = new Set<NodeId>();
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string") {
          liveOccNodeIds.add(nid);
        }
      }
      for (const nid of [...(this.ownership.keys() as string[])]) {
        if (!liveOccNodeIds.has(nid)) {
          const shardId = this.shardIdOfNode(nid);
          (await this.shardForRead(shardId)).getMap("entities").delete(nid);
          await this.shardForWrite(shardId); // mark dirty so the orphan deletion persists
          this.ownership.delete(nid);
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }
    this.treeDoc.commit();
    for (const [, s] of this.shardCache.residentEntries()) {
      s.commit();
    }
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /** Fault a shard for READ: working-set session check + cache get. No dirty marking. */
  private async shardForRead(shardId: string): Promise<LoroDoc> {
    if (this.residentSession !== null && !this.residentSession.has(shardId)) {
      throw new Error(
        `Shard "${shardId}" touched outside its declared working set — ensureResident must cover every node the operation touches (undeclared operation boundary).`,
      );
    }
    const doc = await this.shardCache.get(shardId);
    return doc;
  }

  /** Fault a shard for WRITE, atomically pinning it on the clean→dirty transition so it stays
   *  resident until `persistDirtyShards` flushes + unpins. The atomic fault+pin (via `getAndPin`) is
   *  load-bearing: a capacity-bound cache full of pinned-dirty shards would otherwise evict a
   *  newly-faulted write target the moment it faults. Bumps revision (the dirty marker). On an
   *  already-dirty shard this is a cache hit (no fault, no extra pin). */
  private async shardForWrite(shardId: string): Promise<LoroDoc> {
    const meta = this.metaFor(shardId);
    const firstDirty = meta.revision === meta.persistedRevision && !meta.pinned;
    const doc = firstDirty
      ? await this.shardCache.getAndPin(shardId)
      : await this.shardForRead(shardId);
    if (firstDirty) {
      meta.pinned = true;
    }
    meta.revision++;
    return doc;
  }

  private metaFor(shardId: string): ShardMeta {
    let m = this.shardMeta.get(shardId);
    if (m === undefined) {
      m = { revision: 0, persistedRevision: 0, pinned: false };
      this.shardMeta.set(shardId, m);
    }
    return m;
  }

  /** Mark a shard dirty after a remote import (bump revision only — no pin: an import-only shard may
   *  evict between sync rounds, re-faulting from the evict-flushed bytes). Persisted on the next
   *  local-edit-triggered flush. */
  private markImport(shardId: string): void {
    this.metaFor(shardId).revision++;
  }

  /** Build a fresh shard LoroDoc (peerId + text styles + entities container), replaying `bytes`
   *  (snapshot + post-snapshot updates) if present. The cache's `createDoc` factory — Loro-specific,
   *  so it lives here (not in the generic ShardCache, which imports no CRDT backend). */
  private createShardDoc(bytes: LoadedDocBytes | null): LoroDoc {
    const s = new LoroDoc();
    if (this.peerId !== undefined) {
      s.setPeerId(this.peerId);
    }
    s.configTextStyle({ bold: { expand: "after" }, italic: { expand: "after" } });
    s.getMap("entities"); // ensure container exists
    if (bytes) {
      if (bytes.snapshot && bytes.snapshot.length > 0) {
        s.import(bytes.snapshot);
      }
      for (const updateBytes of bytes.updates) {
        s.import(updateBytes);
      }
    }
    return s;
  }

  private shardIdOfNode(nodeId: NodeId): string {
    const bucket = this.ownership.get(nodeId);
    if (typeof bucket !== "number") {
      throw new Error(`Node entity not found: ${nodeId}`);
    }
    return shardIdOfBucket(bucket, this.numShards);
  }

  private async entityOf(nodeId: NodeId): Promise<LoroMap> {
    const entity = await this.entityInShard(nodeId, this.shardIdOfNode(nodeId));
    if (!(entity instanceof LoroMap)) {
      throw new Error(`Node entity not found: ${nodeId}`);
    }
    return entity;
  }

  private async entityInShard(nodeId: NodeId, shardId: string): Promise<LoroMap | null> {
    const entity = (await this.shardForRead(shardId)).getMap("entities").get(nodeId);
    return entity instanceof LoroMap ? entity : null;
  }

  /** True iff the node's entity currently exists in its owning shard. */
  private async entityPresent(nodeId: NodeId): Promise<boolean> {
    const bucket = this.ownership.get(nodeId);
    if (typeof bucket !== "number") {
      return false;
    }
    return (await this.entityInShard(nodeId, shardIdOfBucket(bucket, this.numShards))) !== null;
  }

  private async contentOf(occurrenceId: OccurrenceId): Promise<LoroText> {
    const nodeId = this.nodeIdOf(occurrenceId);
    const text = (await this.entityOf(nodeId)).get("content");
    if (!(text instanceof LoroText)) {
      throw new Error(`Node content not found: ${nodeId}`);
    }
    return text;
  }

  private async propsOf(occurrenceId: OccurrenceId): Promise<LoroMap> {
    const nodeId = this.nodeIdOf(occurrenceId);
    const props = (await this.entityOf(nodeId)).get("props");
    if (!(props instanceof LoroMap)) {
      throw new Error(`Node entity props not found: ${nodeId}`);
    }
    const narrowed = props as unknown as LoroMap;
    return narrowed;
  }

  private async entityMetaOf(occurrenceId: OccurrenceId): Promise<LoroMap> {
    const nodeId = this.nodeIdOf(occurrenceId);
    const meta = (await this.entityOf(nodeId)).get("meta");
    if (!(meta instanceof LoroMap)) {
      throw new Error(`Node entity meta not found: ${nodeId}`);
    }
    const narrowed = meta as unknown as LoroMap;
    return narrowed;
  }

  private occurrencePropsOf(occurrenceId: OccurrenceId): LoroMap {
    const node = this.treeNodeOf(occurrenceId);
    const props = node?.data.get("props");
    if (!(props instanceof LoroMap)) {
      throw new Error(`Occurrence props not found: ${occurrenceId}`);
    }
    const narrowed = props as unknown as LoroMap;
    return narrowed;
  }

  private occurrenceMetaOf(occurrenceId: OccurrenceId): LoroMap {
    const node = this.treeNodeOf(occurrenceId);
    const meta = node?.data.get("meta");
    if (!(meta instanceof LoroMap)) {
      throw new Error(`Occurrence meta not found: ${occurrenceId}`);
    }
    const narrowed = meta as unknown as LoroMap;
    return narrowed;
  }

  private treeNodeOf(occurrenceId: OccurrenceId): LoroTreeNode | null {
    // `occurrenceId` is always the STRING form of a Loro TreeID (callers carry strings across
    // the engine/RPC/snapshot boundary). Keep it that way: Loro's getNodeByID returns undefined
    // for a missing STRING id but PANICS (loro-common unwrap-on-None → WASM RuntimeError) for a
    // missing TreeID OBJECT. A missing id is a legitimate runtime state (stale client ref,
    // concurrent delete) and is handled by the `!node` check below — but only because we pass a
    // string. Don't refactor this to construct a real TreeID object.
    const node = this.occurrenceTree.getNodeByID(occurrenceId as TreeID);
    if (!node || node.isDeleted()) {
      return null;
    }
    return node;
  }

  private mapToRecord(map: LoroMap): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of map.entries()) {
      out[key] = value;
    }
    return out;
  }
}
