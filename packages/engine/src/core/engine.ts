/* eslint-disable max-lines -- the business-agnostic Engine store is intentionally kept in one file */
import { randomUUID } from "node:crypto";
import { Subject } from "rxjs";
import type { UndoManager } from "loro-crdt";
import { LoroBlockStore } from "./loro-store.js";
import type {
  Delta,
  EngineSlots,
  MarkRange,
  NodeId,
  NodeOccurrence,
  NodeUpdatedPayload,
  OccurrenceId,
  VersionVector,
} from "./types.js";

export type EngineOptions = {
  id?: string;
  initialBytes?: Uint8Array;
  readonly?: boolean;
  historyMergeInterval?: number;
};

export class Engine {
  readonly id: string;
  readonly slots: EngineSlots;
  private readonly store: LoroBlockStore;
  private undoManager: UndoManager;
  private _readonly = false;
  private readonly mergeInterval: number;
  private inTransaction = false;

  constructor(options: EngineOptions = {}) {
    this.id = options.id ?? randomUUID();
    this.store = new LoroBlockStore(options.initialBytes);
    this.mergeInterval = options.historyMergeInterval ?? 500;
    this.undoManager = this.store.createUndoManager(this.mergeInterval);
    if (options.readonly) {
      this._readonly = true;
    }

    const nodeUpdated = new Subject<NodeUpdatedPayload>();
    this.slots = { nodeUpdated };
  }

  // ── Readonly ─────────────────────────────────────────────────────────────

  get readonly(): boolean {
    return this._readonly;
  }

  set readonly(val: boolean) {
    this._readonly = val;
  }

  private requireWritable(): void {
    if (this._readonly) {
      throw new Error("Document is readonly");
    }
  }

  // ── Node / occurrence CRUD ────────────────────────────────────────────────

  createNode(
    parentOccurrenceId?: OccurrenceId | null,
    index?: number,
    props?: Record<string, unknown>,
  ): NodeOccurrence {
    this.requireWritable();
    const nodeId = randomUUID();
    const occurrenceId = this.store.createOccurrenceRecord(nodeId, parentOccurrenceId, index);
    this.store.createEntity(nodeId, occurrenceId, props);
    this.commitIfNeeded();
    this.emit([
      { type: "entityAdded", nodeId, occurrenceId },
      {
        type: "occurrenceAdded",
        nodeId,
        occurrenceId,
        parentOccurrenceId: parentOccurrenceId ?? null,
      },
    ]);
    return this.mustGetOccurrence(occurrenceId);
  }

  createOccurrence(
    nodeId: NodeId,
    parentOccurrenceId?: OccurrenceId | null,
    index?: number,
  ): NodeOccurrence {
    this.requireWritable();
    this.store.requireEntity(nodeId);
    const occurrenceId = this.store.createOccurrenceRecord(nodeId, parentOccurrenceId, index);
    this.commitIfNeeded();
    this.emit([
      {
        type: "occurrenceAdded",
        nodeId,
        occurrenceId,
        parentOccurrenceId: parentOccurrenceId ?? null,
      },
    ]);
    return this.mustGetOccurrence(occurrenceId);
  }

  moveOccurrence(
    occurrenceId: OccurrenceId,
    parentOccurrenceId: OccurrenceId | null,
    index?: number,
  ): void {
    this.requireWritable();
    const nodeId = this.store.nodeIdOf(occurrenceId);
    this.store.moveOccurrenceRecord(occurrenceId, parentOccurrenceId, index);
    this.commitIfNeeded();
    this.emit([{ type: "occurrenceMoved", nodeId, occurrenceId, parentOccurrenceId }]);
  }

  removeOccurrence(occurrenceId: OccurrenceId): void {
    this.requireWritable();
    const nodeId = this.store.nodeIdOf(occurrenceId);
    if (occurrenceId === this.store.canonicalOccurrenceIdOf(nodeId)) {
      throw new Error(`Cannot remove canonical occurrence: ${occurrenceId}`);
    }
    if (this.getChildOccurrenceIds(occurrenceId).length > 0) {
      throw new Error(`Cannot remove occurrence with children: ${occurrenceId}`);
    }
    const parentOccurrenceId = this.getParentOccurrenceId(occurrenceId);
    this.store.deleteOccurrenceRecord(occurrenceId);
    this.commitIfNeeded();
    this.emit([{ type: "occurrenceDeleted", nodeId, occurrenceId, parentOccurrenceId }]);
  }

  setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): void {
    this.requireWritable();
    const promotedNodeId = this.store.nodeIdOf(occurrenceId);
    if (promotedNodeId !== nodeId) {
      throw new Error(`Occurrence does not belong to node: ${occurrenceId}`);
    }
    if (this.store.canonicalOccurrenceIdOf(nodeId) === occurrenceId) {
      return;
    }
    this.store.setCanonicalOccurrence(nodeId, occurrenceId);
    this.commitIfNeeded();
    this.emit([{ type: "canonicalChanged", nodeId, occurrenceId }]);
  }

  deleteNode(nodeId: NodeId): void {
    this.requireWritable();
    this.store.requireEntity(nodeId);
    const occurrenceIds = this.store.getOccurrenceIdsForNode(nodeId).map((occurrenceId) => ({
      occurrenceId,
      parentOccurrenceId: this.getParentOccurrenceId(occurrenceId),
    }));
    const occurrenceWithChildren = occurrenceIds.find(
      ({ occurrenceId }) => this.getChildOccurrenceIds(occurrenceId).length > 0,
    );
    if (occurrenceWithChildren) {
      throw new Error(`Cannot delete node with children: ${nodeId}`);
    }
    for (const { occurrenceId } of occurrenceIds) {
      this.store.deleteOccurrenceRecord(occurrenceId);
    }
    this.store.deleteEntity(nodeId);
    this.commitIfNeeded();
    this.emit([
      ...occurrenceIds.map(({ occurrenceId, parentOccurrenceId }) => ({
        type: "occurrenceDeleted" as const,
        nodeId,
        occurrenceId,
        parentOccurrenceId,
      })),
      { type: "entityDeleted", nodeId },
    ]);
  }

  getOccurrence(occurrenceId: OccurrenceId): NodeOccurrence | undefined {
    if (!this.store.occurrenceExists(occurrenceId)) {
      return undefined;
    }
    const nodeId = this.store.nodeIdOf(occurrenceId);
    const canonicalOccurrenceId = this.store.canonicalOccurrenceIdOf(nodeId);
    return {
      nodeId,
      occurrenceId,
      parentOccurrenceId: this.getParentOccurrenceId(occurrenceId),
      canonicalOccurrenceId,
      canonicalChildOccurrenceIds: this.getChildOccurrenceIds(canonicalOccurrenceId),
      props: this.getProps(occurrenceId),
      entityMeta: this.getEntityMetaRecord(occurrenceId),
      occurrenceProps: this.getOccurrenceProps(occurrenceId),
      occurrenceMeta: this.getOccurrenceMetaRecord(occurrenceId),
      deltas: this.getDeltas(occurrenceId),
    };
  }

  mustGetOccurrence(occurrenceId: OccurrenceId): NodeOccurrence {
    const node = this.getOccurrence(occurrenceId);
    if (!node) {
      throw new Error(`Node occurrence not found: ${occurrenceId}`);
    }
    return node;
  }

  getOccurrences(nodeId: NodeId): NodeOccurrence[] {
    return this.store
      .getOccurrenceIdsForNode(nodeId)
      .map((id) => this.getOccurrence(id))
      .filter((node): node is NodeOccurrence => node != null);
  }

  getCanonicalOccurrenceId(nodeId: NodeId): OccurrenceId {
    return this.store.canonicalOccurrenceIdOf(nodeId);
  }

  getRootOccurrences(): NodeOccurrence[] {
    return this.getRootOccurrenceIds()
      .map((id) => this.getOccurrence(id))
      .filter((node): node is NodeOccurrence => node != null);
  }

  getOccurrenceChildren(occurrenceId: OccurrenceId): NodeOccurrence[] {
    return this.getChildOccurrenceIds(occurrenceId)
      .map((id) => this.getOccurrence(id))
      .filter((node): node is NodeOccurrence => node != null);
  }

  getDeltas(occurrenceId: OccurrenceId): Delta {
    return this.store.getDeltas(occurrenceId);
  }

  replaceDeltas(occurrenceId: OccurrenceId, deltas: Delta): void {
    this.requireWritable();
    this.store.replaceDeltas(occurrenceId, deltas);
    this.commitIfNeeded();
    this.emit([
      { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "text" },
    ]);
  }

  mark(occurrenceId: OccurrenceId, range: MarkRange, key: string, value: unknown): void {
    this.requireWritable();
    this.store.mark(occurrenceId, range, key, value);
    this.commitIfNeeded();
    this.emit([
      { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "text" },
    ]);
  }

  unmark(occurrenceId: OccurrenceId, range: MarkRange, key: string): void {
    this.requireWritable();
    this.store.unmark(occurrenceId, range, key);
    this.commitIfNeeded();
    this.emit([
      { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "text" },
    ]);
  }

  getProp(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getProp(occurrenceId, key);
  }

  setProp(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.requireWritable();
    this.store.setProp(occurrenceId, key, value);
    this.commitIfNeeded();
    this.emit([
      { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "props", key },
    ]);
  }

  unsetProp(occurrenceId: OccurrenceId, key: string): void {
    this.requireWritable();
    this.store.unsetProp(occurrenceId, key);
    this.commitIfNeeded();
    this.emit([
      { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "props", key },
    ]);
  }

  setProps(occurrenceId: OccurrenceId, props: Record<string, unknown>): void {
    this.requireWritable();
    this.store.setProps(occurrenceId, props);
    this.commitIfNeeded();
    this.emit(
      Object.keys(props).map((key) => ({
        type: "entityUpdated" as const,
        nodeId: this.store.nodeIdOf(occurrenceId),
        field: "props" as const,
        key,
      })),
    );
  }

  getProps(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.store.getProps(occurrenceId);
  }

  getEntityMeta(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getEntityMeta(occurrenceId, key);
  }

  setEntityMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.requireWritable();
    this.store.setEntityMeta(occurrenceId, key, value);
    this.commitIfNeeded();
  }

  unsetEntityMeta(occurrenceId: OccurrenceId, key: string): void {
    this.requireWritable();
    this.store.unsetEntityMeta(occurrenceId, key);
    this.commitIfNeeded();
  }

  getEntityMetaRecord(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.store.getEntityMetaRecord(occurrenceId);
  }

  getOccurrenceProp(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getOccurrenceProp(occurrenceId, key);
  }

  setOccurrenceProp(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.requireWritable();
    this.store.setOccurrenceProp(occurrenceId, key, value);
    this.commitIfNeeded();
    this.emit([
      {
        type: "occurrenceUpdated",
        nodeId: this.store.nodeIdOf(occurrenceId),
        occurrenceId,
        field: "props",
        key,
      },
    ]);
  }

  unsetOccurrenceProp(occurrenceId: OccurrenceId, key: string): void {
    this.requireWritable();
    this.store.unsetOccurrenceProp(occurrenceId, key);
    this.commitIfNeeded();
    this.emit([
      {
        type: "occurrenceUpdated",
        nodeId: this.store.nodeIdOf(occurrenceId),
        occurrenceId,
        field: "props",
        key,
      },
    ]);
  }

  getOccurrenceProps(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.store.getOccurrenceProps(occurrenceId);
  }

  getOccurrenceMeta(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getOccurrenceMeta(occurrenceId, key);
  }

  setOccurrenceMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.requireWritable();
    this.store.setOccurrenceMeta(occurrenceId, key, value);
    this.commitIfNeeded();
  }

  unsetOccurrenceMeta(occurrenceId: OccurrenceId, key: string): void {
    this.requireWritable();
    this.store.unsetOccurrenceMeta(occurrenceId, key);
    this.commitIfNeeded();
  }

  getOccurrenceMetaRecord(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.store.getOccurrenceMetaRecord(occurrenceId);
  }

  // ── Tree queries ─────────────────────────────────────────────────────────

  getRootOccurrenceIds(): OccurrenceId[] {
    return this.store.getRootOccurrenceIds();
  }

  getParentOccurrenceId(occurrenceId: OccurrenceId): OccurrenceId | null {
    return this.store.getParentOccurrenceId(occurrenceId);
  }

  getChildOccurrenceIds(occurrenceId: OccurrenceId): OccurrenceId[] {
    return this.store.getChildOccurrenceIds(occurrenceId);
  }

  // ── History ──────────────────────────────────────────────────────────────

  transact(fn: () => void): void {
    this.undoManager.groupStart();
    this.inTransaction = true;
    try {
      fn();
      this.store.commit();
    } finally {
      this.inTransaction = false;
      this.undoManager.groupEnd();
    }
  }

  batch(fn: () => void): void {
    this.transact(fn);
  }

  undo(): boolean {
    if (this._readonly) {
      return false;
    }
    return this.undoManager.undo();
  }

  redo(): boolean {
    if (this._readonly) {
      return false;
    }
    return this.undoManager.redo();
  }

  canUndo(): boolean {
    return this._readonly ? false : this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this._readonly ? false : this.undoManager.canRedo();
  }

  resetHistory(): void {
    this.undoManager.clear();
  }

  withoutTransact(fn: () => void): void {
    this.undoManager.setMergeInterval(0);
    try {
      fn();
    } finally {
      this.undoManager.setMergeInterval(this.mergeInterval);
    }
  }

  captureSync(): void {
    this.commitIfNeeded();
  }

  // ── Persistence / Sync primitives ────────────────────────────────────────

  exportSnapshot(): Uint8Array {
    return this.store.exportSnapshot();
  }

  exportUpdateFrom(from: VersionVector): Uint8Array {
    return this.store.exportUpdateFrom(from);
  }

  importUpdate(bytes: Uint8Array): void {
    this.store.importUpdate(bytes);
  }

  getVersion(): VersionVector {
    return this.store.getVersion();
  }

  // ── Events ───────────────────────────────────────────────────────────────

  dispose(): void {
    this.slots.nodeUpdated.complete();
  }

  private commitIfNeeded(): void {
    if (!this.inTransaction) {
      this.store.commit();
    }
  }

  private emit(payloads: NodeUpdatedPayload[]): void {
    if (payloads.length === 0) {
      return;
    }
    for (const payload of payloads) {
      this.slots.nodeUpdated.next(payload);
    }
  }
}
