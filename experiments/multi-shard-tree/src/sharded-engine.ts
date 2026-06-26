import {
  LoroDoc,
  LoroMap,
  LoroText,
  type LoroTree,
  type LoroTreeNode,
  type TreeID,
} from "loro-crdt";
import { validateSnapshot } from "./invariant.js";
import type {
  NodeId,
  NodeView,
  OccurrenceId,
  OccurrenceView,
  OutlineApi,
  TreeSnapshot,
} from "./types.js";

/**
 * The engine under test. Exposes the SAME single-tree OutlineApi as the oracle,
 * but internally splits state across many LoroDocs:
 *
 *   treeDoc  → occurrenceTree (full structure) + ownership map (nodeId→shardId,
 *              immutable per node) + tombstones (hard-deleted nodeIds, for GC).
 *   shard*   → one content doc per shardId, each holding an `entities` map
 *              keyed by nodeId (text/props/canonicalOccurrenceId).
 *
 * Sharding is transparent: the caller never sees shardIds. Shards are loaded
 * lazily on demand (created when first touched). The tree doc is the single
 * structural authority; entity location is derived from the immutable ownership
 * map, so it converges with the tree doc and never splits.
 *
 * For a given nodeId the owning shard is a deterministic hash of the nodeId, so
 * every replica assigns the same node to the same shard.
 */
export class ShardedEngine implements OutlineApi {
  readonly treeDoc: LoroDoc;
  private readonly occurrenceTree: LoroTree;
  private readonly ownership: LoroMap;
  private readonly tombstones: LoroMap;
  private readonly shards = new Map<string, LoroDoc>();
  readonly numShards: number;
  /** Optional lazy loader: returns persisted shard bytes on first access. */
  readonly shardLoader?: (shardId: string) => Uint8Array | null;
  /** Local sync-round counter (drives tombstone GC grace; not a synced value). */
  private round = 0;
  /** Local: the round this replica first observed each tombstone (for GC grace). */
  private readonly tombstoneRound = new Map<string, number>();

  constructor(
    numShards = 4,
    initialTreeBytes?: Uint8Array,
    shardLoader?: (shardId: string) => Uint8Array | null,
  ) {
    this.numShards = numShards;
    this.shardLoader = shardLoader;
    this.treeDoc = new LoroDoc();
    if (initialTreeBytes && initialTreeBytes.length > 0) {
      this.treeDoc.import(initialTreeBytes);
    }
    this.occurrenceTree = this.treeDoc.getTree("occurrences");
    this.ownership = this.treeDoc.getMap("ownership");
    this.tombstones = this.treeDoc.getMap("tombstones");
  }

  createNode(
    nodeId: NodeId,
    parent: OccurrenceId | null,
    index?: number,
    text?: string,
  ): OccurrenceId {
    if (this.ownership.get(nodeId) !== undefined) {
      throw new Error(`Node already exists: ${nodeId}`);
    }
    const shardId = shardIdOf(nodeId, this.numShards);

    // Creating a node means it is alive. Clear any stale tombstone left by a
    // prior hard-delete (an undo resurrecting this nodeId, or an explicit
    // re-create) so the GC record never contradicts a live node. This is the
    // undo↔GC contract: undo of a delete re-creates the node via createNode,
    // which clears the tombstone the delete had set.
    if (this.tombstones.get(nodeId) !== undefined) this.tombstones.delete(nodeId);
    this.tombstoneRound.delete(nodeId);

    // Structure first (tree doc is the authority).
    const parentTreeId = parent == null ? undefined : (parent as TreeID);
    const occNode = this.occurrenceTree.createNode(parentTreeId, index);
    const occurrenceId = String(occNode.id);
    occNode.data.set("nodeId", nodeId);
    occNode.data.setContainer("meta", new LoroMap()); // per-occurrence meta (treeDoc)

    // Record immutable ownership so any replica can locate the content. Store the
    // PERMANENT bucket (not the shardId): the bucket never changes, so a future
    // numShards change only regroups buckets → shard docs, never re-hashes nodes.
    this.ownership.set(nodeId, bucketOf(nodeId));

    // Content lives in the shard.
    const shard = this.shard(shardId);
    const entity = shard.getMap("entities").setContainer(nodeId, new LoroMap());
    entity.set("canonicalOccurrenceId", occurrenceId);
    const content = entity.setContainer("content", new LoroText());
    entity.setContainer("props", new LoroMap());
    if (text) content.insert(0, text);
    return occurrenceId;
  }

  createReference(targetNodeId: NodeId, parent: OccurrenceId | null, index?: number): OccurrenceId {
    this.requireEntity(targetNodeId); // loads the owning shard, proves the node exists
    const parentTreeId = parent == null ? undefined : (parent as TreeID);
    const occNode = this.occurrenceTree.createNode(parentTreeId, index);
    occNode.data.set("nodeId", targetNodeId);
    occNode.data.setContainer("meta", new LoroMap()); // per-occurrence meta (treeDoc)
    return String(occNode.id);
  }

  moveOccurrence(occ: OccurrenceId, parent: OccurrenceId | null, index?: number): void {
    // Pre-check: LoroTree's cycle check throws a non-recoverable WASM error on a
    // cycle-forming move (caught synchronously but also delivered as an uncaught
    // exception that kills a long-running host). Reject it cleanly first.
    if (parent != null) {
      let cur = this.liveTreeNodeOf(parent);
      while (cur) {
        if (String(cur.id) === occ)
          throw new Error(`Move would create a cycle: ${occ} → ${parent}`);
        cur = cur.parent();
      }
    }
    this.occurrenceTree.move(occ as TreeID, parent == null ? undefined : (parent as TreeID), index);
  }

  setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): void {
    if (this.nodeIdOf(occurrenceId) !== nodeId) {
      throw new Error(`Occurrence ${occurrenceId} does not belong to node ${nodeId}`);
    }
    // canonical lives on the entity (in the owning shard); the tree doc is unchanged.
    this.requireEntity(nodeId).set("canonicalOccurrenceId", occurrenceId);
    this.shard(this.shardIdOfNode(nodeId)).commit();
  }

  removeOccurrence(occ: OccurrenceId): void {
    if (!this.liveTreeNodeOf(occ)) return;
    const nodeId = this.nodeIdOf(occ);
    if (occ === this.canonicalOccurrenceIdOf(nodeId)) {
      this.hardDeleteNode(nodeId);
      return;
    }
    // Drop this occurrence and its physical subtree, hard-deleting any node
    // whose canonical is nested in it.
    this.cascadeRemove([occ]);
  }

  hardDeleteNode(nodeId: NodeId): void {
    if (!this.existsNode(nodeId)) return;
    this.cascadeRemove(this.occurrenceIdsOf(nodeId));
  }

  /**
   * Worklist cascade (see SingleDocEngine.cascadeRemove). Entity deletion targets
   * the owning shard and records a tombstone in the tree doc for cross-replica
   * GC coordination.
   */
  private cascadeRemove(seed: OccurrenceId[]): void {
    const removed = new Set<OccurrenceId>();
    const work = [...seed];
    while (work.length > 0) {
      const o = work.pop()!;
      if (removed.has(o) || !this.liveTreeNodeOf(o)) continue;
      removed.add(o);
      const nid = this.nodeIdOf(o);
      for (const c of this.physicalChildIds(o)) work.push(c);
      if (o === this.canonicalOccurrenceIdOf(nid)) {
        for (const occ of this.occurrenceIdsOf(nid)) work.push(occ);
      }
    }
    const deletedNodes = new Set<NodeId>();
    for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
      const nid = node.data.get("nodeId");
      if (typeof nid === "string" && removed.has(this.canonicalOccurrenceIdOf(nid))) {
        deletedNodes.add(nid);
      }
    }
    for (const nid of deletedNodes) {
      const shardId = this.shardIdOfNode(nid);
      this.shard(shardId).getMap("entities").delete(nid);
      this.ownership.delete(nid);
      this.tombstone(nid);
    }
    for (const o of removed) this.occurrenceTree.delete(o as TreeID);
  }

  private physicalChildIds(occ: OccurrenceId): OccurrenceId[] {
    const node = this.liveTreeNodeOf(occ);
    return (node?.children() ?? []).map((c) => String(c.id));
  }

  private occurrenceIdsOf(nodeId: NodeId): OccurrenceId[] {
    return this.occurrenceTree
      .getNodes({ withDeleted: false })
      .filter((n) => n.data.get("nodeId") === nodeId)
      .map((n) => String(n.id));
  }

  setText(nodeId: NodeId, text: string): void {
    const content = this.contentOf(nodeId);
    const len = content.length;
    if (len > 0) content.delete(0, len);
    if (text.length > 0) content.insert(0, text);
  }

  setEntityProp(nodeId: NodeId, key: string, value: unknown): void {
    this.propsOf(nodeId).set(key, value as never);
  }

  contentDelta(nodeId: NodeId): unknown[] {
    return this.contentOf(nodeId).toDelta() as unknown[];
  }

  applyContentDelta(nodeId: NodeId, delta: unknown[]): void {
    const content = this.contentOf(nodeId);
    // Replace: delete the whole current content, then replay the target's
    // insert ops (with their marks). curLen uses the same unit the delta's
    // insert strings use (JS string length); ASCII-safe, noted for multibyte.
    const curLen = content.toString().length;
    const inserts = (delta as Array<Record<string, unknown>>).filter(
      (d) => typeof d.insert === "string",
    );
    content.applyDelta([{ delete: curLen }, ...inserts] as never);
  }

  markText(nodeId: NodeId, start: number, end: number, key: string, value: unknown): void {
    this.contentOf(nodeId).mark({ start, end }, key, value as never);
  }

  insertText(nodeId: NodeId, pos: number, str: string): void {
    this.contentOf(nodeId).insert(pos, str);
  }

  setOccurrenceMeta(occ: OccurrenceId, key: string, value: unknown): void {
    this.occurrenceMetaOf(occ).set(key, value as never);
    this.treeDoc.commit();
  }

  getOccurrenceMeta(occ: OccurrenceId, key: string): unknown {
    return this.occurrenceMetaOf(occ).get(key);
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  snapshot(): TreeSnapshot {
    const occurrences: Record<OccurrenceId, OccurrenceView> = {};
    const occurrencesByNode = new Map<NodeId, OccurrenceId[]>();

    for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
      const occId = String(node.id);
      const nodeId = node.data.get("nodeId");
      if (typeof nodeId !== "string") {
        throw new Error(`Occurrence ${occId} missing nodeId`);
      }
      const list = occurrencesByNode.get(nodeId) ?? [];
      list.push(occId);
      occurrencesByNode.set(nodeId, list);
      const metaMap = node.data.get("meta");
      occurrences[occId] = {
        occurrenceId: occId,
        nodeId,
        parentOccurrenceId: node.parent() ? String(node.parent()!.id) : null,
        childOccurrenceIds: (node.children() ?? []).map((c) => String(c.id)),
        meta: metaMap instanceof LoroMap ? this.mapToRecord(metaMap as unknown as LoroMap) : {},
      };
    }

    const nodes: Record<NodeId, NodeView> = {};
    for (const [nodeId, bucketRaw] of this.ownership.entries()) {
      const shardId =
        typeof bucketRaw === "number" ? shardIdOfBucket(bucketRaw, this.numShards) : "";
      const entity = this.entityInShard(nodeId, shardId);
      if (!entity) continue;
      const canonical = entity.get("canonicalOccurrenceId");
      const occs = occurrencesByNode.get(nodeId) ?? [];
      nodes[nodeId] = {
        nodeId,
        text: this.readText(entity),
        delta: this.readDelta(entity),
        props: this.mapToRecord(this.propsContainerOf(entity)),
        canonicalOccurrenceId: typeof canonical === "string" ? canonical : "",
        occurrences: occs,
      };
    }

    const roots = this.occurrenceTree.roots().map((n) => String(n.id));
    return { nodes, occurrences, roots };
  }

  liveNodeIds(): NodeId[] {
    const out: NodeId[] = [];
    for (const k of this.ownership.keys()) out.push(k);
    return out;
  }

  existsNode(nodeId: NodeId): boolean {
    return this.ownership.get(nodeId) !== undefined;
  }

  existsOccurrence(occ: OccurrenceId): boolean {
    return this.liveTreeNodeOf(occ) != null;
  }

  /** All docs that participate in sync (tree doc + every shard). */
  syncDocs(): LoroDoc[] {
    return [this.treeDoc, ...this.shards.values()];
  }

  /** Get (lazily creating) a shard doc by id. Used by the sync simulator. */
  getShardDoc(shardId: string): LoroDoc {
    return this.shard(shardId);
  }

  /** Every shard id referenced by the ownership map (the set of content docs). */
  shardIds(): string[] {
    const out = new Set<string>();
    for (const [, bucketRaw] of this.ownership.entries()) {
      if (typeof bucketRaw === "number") out.add(shardIdOfBucket(bucketRaw, this.numShards));
    }
    return [...out];
  }

  /**
   * GC: reconcile structure to the converged tree doc. After sync, a live
   * occurrence may reference a node that was hard-deleted on another replica
   * (e.g. a reference to X created concurrently with X's deletion). Such orphan
   * occurrences, and entities left with no live occurrence, are swept to a
   * fixpoint so invariants hold. Deterministic given the tree-doc state, so
   * every replica sweeps identically and stays converged.
   */
  sweepTombstones(): void {
    for (let iter = 0; iter < 100; iter++) {
      let changed = false;
      const occToRemove: TreeID[] = [];
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string" && !this.existsNode(nid)) occToRemove.push(node.id);
      }
      for (const id of occToRemove) {
        this.occurrenceTree.delete(id);
        changed = true;
      }
      const liveOccNodeIds = new Set<NodeId>();
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string") liveOccNodeIds.add(nid);
      }
      const orphanNodes: NodeId[] = [];
      for (const nid of this.ownership.keys()) {
        if (!liveOccNodeIds.has(nid)) orphanNodes.push(nid);
      }
      for (const nid of orphanNodes) {
        const shardId = this.shardIdOfNode(nid);
        this.shard(shardId).getMap("entities").delete(nid);
        this.ownership.delete(nid);
        this.tombstone(nid);
        changed = true;
      }
      if (!changed) break;
    }
    this.treeDoc.commit();
  }

  /**
   * Crash recovery: reconcile tree-doc authority ↔ shard contents after a
   * non-atomic restart. Because the tree doc and each shard are independent
   * LoroDocs (persisted/synced separately), a crash between their writes leaves
   * two kinds of incompleteness that `sweepTombstones` does not cover:
   *
   *   CREATE-direction: a live occurrence whose entity was never written to its
   *     shard (ownership present, shard entity absent). The node never truly
   *     existed — drop the occurrence, then the now-orphan ownership entry. No
   *     tombstone: there is no converged state to resurrect against.
   *   DELETE-direction: a shard entity whose ownership is already gone (a
   *     hard-delete — or a delete synced in via the tree doc — took the
   *     authority side but the shard entity survived). Delete the orphan entity;
   *     the tree doc already declared the node gone.
   *
   * Run to a fixpoint (a cascade can orphan further nodes), then commit. Like
   * `sweepTombstones`, it is a deterministic function of tree-doc + shard state,
   * so every replica that reconciles the same bytes reaches the same state.
   */
  reconcileDurability(): void {
    for (let iter = 0; iter < 100; iter++) {
      let changed = false;

      // CREATE-direction: drop live occurrences pointing at a missing entity.
      const occsToDrop: TreeID[] = [];
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string" && !this.entityPresent(nid)) occsToDrop.push(node.id);
      }
      for (const id of occsToDrop) {
        this.occurrenceTree.delete(id);
        changed = true;
      }

      // Ownership entries left with neither a live occurrence nor an entity:
      // the residue of a crashed create. Safe to drop (never-real node).
      const liveOccNodeIds = new Set<NodeId>();
      for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
        const nid = node.data.get("nodeId");
        if (typeof nid === "string") liveOccNodeIds.add(nid);
      }
      for (const nid of [...this.ownership.keys()]) {
        if (!liveOccNodeIds.has(nid) && !this.entityPresent(nid)) {
          this.ownership.delete(nid);
          changed = true;
        }
      }

      // DELETE-direction: orphan shard entities whose ownership is gone. Scan
      // EVERY shard (not just loaded ones): an orphan in a never-touched shard
      // is never read on the hot path, but recovery must still clean it, and
      // scanning only `this.shards` would miss it.
      for (let i = 0; i < this.numShards; i++) {
        const ents = this.shard(`s${i}`).getMap("entities");
        const stale: NodeId[] = [];
        for (const [nid] of ents.entries()) {
          if (typeof nid === "string" && this.ownership.get(nid) === undefined) stale.push(nid);
        }
        for (const nid of stale) {
          ents.delete(nid);
          changed = true;
        }
      }

      if (!changed) break;
    }
    this.treeDoc.commit();
    for (const s of this.shards.values()) s.commit();
  }

  /**
   * Advance this replica's local sync-round counter. Drives tombstone GC grace.
   * Call once per sync round (or per logical time tick); not a synced value.
   */
  advanceRound(): void {
    this.round++;
  }

  /**
   * Drop tombstones whose local age ≥ `grace` rounds. A tombstone prevents a
   * lagging replica from resurrecting a deleted node; once `grace` rounds have
   * passed with no resurrection, it is safe to drop. `grace` must exceed the
   * worst-case sync partition. Purely a local GC decision; the tombstone delete
   * syncs like any other op. Keeps tombstone growth bounded over long histories.
   */
  pruneTombstones(grace: number): void {
    const drop: NodeId[] = [];
    for (const nid of [...this.tombstones.keys()]) {
      const seen = this.tombstoneRound.get(nid) ?? this.round; // first local observation
      if (seen === this.round) this.tombstoneRound.set(nid, seen);
      if (this.round - seen >= grace) drop.push(nid);
    }
    for (const nid of drop) {
      this.tombstones.delete(nid);
      this.tombstoneRound.delete(nid);
    }
    this.treeDoc.commit();
  }

  /** Record a tombstone for a hard-deleted node + its local birth round. */
  private tombstone(nid: NodeId): void {
    this.tombstones.set(nid, true as never);
    if (!this.tombstoneRound.has(nid)) this.tombstoneRound.set(nid, this.round);
  }

  // ── correctness ─────────────────────────────────────────────────────────────

  validateInvariants(): void {
    validateSnapshot(this.snapshot());
  }

  commit(): void {
    this.treeDoc.commit();
    for (const s of this.shards.values()) s.commit();
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private shard(shardId: string): LoroDoc {
    let s = this.shards.get(shardId);
    if (!s) {
      s = new LoroDoc();
      s.configTextStyle({ bold: { expand: "after" }, italic: { expand: "after" } });
      s.getMap("entities"); // ensure container exists
      if (this.shardLoader) {
        const bytes = this.shardLoader(shardId);
        if (bytes && bytes.length > 0) s.import(bytes);
      }
      this.shards.set(shardId, s);
    }
    return s;
  }

  private shardIdOfNode(nodeId: NodeId): string {
    const bucket = this.ownership.get(nodeId);
    if (typeof bucket !== "number") throw new Error(`No shard for node: ${nodeId}`);
    return shardIdOfBucket(bucket, this.numShards);
  }

  private requireEntity(nodeId: NodeId): LoroMap {
    const shardId = this.shardIdOfNode(nodeId);
    const entity = this.entityInShard(nodeId, shardId);
    if (!entity) throw new Error(`Node entity not found: ${nodeId}`);
    return entity;
  }

  private entityInShard(nodeId: NodeId, shardId: string): LoroMap | null {
    if (!shardId) return null;
    const entity = this.shard(shardId).getMap("entities").get(nodeId);
    return entity instanceof LoroMap ? (entity as unknown as LoroMap) : null;
  }

  /** True iff the node's entity currently exists in its owning shard. */
  private entityPresent(nodeId: NodeId): boolean {
    const bucket = this.ownership.get(nodeId);
    return (
      typeof bucket === "number" &&
      this.entityInShard(nodeId, shardIdOfBucket(bucket, this.numShards)) !== null
    );
  }

  private nodeIdOf(occ: OccurrenceId): NodeId {
    const node = this.liveTreeNodeOf(occ);
    const nodeId = node?.data.get("nodeId");
    if (typeof nodeId !== "string") throw new Error(`Occurrence not found: ${occ}`);
    return nodeId;
  }

  private canonicalOccurrenceIdOf(nodeId: NodeId): OccurrenceId {
    const id = this.requireEntity(nodeId).get("canonicalOccurrenceId");
    if (typeof id !== "string") throw new Error(`Canonical not found: ${nodeId}`);
    return id;
  }

  private contentOf(nodeId: NodeId): LoroText {
    const text = this.requireEntity(nodeId).get("content");
    if (!(text instanceof LoroText)) throw new Error(`Content not found: ${nodeId}`);
    return text;
  }

  private propsOf(nodeId: NodeId): LoroMap {
    return this.propsContainerOf(this.requireEntity(nodeId));
  }

  private propsContainerOf(entity: LoroMap): LoroMap {
    const props = entity.get("props");
    if (!(props instanceof LoroMap)) throw new Error("Node props missing");
    return props as unknown as LoroMap;
  }

  private readText(entity: LoroMap): string {
    const content = entity.get("content");
    if (!(content instanceof LoroText)) return "";
    const delta = content.toDelta() as Array<Record<string, unknown>>;
    return delta
      .filter((d): d is { insert: string } => typeof d.insert === "string")
      .map((d) => d.insert)
      .join("");
  }

  /** Rich-text delta WITH marks (the full observable content, unlike readText). */
  private readDelta(entity: LoroMap): unknown[] {
    const content = entity.get("content");
    if (!(content instanceof LoroText)) return [];
    return content.toDelta() as unknown[];
  }

  private liveTreeNodeOf(occ: OccurrenceId): LoroTreeNode | null {
    const node = this.occurrenceTree.getNodeByID(occ as TreeID);
    if (!node || node.isDeleted()) return null;
    return node;
  }

  private occurrenceMetaOf(occ: OccurrenceId): LoroMap {
    const node = this.liveTreeNodeOf(occ);
    const meta = node?.data.get("meta");
    if (!(meta instanceof LoroMap)) throw new Error(`Occurrence meta not found: ${occ}`);
    return meta as unknown as LoroMap;
  }

  private mapToRecord(map: LoroMap): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of map.entries()) out[k] = v;
    return out;
  }
}

/**
 * Fixed virtual-bucket space. A node's bucket (`hash mod P`) is PERMANENT — it is
 * what `ownership` stores — so the nodeId→bucket assignment never changes. The
 * bucket→shard grouping (`shardIdOfBucket`) is a function of the CURRENT numShards,
 * so numShards can be raised later (power-of-two split-doubling) by regrouping
 * without re-hashing every node. P is a power of two well above any plausible
 * numShards, leaving headroom to split up to P shards (one bucket per shard).
 */
export const VIRTUAL_BUCKETS = 4096;

/** Deterministic nodeId hash (djb2). Stable across replicas and across numShards. */
export function hashOfNodeId(nodeId: NodeId): number {
  let h = 5381;
  for (let i = 0; i < nodeId.length; i++) {
    h = ((h * 33) ^ nodeId.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** The permanent virtual bucket a node maps to (0 .. VIRTUAL_BUCKETS-1). */
export function bucketOf(nodeId: NodeId): number {
  return hashOfNodeId(nodeId) % VIRTUAL_BUCKETS;
}

/**
 * Which shard doc a bucket lives in, given the current numShards. Contiguous bucket
 * ranges per shard (not mod-classes): shard k owns buckets [k·P/S, (k+1)·P/S), so
 * doubling S splits each shard cleanly in two — the reshard-friendly grouping.
 */
export function shardIdOfBucket(bucket: number, numShards: number): string {
  return `s${Math.floor((bucket * numShards) / VIRTUAL_BUCKETS)}`;
}

/** Deterministic shard assignment: same nodeId → same shard on every replica. */
export function shardIdOf(nodeId: NodeId, numShards: number): string {
  return shardIdOfBucket(bucketOf(nodeId), numShards);
}
