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
import type { SyncableComposite, SyncableDoc } from "./syncable.js";
import { SYS_PREFIX } from "./syncable.js";
import type { LoadedDocBytes } from "./doc-store.js";
import { bucketOf, shardIdOf, shardIdOfBucket } from "./sharding.js";
import type { Delta, DeltaInsert, MarkRange, NodeId, OccurrenceId } from "./types.js";

/**
 * The treeDoc's bare internal key. The OUTWARD id (what `SyncableDoc.id` returns, what persistence
 * keys bytes by, what the wire carries) is `SYS_PREFIX + TREE_SUBDOC` = `"sys:tree"`. The load path
 * no longer references this constant: `ShardedBlockStore` takes a `residentBytes` map and
 * `partitionResident` identifies the tree by its outward id internally. File-exported only so the
 * partition (and the rare benchmark that builds a map from a raw snapshot) can name it — it is NOT
 * in the public `core` API and production orchestration never references it.
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
  /** The content shards — persisted as snapshots, materialized lazily. */
  shardSyncDocs(): SyncableDoc[];
  /** Crash-restart lifecycle heal (create/delete orphans between tree + shards). */
  reconcileDurability(): void;
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
  private readonly shards = new Map<string, LoroDoc>();
  /** Pre-read shard snapshots keyed by their BARE internal id (`s{k}`), seeded by `partitionResident`
   *  from the residentBytes map. A shard faults its snapshot in on first access; absent → empty. */
  private readonly shardSnaps = new Map<string, Uint8Array>();
  /** Shard count (config readout — not a CRDT handle). Read by tests that clone the sharding. */
  readonly numShards: number;
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

  constructor(
    options: {
      numShards?: number;
      /** Pre-read persisted docs (tree + shards), keyed by their OUTWARD SyncableDoc id (the
       *  `sys:`-prefixed form). `partitionResident` splits them — the single place that parses the
       *  structure prefix. Omit for a fresh empty outliner. */
      residentBytes?: Map<string, LoadedDocBytes>;
      /** Stable peer id for every LoroDoc (see field doc). Omit to let Loro auto-assign. */
      peerId?: number;
    } = {},
  ) {
    this.numShards = options.numShards ?? 256;
    this.peerId = options.peerId;
    this.treeDoc = new LoroDoc();
    if (this.peerId !== undefined) {
      this.treeDoc.setPeerId(this.peerId);
    }
    const { treeBytes, shardSnaps } = partitionResident(options.residentBytes);
    if (treeBytes) {
      if (treeBytes.snapshot && treeBytes.snapshot.length > 0) {
        this.treeDoc.import(treeBytes.snapshot);
      }
      for (const updateBytes of treeBytes.updates) {
        this.treeDoc.import(updateBytes);
      }
    }
    for (const [id, snap] of shardSnaps) {
      this.shardSnaps.set(id, snap);
    }
    this.occurrenceTree = this.treeDoc.getTree("occurrences");
    this.ownership = this.treeDoc.getMap("ownership");
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  commit(): void {
    this.treeDoc.commit();
    for (const s of this.shards.values()) {
      s.commit();
    }
  }

  // ── entity (node content) CRUD — content lives in the owning shard ──────────

  createEntity(
    nodeId: NodeId,
    canonicalOccurrenceId: OccurrenceId,
    props?: Record<string, unknown>,
  ): void {
    if (this.ownership.get(nodeId) !== undefined) {
      throw new Error(`Node already exists: ${nodeId}`);
    }
    // Record immutable ownership (the permanent bucket, not the shardId).
    this.ownership.set(nodeId, bucketOf(nodeId));
    // Entity lives in the shard.
    const entity = this.shard(shardIdOf(nodeId, this.numShards))
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

  requireEntity(nodeId: NodeId): void {
    this.entityOf(nodeId);
  }

  deleteEntity(nodeId: NodeId): void {
    // Idempotent if already gone (the domain cascade may call after the occurrence
    // side is already deleted).
    if (this.ownership.get(nodeId) === undefined) {
      return;
    }
    this.shard(this.shardIdOfNode(nodeId)).getMap("entities").delete(nodeId);
    this.ownership.delete(nodeId);
  }

  setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): void {
    this.entityOf(nodeId).set("canonicalOccurrenceId", occurrenceId);
  }

  canonicalOccurrenceIdOf(nodeId: NodeId): OccurrenceId {
    const id = this.entityOf(nodeId).get("canonicalOccurrenceId");
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

  getOccurrenceIdsForNode(nodeId: NodeId): OccurrenceId[] {
    // `entityOf` is the guard: it throws if the node's content shard is not present.
    // Mid-sync this is reachable when ownership has arrived via the treeDoc but the owning
    // content shard has not been delivered yet (a pending-shard state). Sync is synchronous
    // today so reads never interleave a half-delivered node; this throw is the Phase-D async
    // gate — real network transport must not surface a node for reading before its shard lands.
    this.entityOf(nodeId);
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

  getDeltas(occurrenceId: OccurrenceId): Delta {
    const raw = this.contentOf(occurrenceId).toDelta() as Record<string, unknown>[];
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

  replaceDeltas(occurrenceId: OccurrenceId, deltas: Delta): void {
    const text = this.contentOf(occurrenceId);
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

  mark(occurrenceId: OccurrenceId, range: MarkRange, key: string, value: unknown): void {
    this.contentOf(occurrenceId).mark({ start: range.start, end: range.end }, key, value);
  }

  unmark(occurrenceId: OccurrenceId, range: MarkRange, key: string): void {
    this.contentOf(occurrenceId).unmark({ start: range.start, end: range.end }, key);
  }

  // ── entity props + meta (resolve nodeId from occurrence) ────────────────────

  getProp(occurrenceId: OccurrenceId, key: string): unknown {
    return this.propsOf(occurrenceId).get(key);
  }
  setProp(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.propsOf(occurrenceId).set(key, value as never);
  }
  unsetProp(occurrenceId: OccurrenceId, key: string): void {
    this.propsOf(occurrenceId).delete(key);
  }
  setProps(occurrenceId: OccurrenceId, props: Record<string, unknown>): void {
    const propsMap = this.propsOf(occurrenceId);
    for (const [key, value] of Object.entries(props)) {
      propsMap.set(key, value as never);
    }
  }
  getProps(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.mapToRecord(this.propsOf(occurrenceId));
  }
  getEntityMeta(occurrenceId: OccurrenceId, key: string): unknown {
    return this.entityMetaOf(occurrenceId).get(key);
  }
  setEntityMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.entityMetaOf(occurrenceId).set(key, value as never);
  }
  unsetEntityMeta(occurrenceId: OccurrenceId, key: string): void {
    this.entityMetaOf(occurrenceId).delete(key);
  }
  getEntityMetaRecord(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.mapToRecord(this.entityMetaOf(occurrenceId));
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
    return this.syncableDoc(this.treeDoc, TREE_SUBDOC);
  }

  /** The content shards — one per owned shard id, materialized lazily. Persisted as snapshots. */
  shardSyncDocs(): SyncableDoc[] {
    return this.shardIds().map((id) => this.syncableDoc(this.shard(id), id));
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
      ...[...this.shards.entries()].map(([id, doc]) => this.syncableDoc(doc, id)),
    ];
  }

  /** Post-exchange sync heal — delegates to the ownership-based orphan sweep. */
  heal(): void {
    this.sweepOrphans();
  }

  private syncableDoc(doc: LoroDoc, id: string): SyncableDoc {
    // The VV ↔ bytes round-trip is internal to this loro-backed adapter; callers see SyncBytes. The
    // outward id carries the structure prefix; the internal map keys stay bare (`s{k}`).
    return {
      id: SYS_PREFIX + id,
      version: () => doc.version().encode(),
      exportUpdate: (from) =>
        doc.export(
          from ? { mode: "update", from: VersionVector.decode(from) } : { mode: "update" },
        ),
      exportSnapshot: () => doc.export({ mode: "snapshot" }),
      importUpdate: (bytes) => {
        doc.import(bytes);
      },
    };
  }

  /** Get (lazily creating) a shard's raw `LoroDoc` by id. INTERNAL/test-seam — production reaches
   *  shards through the `SyncableDoc`s from `docs()`. Exposed for the durability unit test, which
   *  inspects shard entity maps to verify `reconcileDurability` / `sweepOrphans` directly. */
  getShardDoc(shardId: string): LoroDoc {
    return this.shard(shardId);
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

  /**
   * Crash recovery: reconcile treeDoc ↔ shards after a non-atomic restart. The tree
   * doc and each shard are independent LoroDocs (persisted separately in Step 5), so
   * a crash between their writes leaves two kinds of incompleteness:
   *   CREATE-direction: occurrence + ownership present, shard entity absent.
   *   DELETE-direction: shard entity present, ownership already gone.
   * Run to a fixpoint; deterministic given tree-doc + shard state.
   */
  reconcileDurability(): void {
    for (let iter = 0; iter < 100; iter++) {
      let changed = false;
      // CREATE-direction: drop live occurrences pointing at a missing entity.
      const occsToDrop: TreeID[] = [];
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string" && !this.entityPresent(nid)) {
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
        if (!liveOccNodeIds.has(nid) && !this.entityPresent(nid)) {
          this.ownership.delete(nid);
          changed = true;
        }
      }
      // DELETE-direction: orphan shard entities whose ownership is gone (scan every shard).
      for (let i = 0; i < this.numShards; i++) {
        const ents = this.shard(`s${i}`).getMap("entities");
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
      }
      if (!changed) {
        break;
      }
    }
    this.treeDoc.commit();
    for (const s of this.shards.values()) {
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
  sweepOrphans(): void {
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
          this.shard(this.shardIdOfNode(nid)).getMap("entities").delete(nid);
          this.ownership.delete(nid);
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }
    this.treeDoc.commit();
    for (const s of this.shards.values()) {
      s.commit();
    }
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private shard(shardId: string): LoroDoc {
    let s = this.shards.get(shardId);
    if (!s) {
      s = new LoroDoc();
      if (this.peerId !== undefined) {
        s.setPeerId(this.peerId);
      }
      s.configTextStyle({
        bold: { expand: "after" },
        italic: { expand: "after" },
      });
      s.getMap("entities"); // ensure container exists
      const bytes = this.shardSnaps.get(shardId);
      if (bytes && bytes.length > 0) {
        s.import(bytes);
      }
      this.shards.set(shardId, s);
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

  private entityOf(nodeId: NodeId): LoroMap {
    const entity = this.entityInShard(nodeId, this.shardIdOfNode(nodeId));
    if (!(entity instanceof LoroMap)) {
      throw new Error(`Node entity not found: ${nodeId}`);
    }
    return entity;
  }

  private entityInShard(nodeId: NodeId, shardId: string): LoroMap | null {
    const entity = this.shard(shardId).getMap("entities").get(nodeId);
    return entity instanceof LoroMap ? entity : null;
  }

  /** True iff the node's entity currently exists in its owning shard. */
  private entityPresent(nodeId: NodeId): boolean {
    const bucket = this.ownership.get(nodeId);
    return (
      typeof bucket === "number" &&
      this.entityInShard(nodeId, shardIdOfBucket(bucket, this.numShards)) !== null
    );
  }

  private contentOf(occurrenceId: OccurrenceId): LoroText {
    const nodeId = this.nodeIdOf(occurrenceId);
    const text = this.entityOf(nodeId).get("content");
    if (!(text instanceof LoroText)) {
      throw new Error(`Node content not found: ${nodeId}`);
    }
    return text;
  }

  private propsOf(occurrenceId: OccurrenceId): LoroMap {
    const nodeId = this.nodeIdOf(occurrenceId);
    const props = this.entityOf(nodeId).get("props");
    if (!(props instanceof LoroMap)) {
      throw new Error(`Node entity props not found: ${nodeId}`);
    }
    const narrowed = props as unknown as LoroMap;
    return narrowed;
  }

  private entityMetaOf(occurrenceId: OccurrenceId): LoroMap {
    const nodeId = this.nodeIdOf(occurrenceId);
    const meta = this.entityOf(nodeId).get("meta");
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

/**
 * Partition pre-read resident docs into the tree's bytes + bare-keyed shard snapshots. This is the
 * SINGLE place that parses the `sys:` structure prefix:
 *   - the entry whose outward id is `SYS_PREFIX + TREE_SUBDOC` (`"sys:tree"`) → the tree;
 *   - every other `sys:`-prefixed entry (`sys:s{k}`) → a shard, keyed internally by its BARE id
 *     (the prefix stripped);
 *   - non-`sys:` entries (a meta doc like `"membership"`) → NOT structure, ignored.
 *
 * Ids stay opaque everywhere else — equality-matched, never parsed. Centralizing the strip here is
 * the namespace-discipline payoff: the load path loads all docs and hands them over without knowing
 * which is the tree, and a meta doc persisted alongside structure (membership folding into the same
 * table) is naturally excluded without hardcoding its name.
 */
export function partitionResident(residentBytes: Map<string, LoadedDocBytes> | undefined): {
  treeBytes: LoadedDocBytes | null;
  shardSnaps: Map<string, Uint8Array>;
} {
  const shardSnaps = new Map<string, Uint8Array>();
  let treeBytes: LoadedDocBytes | null = null;
  if (residentBytes) {
    for (const [id, bytes] of residentBytes) {
      if (id === SYS_PREFIX + TREE_SUBDOC) {
        treeBytes = bytes;
      } else if (id.startsWith(SYS_PREFIX)) {
        const snapshot = bytes.snapshot;
        if (snapshot) {
          shardSnaps.set(id.slice(SYS_PREFIX.length), snapshot);
        }
      }
    }
  }
  return { treeBytes, shardSnaps };
}
