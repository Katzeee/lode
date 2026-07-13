/* eslint-disable max-lines -- full CRUD (~40 methods) + Outliner/sync surface over a sharded
   LoroDoc tree. Heal algorithms live in sharded-heal.ts. */
import {
  LoroDoc,
  LoroMap,
  LoroText,
  type LoroTree,
  type LoroTreeNode,
  type TreeID,
  VersionVector,
} from "loro-crdt";
import type { SyncableComposite, SyncableDoc } from "./syncable.js";
import { NotFoundError } from "../../errors/index.js";
import { SYS_PREFIX } from "./syncable.js";
import type { DocStore, LoadedDocBytes } from "./doc-store.js";
import { InMemoryDocStore } from "./in-memory-doc-store.js";
import { LruShardCache, type ShardCache } from "./shard-cache.js";
import { ShardPersister } from "./shard-persister.js";
import { bucketOf, shardIdOf, shardIdOfBucket } from "./sharding.js";
import { runReconcileDurability, runSweepOrphans, type HealContext } from "./sharded-heal.js";
import type { Delta, DeltaInsert, MarkRange, NodeId, OccurrenceId } from "../types.js";

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
  /** Flush every change since the last call to the DocStore: the tree (always — its `exportUpdate`
   *  cursor IS its dirty check) plus every dirty shard (revision > the persister's persisted cursor),
   *  each as an incremental delta with periodic snapshot compaction. Advances each flushed doc's
   *  cursor, and reclaims evictable shards so resident ≤ capacity. The
   *  single "persist what changed" entry point — local mutations, sync rounds, and lifecycle heal all
   *  route through it. In-memory mode flushes into the injected `InMemoryDocStore` (same path). */
  flushDirty(): Promise<void>;
  /**
   * Pin the operation's working set: fault each shard holding `nodeIds` into the cache + pin it, and
   * arm the residency assertion — any later shard access NOT in this set throws (a dev-aid that
   * catches an operation touching a shard it didn't declare). `release()` ends the session. Async so
   * the fault can read from the async DocStore port. nodeIds may include not-yet-created nodes —
   * `shardIdOf` is the hash, not an ownership lookup. Opt-in: outside a session, shard access faults
   * freely (today's behavior).
   */
  ensureResident(nodeIds: readonly NodeId[]): Promise<void>;
  /** End the working-set session: unpin the declared shards, disarm the assertion. Idempotent. */
  release(): void;
};

/** Resident per-shard dirty-tracking state. Always resident (survives shard LoroDoc eviction) and
 *  local-only (never synced). The persist CURSORS (`lastPersistedVersion` + `persistedRevision`) live
 *  on the `ShardPersister` — this holds only the dirty marker the write/import path mutates
 *  synchronously:
 *
 *  - `revision` bumps on every local write OR remote import (via `markDirty`, the single inlet) — the
 *    monotonic dirty marker. Dirty iff `revision > persister.persistedRevisionOf(id)` (the persister's
 *    record of the last-flushed revision).
 *
 *  No pin here. Pinning is the OPERATION working set's concern (`ensureResident`); a dirty shard not
 *  in a session is freely evictable — `onEvict` flushes it through the persister first (the universal
 *  durability safety net), so a write never needs to hold the shard resident itself. */
type ShardMeta = {
  revision: number;
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
 * never splits. Shards fault their bytes in lazily from the `DocStore` (the runtime
 * adapter in persistent mode, an `InMemoryDocStore` in tests / ephemeral clones).
 * Ported from the verified prototype (`experiments/multi-shard-tree/src/sharded-engine.ts`),
 * adapted to the FULL production data model (entity meta + per-occurrence props/meta).
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
  /** The shard buffer pool — shards fault in here on first access (lazily from the `DocStore`),
   *  with pin/unpin + LRU eviction + write-back. The runtime passes
   *  a finite capacity so resident LoroDocs are capped; a dirty evicted shard is flushed before drop.
   *  The treeDoc is NOT in the cache — it is always resident (the load-path invariant), owned here. */
  private readonly shardCache: ShardCache<LoroDoc>;
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
   *  before persist is flushed here). ALWAYS present: persistent mode injects the runtime adapter
   *  (sqlite today); in-memory mode injects an `InMemoryDocStore` (tests / ephemeral clones). The
   *  store never branches on "is there a sink?" — that distinction lives in which impl is injected. */
  private readonly docStore: DocStore;
  /** Snapshot-compaction cadence (every N appended updates → writeSnapshot). Default ∞ (no
   *  compaction; the in-memory default). Forwarded to the persister. */
  private readonly snapshotEveryUpdates: number;
  /** The persistence-strategy seam — owns the per-doc persist cursors (`lastPersistedVersion` +
   *  `persistedRevision`) and flushes a doc's incremental delta to the DocStore. CRDT-agnostic.
   *  Always present (a `docStore` always is); in-memory mode flushes into the `InMemoryDocStore`. */
  private readonly persister: ShardPersister;

  constructor(
    options: {
      numShards?: number;
      /** The tree doc's persisted bytes — eagerly imported (the tree is the ONE always-resident doc,
       *  the load-path invariant). Shards are NOT pre-read; they fault lazily from `docStore`. */
      treeBytes?: LoadedDocBytes;
      /** The DocStore port shards fault from + evict back to (write-back). Default: an
       *  `InMemoryDocStore` (tests / ephemeral clones) — so the store always has exactly one byte
       *  owner. The runtime injects its persistence adapter for persistent mode. Keyed by OUTWARD
       *  SyncableDoc id (`sys:s{k}`), same as the persister writes. */
      docStore?: DocStore;
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
      /** Inject a custom shard cache (test seam). Default: a capacity-bounded `LruShardCache` over
       *  this store's fault/create/evict closures. The field type is the `ShardCache` interface, so a
       *  test double satisfies it; production uses the LRU impl. */
      shardCache?: ShardCache<LoroDoc>;
    } = {},
  ) {
    this.numShards = options.numShards ?? 256;
    this.peerId = options.peerId;
    this.docStore = options.docStore ?? new InMemoryDocStore();
    this.snapshotEveryUpdates = options.snapshotEveryUpdates ?? Number.POSITIVE_INFINITY;
    this.persister = new ShardPersister({
      docStore: this.docStore,
      snapshotEveryUpdates: this.snapshotEveryUpdates,
    });
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
    // Seed the tree's persist cursor to its current (just-imported, or fresh-empty) state. The tree is
    // the one always-resident doc loaded eagerly from persistence, so its version is known here; without
    // seeding, the first post-(re)start flushDirty would re-export the entire tree oplog instead of the
    // delta. Shards need no seeding — they fault lazily and seed their cursor on first flush.
    this.persister.seedCursor(SYS_PREFIX + TREE_SUBDOC, this.treeDoc.version().encode());
    this.shardCache =
      options.shardCache ??
      new LruShardCache<LoroDoc>({
        // faultIn: read the DocStore lazily (the lazy-load path — no pre-read of every shard). The
        // InMemoryDocStore default serves an in-memory clone's seeded shards the same way the runtime
        // adapter serves a persistent replica's.
        faultIn: async (id) => this.docStore.load(SYS_PREFIX + id),
        createDoc: (bytes) => this.createShardDoc(bytes),
        capacity: options.capacity ?? Number.POSITIVE_INFINITY,
        onFault: options.onFault,
        // Write-back: a dirty shard evicted before persist is flushed through the persister so its
        // bytes survive AND its cursor advances (a later flushDirty then sees it clean — no re-fault);
        // a clean shard flushes an empty delta (no write). The doc is wrapped in a transient SyncableDoc
        // (resolve to the in-hand LoroDoc) so the persister stays CRDT-agnostic; its id (sys:s{k})
        // matches the shard's normal flush id, so they share a cursor.
        onEvict: async (id, doc) => {
          await this.persister.flushDoc(
            this.syncableDoc(() => Promise.resolve(doc), id),
            this.metaFor(id).revision,
          );
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
    const doc = await this.shardForWrite(this.shardIdOfNode(nodeId));
    (await this.entityOf(nodeId, doc)).set("canonicalOccurrenceId", occurrenceId);
  }

  async canonicalOccurrenceIdOf(nodeId: NodeId): Promise<OccurrenceId> {
    const id = (await this.entityOf(nodeId)).get("canonicalOccurrenceId");
    if (typeof id !== "string") {
      throw new NotFoundError("canonical", nodeId);
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
      throw new NotFoundError("occurrence", occurrenceId);
    }
    return nodeId;
  }

  occIdOf(occurrenceId: OccurrenceId): string {
    const node = this.treeNodeOf(occurrenceId);
    const occId = node?.data.get("occId");
    if (typeof occId !== "string") {
      throw new NotFoundError("occurrence", occurrenceId);
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
    const doc = await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    const text = await this.contentOf(occurrenceId, doc);
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
    const doc = await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.contentOf(occurrenceId, doc)).mark(
      { start: range.start, end: range.end },
      key,
      value,
    );
  }

  async unmark(occurrenceId: OccurrenceId, range: MarkRange, key: string): Promise<void> {
    const doc = await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.contentOf(occurrenceId, doc)).unmark({ start: range.start, end: range.end }, key);
  }

  // ── entity props + meta (resolve nodeId from occurrence) ────────────────────

  async getProp(occurrenceId: OccurrenceId, key: string): Promise<unknown> {
    return (await this.propsOf(occurrenceId)).get(key);
  }
  async setProp(occurrenceId: OccurrenceId, key: string, value: unknown): Promise<void> {
    const doc = await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.propsOf(occurrenceId, doc)).set(key, value as never);
  }
  async unsetProp(occurrenceId: OccurrenceId, key: string): Promise<void> {
    const doc = await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.propsOf(occurrenceId, doc)).delete(key);
  }
  async setProps(occurrenceId: OccurrenceId, props: Record<string, unknown>): Promise<void> {
    const doc = await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    const propsMap = await this.propsOf(occurrenceId, doc);
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
    const doc = await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.entityMetaOf(occurrenceId, doc)).set(key, value as never);
  }
  async unsetEntityMeta(occurrenceId: OccurrenceId, key: string): Promise<void> {
    const doc = await this.shardForWrite(this.shardIdOfNode(this.nodeIdOf(occurrenceId)));
    (await this.entityMetaOf(occurrenceId, doc)).delete(key);
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

  /** Post-exchange sync heal — delegates to `runSweepOrphans` (sharded-heal.ts). */
  async heal(): Promise<void> {
    await runSweepOrphans(this.healContext());
  }

  async flushDirty(): Promise<void> {
    // Tree: always-resident, so always flushed. Its `exportUpdate` cursor IS the dirty check — an
    // unchanged tree yields an empty delta (no write), and always-flush can never miss a dirty path
    // (the failure mode a per-method revision counter would risk if a bump site were forgotten). The
    // tree passes no revision: it isn't gated, so it tracks a cursor but no persistedRevision.
    await this.persister.flushDoc(this.treeSyncDoc());
    // Shards: revision-gated — a clean shard is skipped WITHOUT faulting it. Iterating the resident
    // meta map (not shardSyncDocs) avoids faulting clean shards just to skip them; the persister owns
    // the persistedRevision cursor so the gate stays out of the store.
    for (const [shardId, meta] of this.shardMeta) {
      if (meta.revision <= this.persister.persistedRevisionOf(SYS_PREFIX + shardId)) {
        continue;
      }
      // Resident, or re-faults from the DocStore (an evict-flush kept it current AND advanced its
      // cursor, so a dirty-then-evicted shard reads clean here — no re-fault, no double flush).
      await this.persister.flushDoc(this.shardSyncableDoc(shardId), meta.revision);
    }
    // Reclaim now-evictable shards so resident stays ≤ capacity at the quiescent point. Writes no
    // longer pin (durability is onEvict's job), so a dirty shard left resident by a write burst is
    // evictable here without any unpinning.
    await this.shardCache.evictToFit();
  }

  /** A shard's SyncableDoc: re-resolves the LoroDoc per access (eviction-safe). Sync's shard access
   *  is SESSION-EXEMPT: it faults via `shardCache.get` directly, NOT `shardForRead`, so it is not gated
   *  by a concurrent operation's `ensureResident` working-set session. Sync (push/import) is not an
   *  operation — the push fast-path can fire while a mutation's session is armed, and it legitimately
   *  exports resident shards beyond that one operation's declared set. `importUpdate` is fault + import
   *  + markDirty — no pin: a dirty imported shard is freely evictable (onEvict flushes it), and the
   *  import is a sync call on an already-resolved doc, so there is no eviction window between fault
   *  and the bytes landing. */
  private shardSyncableDoc(id: string): SyncableDoc {
    const sessionExemptGet = () => this.shardCache.get(id);
    const base = this.syncableDoc(sessionExemptGet, id);
    return {
      ...base,
      importUpdate: async (bytes) => {
        (await sessionExemptGet()).import(bytes);
        this.markDirty(id);
      },
    };
  }

  private syncableDoc(getDoc: () => Promise<LoroDoc>, id: string): SyncableDoc {
    // The VV ↔ bytes round-trip is internal to this loro-backed adapter; callers see SyncBytes. The
    // outward id carries the structure prefix; the internal map keys stay bare (`s{k}`).
    //
    // `getDoc` RE-RESOLVES the LoroDoc on each access (not a captured reference) so the doc is
    // eviction-safe: a shard evicted between sync accesses re-faults from the DocStore (which an
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

  // ── heal (delegates to sharded-heal.ts — the algorithms live there) ─────────

  /** Crash-restart heal: reconcile treeDoc ↔ shards after a non-atomic restart. Algorithm in
   *  `runReconcileDurability` (sharded-heal.ts); this binds the store's heal-relevant surface. */
  async reconcileDurability(): Promise<void> {
    await runReconcileDurability(this.healContext());
  }

  /** The store's heal-relevant surface, handed to the sharded-heal algorithms as bound closures so
   *  the heal functions stay standalone (TS can't split a class across files). */
  private healContext(): HealContext {
    return {
      numShards: this.numShards,
      occurrenceTree: this.occurrenceTree,
      ownership: this.ownership,
      shardCache: this.shardCache,
      treeDoc: this.treeDoc,
      // RAW (shardCache.get + markDirty) — NOT the gated shardForRead/Write. Heal is infra, not an
      // operation, so it must not trip a concurrent operation's working-set session gate. The gated
      // accessors stay CRUD-only; this is the structural closure that keeps infra off the gate.
      fault: (id) => this.shardCache.get(id),
      touch: (id) => {
        this.markDirty(id);
        return this.shardCache.get(id);
      },
      entityPresent: (nid) => this.entityPresent(nid),
      shardIdOfNode: (nid) => this.shardIdOfNode(nid),
    };
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

  /** Fault a shard for WRITE: mark it dirty (the single dirty-mark inlet) + fault for read. No pin —
   *  a write does not need to hold the shard resident; if it is evicted before `flushDirty`, `onEvict`
   *  flushes the dirty bytes through the persister (the durability safety net). The working-set pin
   *  (`ensureResident`) is what holds a shard resident across an operation, not the write. */
  private async shardForWrite(shardId: string): Promise<LoroDoc> {
    this.markDirty(shardId);
    return this.shardForRead(shardId);
  }

  private metaFor(shardId: string): ShardMeta {
    let m = this.shardMeta.get(shardId);
    if (m === undefined) {
      m = { revision: 0 };
      this.shardMeta.set(shardId, m);
    }
    return m;
  }

  /** The single dirty-mark inlet — bumps revision (the monotonic dirty marker) for a local write OR
   *  a remote import. Dirty iff `revision > persister.persistedRevisionOf(id)`. Persisted on the next
   *  `flushDirty` (or on eviction via `onEvict`, whichever comes first). */
  private markDirty(shardId: string): void {
    this.metaFor(shardId).revision++;
  }

  /** Build a fresh shard LoroDoc (peerId + text styles + entities container), replaying `bytes`
   *  (snapshot + post-snapshot updates) if present. The cache's `createDoc` factory — Loro-specific,
   *  so it stays with the store (ShardCache is kept backend-agnostic). */
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
      throw new NotFoundError("entity", nodeId);
    }
    return shardIdOfBucket(bucket, this.numShards);
  }

  private async entityOf(nodeId: NodeId, doc?: LoroDoc): Promise<LoroMap> {
    const entity =
      doc !== undefined
        ? doc.getMap("entities").get(nodeId)
        : await this.entityInShard(nodeId, this.shardIdOfNode(nodeId));
    if (!(entity instanceof LoroMap)) {
      throw new NotFoundError("entity", nodeId);
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

  private async contentOf(occurrenceId: OccurrenceId, doc?: LoroDoc): Promise<LoroText> {
    const nodeId = this.nodeIdOf(occurrenceId);
    const text = (await this.entityOf(nodeId, doc)).get("content");
    if (!(text instanceof LoroText)) {
      throw new NotFoundError("content", nodeId);
    }
    return text;
  }

  private async propsOf(occurrenceId: OccurrenceId, doc?: LoroDoc): Promise<LoroMap> {
    const nodeId = this.nodeIdOf(occurrenceId);
    const props = (await this.entityOf(nodeId, doc)).get("props");
    if (!(props instanceof LoroMap)) {
      throw new NotFoundError("props", nodeId);
    }
    return props;
  }

  private async entityMetaOf(occurrenceId: OccurrenceId, doc?: LoroDoc): Promise<LoroMap> {
    const nodeId = this.nodeIdOf(occurrenceId);
    const meta = (await this.entityOf(nodeId, doc)).get("meta");
    if (!(meta instanceof LoroMap)) {
      throw new NotFoundError("meta", nodeId);
    }
    return meta;
  }

  private occurrencePropsOf(occurrenceId: OccurrenceId): LoroMap {
    const node = this.treeNodeOf(occurrenceId);
    const props = node?.data.get("props");
    if (!(props instanceof LoroMap)) {
      throw new NotFoundError("props", occurrenceId);
    }
    // `.data.get()` yields LoroMap<any>; narrow the generic to the declared return type.
    return props as LoroMap<Record<string, unknown>>;
  }

  private occurrenceMetaOf(occurrenceId: OccurrenceId): LoroMap {
    const node = this.treeNodeOf(occurrenceId);
    const meta = node?.data.get("meta");
    if (!(meta instanceof LoroMap)) {
      throw new NotFoundError("meta", occurrenceId);
    }
    return meta as LoroMap<Record<string, unknown>>;
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
