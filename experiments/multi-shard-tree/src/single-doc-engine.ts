import {
  LoroDoc,
  LoroMap,
  LoroText,
  type LoroTree,
  type LoroTreeNode,
  type TreeID,
  type VersionVector,
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
 * The reference engine / differential oracle. A single LoroDoc holds both the
 * `occurrences` movable tree (outline structure) and the `entities` map (node
 * content), exactly mirroring lode's production `LoroBlockStore` model.
 *
 * This is the "known correct" implementation. The multi-shard engine is proven
 * correct by producing identical observable snapshots for identical op logs.
 */
export class SingleDocEngine implements OutlineApi {
  protected readonly doc: LoroDoc;
  protected readonly occurrenceTree: LoroTree;
  protected readonly entities: LoroMap;

  constructor(initialBytes?: Uint8Array) {
    this.doc = new LoroDoc();
    this.doc.configTextStyle({
      bold: { expand: "after" },
      italic: { expand: "after" },
    });
    if (initialBytes && initialBytes.length > 0) {
      this.doc.import(initialBytes);
    }
    this.occurrenceTree = this.doc.getTree("occurrences");
    this.entities = this.doc.getMap("entities");
  }

  createNode(
    nodeId: NodeId,
    parent: OccurrenceId | null,
    index?: number,
    text?: string,
  ): OccurrenceId {
    if (this.entities.get(nodeId) instanceof LoroMap) {
      throw new Error(`Node already exists: ${nodeId}`);
    }
    const parentTreeId = parent == null ? undefined : (parent as TreeID);
    const occNode = this.occurrenceTree.createNode(parentTreeId, index);
    const occurrenceId = String(occNode.id);
    occNode.data.set("nodeId", nodeId);
    occNode.data.setContainer("meta", new LoroMap()); // per-occurrence meta (treeDoc)

    const entity = this.entities.setContainer(nodeId, new LoroMap());
    entity.set("canonicalOccurrenceId", occurrenceId);
    const content = entity.setContainer("content", new LoroText());
    entity.setContainer("props", new LoroMap());
    if (text) content.insert(0, text);
    return occurrenceId;
  }

  createReference(targetNodeId: NodeId, parent: OccurrenceId | null, index?: number): OccurrenceId {
    this.requireEntity(targetNodeId);
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
    this.requireEntity(nodeId).set("canonicalOccurrenceId", occurrenceId);
  }

  removeOccurrence(occ: OccurrenceId): void {
    if (!this.liveTreeNodeOf(occ)) return;
    const nodeId = this.nodeIdOf(occ);
    if (occ === this.canonicalOccurrenceIdOf(nodeId)) {
      // Removing the canonical occurrence hard-deletes the whole node.
      this.hardDeleteNode(nodeId);
      return;
    }
    // Non-canonical: drop this occurrence and its physical subtree, hard-
    // deleting any node whose canonical is nested in it.
    this.cascadeRemove([occ]);
  }

  hardDeleteNode(nodeId: NodeId): void {
    if (!this.existsNode(nodeId)) return;
    this.cascadeRemove(this.occurrenceIdsOf(nodeId));
  }

  /**
   * Worklist cascade. Removing an occurrence orphans its physical children
   * (re-enqueue them) and, when that occurrence is a node's canonical, kills the
   * whole node (re-enqueue every occurrence of it). The `removed` set bounds the
   * work, so a node referencing itself cannot loop. Deleted nodes are exactly
   * those whose canonical ended up removed. Mirrors lode's recursive
   * removeOccurrenceOrHardDelete without the recursion.
   */
  protected cascadeRemove(seed: OccurrenceId[]): void {
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
    for (const nid of deletedNodes) this.entities.delete(nid);
    for (const o of removed) this.occurrenceTree.delete(o as TreeID);
  }

  protected physicalChildIds(occ: OccurrenceId): OccurrenceId[] {
    const node = this.liveTreeNodeOf(occ);
    return (node?.children() ?? []).map((c) => String(c.id));
  }

  protected occurrenceIdsOf(nodeId: NodeId): OccurrenceId[] {
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
    const props = this.propsOf(nodeId);
    props.set(key, value as never);
  }

  contentDelta(nodeId: NodeId): unknown[] {
    return this.contentOf(nodeId).toDelta() as unknown[];
  }

  applyContentDelta(nodeId: NodeId, delta: unknown[]): void {
    const content = this.contentOf(nodeId);
    const curLen = content.toString().length;
    const inserts = (delta as Array<Record<string, unknown>>).filter(
      (d) => typeof d.insert === "string",
    );
    content.applyDelta([{ delete: curLen }, ...inserts] as never);
  }

  markText(nodeId: NodeId, start: number, end: number, key: string, value: unknown): void {
    this.contentOf(nodeId).mark({ start, end }, key, value as never);
  }

  setOccurrenceMeta(occ: OccurrenceId, key: string, value: unknown): void {
    this.occurrenceMetaOf(occ).set(key, value as never);
  }

  getOccurrenceMeta(occ: OccurrenceId, key: string): unknown {
    return this.occurrenceMetaOf(occ).get(key);
  }

  insertText(nodeId: NodeId, pos: number, str: string): void {
    this.contentOf(nodeId).insert(pos, str);
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  snapshot(): TreeSnapshot {
    const occurrences: Record<OccurrenceId, OccurrenceView> = {};
    const nodesByOccurrence: Record<OccurrenceId, NodeId> = {};
    const occurrencesByNode = new Map<NodeId, OccurrenceId[]>();

    for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
      const occId = String(node.id);
      const nodeId = node.data.get("nodeId");
      if (typeof nodeId !== "string") {
        throw new Error(`Occurrence ${occId} missing nodeId`);
      }
      nodesByOccurrence[occId] = nodeId;
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
    for (const [nodeId, rawEntity] of this.entities.entries()) {
      if (!(rawEntity instanceof LoroMap)) continue;
      const entity = rawEntity as unknown as LoroMap;
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
    return Object.keys(this.snapshot().nodes);
  }

  existsNode(nodeId: NodeId): boolean {
    return this.entities.get(nodeId) instanceof LoroMap;
  }

  existsOccurrence(occ: OccurrenceId): boolean {
    return this.liveTreeNodeOf(occ) != null;
  }

  // ── correctness ─────────────────────────────────────────────────────────────

  validateInvariants(): void {
    validateSnapshot(this.snapshot());
  }

  // ── crdt sync ───────────────────────────────────────────────────────────────

  commit(): void {
    this.doc.commit();
  }

  version(): VersionVector {
    return this.doc.version();
  }

  exportSnapshotBytes(): Uint8Array {
    return this.doc.export({ mode: "snapshot" });
  }

  /** Release the underlying CRDT doc (it is a WASM resource). */
  free(): void {
    this.doc.free?.();
  }

  exportUpdateFrom(vv: VersionVector): Uint8Array {
    return this.doc.export({ mode: "update", from: vv });
  }

  importUpdate(bytes: Uint8Array): void {
    this.doc.import(bytes);
    validateSnapshot(this.snapshot());
  }

  // ── internals ───────────────────────────────────────────────────────────────

  protected requireEntity(nodeId: NodeId): LoroMap {
    const entity = this.entities.get(nodeId);
    if (!(entity instanceof LoroMap)) {
      throw new Error(`Node entity not found: ${nodeId}`);
    }
    return entity as unknown as LoroMap;
  }

  protected nodeIdOf(occ: OccurrenceId): NodeId {
    const node = this.liveTreeNodeOf(occ);
    const nodeId = node?.data.get("nodeId");
    if (typeof nodeId !== "string") throw new Error(`Occurrence not found: ${occ}`);
    return nodeId;
  }

  protected canonicalOccurrenceIdOf(nodeId: NodeId): OccurrenceId {
    const id = this.requireEntity(nodeId).get("canonicalOccurrenceId");
    if (typeof id !== "string") throw new Error(`Canonical not found: ${nodeId}`);
    return id;
  }

  protected contentOf(nodeId: NodeId): LoroText {
    const text = this.requireEntity(nodeId).get("content");
    if (!(text instanceof LoroText)) throw new Error(`Content not found: ${nodeId}`);
    return text;
  }

  protected propsOf(nodeId: NodeId): LoroMap {
    return this.propsContainerOf(this.requireEntity(nodeId));
  }

  private propsContainerOf(entity: LoroMap): LoroMap {
    const props = entity.get("props");
    if (!(props instanceof LoroMap)) throw new Error("Node props missing");
    return props as unknown as LoroMap;
  }

  private occurrenceMetaOf(occ: OccurrenceId): LoroMap {
    const node = this.liveTreeNodeOf(occ);
    const meta = node?.data.get("meta");
    if (!(meta instanceof LoroMap)) throw new Error(`Occurrence meta not found: ${occ}`);
    return meta as unknown as LoroMap;
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

  private mapToRecord(map: LoroMap): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of map.entries()) out[k] = v;
    return out;
  }
}
