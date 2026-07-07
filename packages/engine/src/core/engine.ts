/* eslint-disable max-lines -- the business-agnostic Engine store is intentionally kept in one file */
import { randomUUID } from "node:crypto";
import { Subject } from "rxjs";
import { ShardedBlockStore, type Outliner } from "./sharded-store.js";
import { ActionHistory } from "./action-history.js";
import type {
  Delta,
  EngineSlots,
  MarkRange,
  NodeId,
  NodeOccurrence,
  NodeUpdatedPayload,
  OccurrenceId,
} from "./types.js";

export type EngineOptions = {
  id?: string;
  readonly?: boolean;
  /** Inject a custom ShardedBlockStore. Defaults to a fresh one. To restore a sharded engine from
   * persisted state, inject `new ShardedBlockStore({ residentBytes })` keyed by outward SyncableDoc
   * ids — a single bytes blob can't carry the lazy-loaded shards, so there is no constructor-bytes
   * option (the persistence runtime is the full restore path). */
  store?: ShardedBlockStore;
  /** NodeId generator (test seam; defaults to randomUUID). CONTRACT: must return globally-
   *  unique ids across all replicas and sessions. The engine assumes global uniqueness, so
   *  concurrent createNode on different replicas never collide (randomUUID makes a collision
   *  astronomically unlikely). The only collision path is a caller injecting a generator that
   *  yields a duplicate id — a caller-contract violation, not an engine bug. */
  nodeIdGenerator?: () => NodeId;
  /** occId generator (test seam; defaults to randomUUID). occId is the permanent occurrence
   *  identity used by undo to reconcile snapshots across churn. Same global-uniqueness
   *  contract as nodeIdGenerator: concurrent occurrence creation on different replicas never
   *  collides; only an injected duplicate-producing generator can. */
  occIdGenerator?: () => string;
};

export class Engine {
  readonly id: string;
  readonly slots: EngineSlots;
  private readonly store: ShardedBlockStore;
  /** Cross-doc undo/redo (snapshot-diff): captures before/after per action and restores
   *  the wanted side forward through these mutators (store-agnostic). */
  private readonly actionHistory: ActionHistory;
  /** True inside transact() (the transaction is the one group) and during undo/redo
   *  application — suppresses per-op auto-grouping so mutators run the store-apply path
   *  bare instead of each opening their own begin/end group. */
  private historyActive = false;
  private _readonly = false;
  private readonly nodeIdGenerator: () => NodeId;
  private readonly occIdGenerator: () => string;
  private inTransaction = false;

  constructor(options: EngineOptions = {}) {
    this.id = options.id ?? randomUUID();
    this.store = options.store ?? new ShardedBlockStore();
    this.nodeIdGenerator = options.nodeIdGenerator ?? randomUUID;
    this.occIdGenerator = options.occIdGenerator ?? randomUUID;
    this.actionHistory = new ActionHistory(this);
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
    /** Override the generated nodeId (used by undo to re-create a deleted node with its
     * original id so refs/content resolve). Undefined → generate. */
    nodeIdOverride?: NodeId,
    /** Override the generated occId (used by undo to re-create with the original occId so
     * snapshot reconciliation is stable across churn). Undefined → generate. */
    occIdOverride?: string,
  ): NodeOccurrence {
    this.requireWritable();
    return this.runAutoGrouped(() => {
      const nodeId = nodeIdOverride ?? this.nodeIdGenerator();
      const occId = occIdOverride ?? this.occIdGenerator();
      const occurrenceId = this.store.createOccurrenceRecord(
        nodeId,
        occId,
        parentOccurrenceId,
        index,
      );
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
    });
  }

  createOccurrence(
    nodeId: NodeId,
    parentOccurrenceId?: OccurrenceId | null,
    index?: number,
    occIdOverride?: string,
  ): NodeOccurrence {
    this.requireWritable();
    return this.runAutoGrouped(() => {
      this.store.requireEntity(nodeId);
      const occId = occIdOverride ?? this.occIdGenerator();
      const occurrenceId = this.store.createOccurrenceRecord(
        nodeId,
        occId,
        parentOccurrenceId,
        index,
      );
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
    });
  }

  moveOccurrence(
    occurrenceId: OccurrenceId,
    parentOccurrenceId: OccurrenceId | null,
    index?: number,
  ): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      this.store.moveOccurrenceRecord(occurrenceId, parentOccurrenceId, index);
      this.commitIfNeeded();
      this.emit([{ type: "occurrenceMoved", nodeId, occurrenceId, parentOccurrenceId }]);
    });
  }

  removeOccurrence(occurrenceId: OccurrenceId): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
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
    });
  }

  setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
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
    });
  }

  deleteNode(nodeId: NodeId): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
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
    });
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
      occId: this.store.occIdOf(occurrenceId),
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
    this.runAutoGrouped(() => {
      this.store.replaceDeltas(occurrenceId, deltas);
      this.commitIfNeeded();
      this.emit([
        { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "text" },
      ]);
    });
  }

  mark(occurrenceId: OccurrenceId, range: MarkRange, key: string, value: unknown): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      this.store.mark(occurrenceId, range, key, value);
      this.commitIfNeeded();
      this.emit([
        { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "text" },
      ]);
    });
  }

  unmark(occurrenceId: OccurrenceId, range: MarkRange, key: string): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      this.store.unmark(occurrenceId, range, key);
      this.commitIfNeeded();
      this.emit([
        { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "text" },
      ]);
    });
  }

  getProp(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getProp(occurrenceId, key);
  }

  setProp(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      this.store.setProp(occurrenceId, key, value);
      this.commitIfNeeded();
      this.emit([
        { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "props", key },
      ]);
    });
  }

  unsetProp(occurrenceId: OccurrenceId, key: string): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      this.store.unsetProp(occurrenceId, key);
      this.commitIfNeeded();
      this.emit([
        { type: "entityUpdated", nodeId: this.store.nodeIdOf(occurrenceId), field: "props", key },
      ]);
    });
  }

  setProps(occurrenceId: OccurrenceId, props: Record<string, unknown>): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
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
    });
  }

  getProps(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.store.getProps(occurrenceId);
  }

  getEntityMeta(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getEntityMeta(occurrenceId, key);
  }

  setEntityMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      this.store.setEntityMeta(occurrenceId, key, value);
      this.commitIfNeeded();
    });
  }

  unsetEntityMeta(occurrenceId: OccurrenceId, key: string): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      this.store.unsetEntityMeta(occurrenceId, key);
      this.commitIfNeeded();
    });
  }

  getEntityMetaRecord(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.store.getEntityMetaRecord(occurrenceId);
  }

  getOccurrenceProp(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getOccurrenceProp(occurrenceId, key);
  }

  setOccurrenceProp(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
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
    });
  }

  unsetOccurrenceProp(occurrenceId: OccurrenceId, key: string): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
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
    });
  }

  getOccurrenceProps(occurrenceId: OccurrenceId): Record<string, unknown> {
    return this.store.getOccurrenceProps(occurrenceId);
  }

  getOccurrenceMeta(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getOccurrenceMeta(occurrenceId, key);
  }

  setOccurrenceMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      this.store.setOccurrenceMeta(occurrenceId, key, value);
      this.commitIfNeeded();
    });
  }

  unsetOccurrenceMeta(occurrenceId: OccurrenceId, key: string): void {
    this.requireWritable();
    this.runAutoGrouped(() => {
      this.store.unsetOccurrenceMeta(occurrenceId, key);
      this.commitIfNeeded();
    });
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

  transact<T>(fn: () => T): T {
    // Re-entrant: a batch inside a batch joins the outer group (one undo step) instead of
    // throwing. This lets a composite op group itself while calling other grouped primitives
    // (e.g. setFieldValues → removeOccurrenceOrHardDelete, or paste → cloneOccurrence). Only
    // the outermost transact owns begin/end; inner calls run fn bare against the open group.
    if (this.inTransaction) {
      return fn();
    }
    this.actionHistory.begin();
    this.inTransaction = true;
    this.historyActive = true; // suppress per-op auto-grouping; the transaction is the group
    try {
      const result = fn();
      this.store.commit();
      return result;
    } finally {
      this.historyActive = false;
      this.inTransaction = false;
      this.actionHistory.end();
    }
  }

  batch<T>(fn: () => T): T {
    return this.transact(fn);
  }

  undo(): boolean {
    if (this._readonly) {
      return false;
    }
    this.historyActive = true;
    try {
      return this.actionHistory.undo();
    } finally {
      this.historyActive = false;
    }
  }

  redo(): boolean {
    if (this._readonly) {
      return false;
    }
    this.historyActive = true;
    try {
      return this.actionHistory.redo();
    } finally {
      this.historyActive = false;
    }
  }

  canUndo(): boolean {
    if (this._readonly) {
      return false;
    }
    return this.actionHistory.canUndo();
  }

  canRedo(): boolean {
    if (this._readonly) {
      return false;
    }
    return this.actionHistory.canRedo();
  }

  resetHistory(): void {
    this.actionHistory.clear();
  }

  captureSync(): void {
    this.commitIfNeeded();
  }

  /** The outliner sync/persist surface. `ShardedBlockStore` is the only store, so the engine is
   *  always sharded — this never returns undefined. Orchestration (persistence, the version capture
   *  in `runMutation`) depends on this `Outliner` abstraction, not the concrete `ShardedBlockStore`,
   *  so the ~50 CRUD methods stay out of those call sites' view. */
  asOutliner(): Outliner {
    return this.store;
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

  /** Run a store-mutation thunk. Auto-groups as its own undo step when no group is open
   *  (top-level call); runs bare when a group is already open (transact) or during
   *  undo/redo application (historyActive set by undo()/redo()/transact). */
  private runAutoGrouped<T>(fn: () => T): T {
    if (this.historyActive) {
      return fn();
    }
    this.historyActive = true;
    this.actionHistory.begin();
    try {
      return fn();
    } finally {
      this.actionHistory.end();
      this.historyActive = false;
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
