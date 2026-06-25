/* eslint-disable max-lines -- Keep Loro container access behind one internal boundary. */
import {
  LoroDoc,
  LoroMap,
  LoroText,
  UndoManager,
  type LoroTree,
  type LoroTreeNode,
  type TreeID,
  type VersionVector,
} from "loro-crdt";
import type { Delta, DeltaInsert, MarkRange, NodeId, OccurrenceId } from "./types.js";

export class LoroBlockStore {
  private readonly doc: LoroDoc;
  private occurrenceTree: LoroTree;
  private entities: LoroMap;

  constructor(initialBytes?: Uint8Array) {
    this.doc = new LoroDoc();
    this.doc.configTextStyle({
      bold: { expand: "after" },
      italic: { expand: "after" },
      underline: { expand: "after" },
      strikethrough: { expand: "after" },
      code: { expand: "none" },
      link: { expand: "none" },
    });
    if (initialBytes && initialBytes.length > 0) {
      this.doc.import(initialBytes);
    }
    this.occurrenceTree = this.doc.getTree("occurrences");
    this.entities = this.doc.getMap("entities");
    this.validateInvariants();
  }

  createUndoManager(mergeInterval: number): UndoManager {
    return new UndoManager(this.doc, { mergeInterval });
  }

  commit(): void {
    this.doc.commit();
  }

  createEntity(
    nodeId: NodeId,
    canonicalOccurrenceId: OccurrenceId,
    props?: Record<string, unknown>,
  ): void {
    const entity = this.entities.setContainer(nodeId, new LoroMap());
    entity.set("canonicalOccurrenceId", canonicalOccurrenceId);
    entity.setContainer("content", new LoroText());
    const propsMap = entity.setContainer("props", new LoroMap());
    entity.setContainer("meta", new LoroMap());
    for (const [key, value] of Object.entries(props ?? {})) {
      propsMap.set(key, value as never);
    }
  }

  createOccurrenceRecord(
    nodeId: NodeId,
    parentOccurrenceId?: OccurrenceId | null,
    index?: number,
  ): OccurrenceId {
    const parentTreeId = parentOccurrenceId == null ? undefined : (parentOccurrenceId as TreeID);
    const node = this.occurrenceTree.createNode(parentTreeId, index);
    const occurrenceId = String(node.id);
    node.data.set("nodeId", nodeId);
    node.data.setContainer("props", new LoroMap());
    node.data.setContainer("meta", new LoroMap());
    return occurrenceId;
  }

  requireEntity(nodeId: NodeId): void {
    this.entityOf(nodeId);
  }

  setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): void {
    this.entityOf(nodeId).set("canonicalOccurrenceId", occurrenceId);
  }

  moveOccurrenceRecord(
    occurrenceId: OccurrenceId,
    parentOccurrenceId: OccurrenceId | null,
    index?: number,
  ): void {
    this.occurrenceTree.move(
      occurrenceId as TreeID,
      parentOccurrenceId == null ? undefined : (parentOccurrenceId as TreeID),
      index,
    );
  }

  deleteOccurrenceRecord(occurrenceId: OccurrenceId): void {
    this.occurrenceTree.delete(occurrenceId as TreeID);
  }

  deleteEntity(nodeId: NodeId): void {
    this.entities.delete(nodeId);
  }

  nodeIdOf(occurrenceId: OccurrenceId): NodeId {
    const node = this.treeNodeOf(occurrenceId);
    const nodeId = node?.data.get("nodeId");
    if (typeof nodeId !== "string") {
      throw new Error(`Occurrence not found: ${occurrenceId}`);
    }
    return nodeId;
  }

  canonicalOccurrenceIdOf(nodeId: NodeId): OccurrenceId {
    const id = this.entityOf(nodeId).get("canonicalOccurrenceId");
    if (typeof id !== "string") {
      throw new Error(`Canonical occurrence not found: ${nodeId}`);
    }
    return id;
  }

  occurrenceExists(occurrenceId: OccurrenceId): boolean {
    return this.treeNodeOf(occurrenceId) != null;
  }

  getOccurrenceIdsForNode(nodeId: NodeId): OccurrenceId[] {
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

  getDeltas(occurrenceId: OccurrenceId): Delta {
    const raw = this.textOf(occurrenceId).toDelta() as Record<string, unknown>[];
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
    const text = this.textOf(occurrenceId);
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
    this.textOf(occurrenceId).mark({ start: range.start, end: range.end }, key, value);
  }

  unmark(occurrenceId: OccurrenceId, range: MarkRange, key: string): void {
    this.textOf(occurrenceId).unmark({ start: range.start, end: range.end }, key);
  }

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
    return mapToRecord(this.propsOf(occurrenceId));
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
    return mapToRecord(this.entityMetaOf(occurrenceId));
  }

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
    return mapToRecord(this.occurrencePropsOf(occurrenceId));
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
    return mapToRecord(this.occurrenceMetaOf(occurrenceId));
  }

  exportSnapshot(): Uint8Array {
    return this.doc.export({ mode: "snapshot" });
  }

  exportUpdateFrom(from: VersionVector): Uint8Array {
    return this.doc.export({ mode: "update", from });
  }

  importUpdate(bytes: Uint8Array): void {
    this.doc.import(bytes);
    this.validateInvariants();
  }

  getVersion(): VersionVector {
    return this.doc.version();
  }

  private entityOf(nodeId: NodeId): LoroMap {
    const entity = this.entities.get(nodeId);
    if (!(entity instanceof LoroMap)) {
      throw new Error(`Node entity not found: ${nodeId}`);
    }
    const narrowed = entity as unknown as LoroMap;
    return narrowed;
  }

  private textOf(occurrenceId: OccurrenceId): LoroText {
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
    const node = this.occurrenceTree.getNodeByID(occurrenceId as TreeID);
    if (!node || node.isDeleted()) {
      return null;
    }
    return node;
  }

  private validateInvariants(): void {
    const liveOccurrences = new Map<OccurrenceId, NodeId>();
    for (const node of this.occurrenceTree.getNodes({ withDeleted: false })) {
      const occurrenceId = String(node.id);
      const nodeId = node.data.get("nodeId");
      if (typeof nodeId !== "string") {
        throw new Error(`Occurrence missing nodeId: ${occurrenceId}`);
      }
      if (!(this.entities.get(nodeId) instanceof LoroMap)) {
        throw new Error(`Occurrence references missing entity: ${occurrenceId}`);
      }
      if (!(node.data.get("props") instanceof LoroMap)) {
        throw new Error(`Occurrence props not found: ${occurrenceId}`);
      }
      if (!(node.data.get("meta") instanceof LoroMap)) {
        throw new Error(`Occurrence meta not found: ${occurrenceId}`);
      }
      liveOccurrences.set(occurrenceId, nodeId);
    }

    for (const [nodeId, rawEntity] of this.entities.entries()) {
      if (!(rawEntity instanceof LoroMap)) {
        throw new Error(`Node entity not found: ${nodeId}`);
      }
      const canonicalOccurrenceId = rawEntity.get("canonicalOccurrenceId");
      if (typeof canonicalOccurrenceId !== "string") {
        throw new Error(`Canonical occurrence not found: ${nodeId}`);
      }
      const canonicalNodeId = liveOccurrences.get(canonicalOccurrenceId);
      if (!canonicalNodeId) {
        throw new Error(`Canonical occurrence not found: ${nodeId}`);
      }
      if (canonicalNodeId !== nodeId) {
        throw new Error(`Canonical occurrence belongs to another node: ${nodeId}`);
      }
      if (!(rawEntity.get("content") instanceof LoroText)) {
        throw new Error(`Node content not found: ${nodeId}`);
      }
      if (!(rawEntity.get("props") instanceof LoroMap)) {
        throw new Error(`Node entity props not found: ${nodeId}`);
      }
      if (!(rawEntity.get("meta") instanceof LoroMap)) {
        throw new Error(`Node entity meta not found: ${nodeId}`);
      }
    }
  }
}

function mapToRecord(map: LoroMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of map.entries()) {
    out[key] = value;
  }
  return out;
}
