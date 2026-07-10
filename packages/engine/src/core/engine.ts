/* eslint-disable max-lines -- the business-agnostic Engine store is intentionally kept in one file */
import { randomUUID } from "node:crypto";
import { Subject } from "rxjs";
import { ShardedBlockStore, type Outliner } from "./store/sharded-store.js";
import { ActionHistory } from "./action-history.js";
import { NotFoundError } from "../errors/index.js";
import type {
  Delta,
  EngineSlots,
  MarkRange,
  NodeEntitySnapshot,
  NodeId,
  NodeOccurrence,
  NodeOccurrenceSnapshot,
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
  /** Before-image capture for incremental undo (Phase 2): when non-null, each entity-mutating
   *  mutator records its target's pre-mutation entity snapshot here (first-touch-wins per nodeId).
   *  Installed by ActionHistory around a group so the capture reads ONLY touched nodes' shards
   *  instead of the full tree. Null during undo/redo reconcile (reconciliation must not record). */
  private entityCapture: ((nodeId: NodeId, before: NodeEntitySnapshot | null) => void) | null =
    null;

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

  async createNode(
    parentOccurrenceId?: OccurrenceId | null,
    index?: number,
    props?: Record<string, unknown>,
    /** Override the generated nodeId (used by undo to re-create a deleted node with its
     * original id so refs/content resolve). Undefined → generate. */
    nodeIdOverride?: NodeId,
    /** Override the generated occId (used by undo to re-create with the original occId so
     * snapshot reconciliation is stable across churn). Undefined → generate. */
    occIdOverride?: string,
  ): Promise<NodeOccurrence> {
    this.requireWritable();
    return this.runAutoGrouped(async () => {
      const nodeId = nodeIdOverride ?? this.nodeIdGenerator();
      await this.captureEntityBeforeIfRecording(nodeId); // before-image null (entity is being created)
      const occId = occIdOverride ?? this.occIdGenerator();
      const occurrenceId = this.store.createOccurrenceRecord(
        nodeId,
        occId,
        parentOccurrenceId,
        index,
      );
      await this.store.createEntity(nodeId, occurrenceId, props);
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

  async createOccurrence(
    nodeId: NodeId,
    parentOccurrenceId?: OccurrenceId | null,
    index?: number,
    occIdOverride?: string,
  ): Promise<NodeOccurrence> {
    this.requireWritable();
    return this.runAutoGrouped(async () => {
      await this.store.requireEntity(nodeId);
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

  async moveOccurrence(
    occurrenceId: OccurrenceId,
    parentOccurrenceId: OccurrenceId | null,
    index?: number,
  ): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(() => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      this.store.moveOccurrenceRecord(occurrenceId, parentOccurrenceId, index);
      this.commitIfNeeded();
      this.emit([{ type: "occurrenceMoved", nodeId, occurrenceId, parentOccurrenceId }]);
    });
  }

  async removeOccurrence(occurrenceId: OccurrenceId): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      if (occurrenceId === (await this.store.canonicalOccurrenceIdOf(nodeId))) {
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

  async setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      await this.captureEntityBeforeIfRecording(nodeId);
      const promotedNodeId = this.store.nodeIdOf(occurrenceId);
      if (promotedNodeId !== nodeId) {
        throw new Error(`Occurrence does not belong to node: ${occurrenceId}`);
      }
      if ((await this.store.canonicalOccurrenceIdOf(nodeId)) === occurrenceId) {
        return;
      }
      await this.store.setCanonicalOccurrence(nodeId, occurrenceId);
      this.commitIfNeeded();
      this.emit([{ type: "canonicalChanged", nodeId, occurrenceId }]);
    });
  }

  async deleteNode(nodeId: NodeId): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.requireEntity(nodeId);
      const occurrenceIds = (await this.store.getOccurrenceIdsForNode(nodeId)).map(
        (occurrenceId) => ({
          occurrenceId,
          parentOccurrenceId: this.getParentOccurrenceId(occurrenceId),
        }),
      );
      const occurrenceWithChildren = occurrenceIds.find(
        ({ occurrenceId }) => this.getChildOccurrenceIds(occurrenceId).length > 0,
      );
      if (occurrenceWithChildren) {
        throw new Error(`Cannot delete node with children: ${nodeId}`);
      }
      for (const { occurrenceId } of occurrenceIds) {
        this.store.deleteOccurrenceRecord(occurrenceId);
      }
      await this.store.deleteEntity(nodeId);
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

  async getOccurrence(occurrenceId: OccurrenceId): Promise<NodeOccurrence | undefined> {
    if (!this.store.occurrenceExists(occurrenceId)) {
      return undefined;
    }
    const nodeId = this.store.nodeIdOf(occurrenceId);
    const canonicalOccurrenceId = await this.store.canonicalOccurrenceIdOf(nodeId);
    return {
      nodeId,
      occurrenceId,
      occId: this.store.occIdOf(occurrenceId),
      parentOccurrenceId: this.getParentOccurrenceId(occurrenceId),
      canonicalOccurrenceId,
      canonicalChildOccurrenceIds: this.getChildOccurrenceIds(canonicalOccurrenceId),
      props: await this.getProps(occurrenceId),
      entityMeta: await this.getEntityMetaRecord(occurrenceId),
      occurrenceProps: this.getOccurrenceProps(occurrenceId),
      occurrenceMeta: this.getOccurrenceMetaRecord(occurrenceId),
      deltas: await this.getDeltas(occurrenceId),
    };
  }

  /** treeDoc-only occurrence snapshot — structure + occurrence props/meta, NO entity reads. The
   *  occurrence fields all live on the tree node's `data` container (the entity's deltas/props/meta
   *  live in the shard and are deliberately absent). The incremental-undo capture walks this so it
   *  never faults shards. Mirrors the `NodeOccurrenceSnapshot` subset `getOccurrence` produces. */
  getOccurrenceStruct(occurrenceId: OccurrenceId): NodeOccurrenceSnapshot | undefined {
    if (!this.store.occurrenceExists(occurrenceId)) {
      return undefined;
    }
    return {
      occurrenceId,
      occId: this.store.occIdOf(occurrenceId),
      nodeId: this.store.nodeIdOf(occurrenceId),
      parentOccurrenceId: this.getParentOccurrenceId(occurrenceId),
      physicalChildOccurrenceIds: this.getChildOccurrenceIds(occurrenceId),
      occurrenceProps: this.getOccurrenceProps(occurrenceId),
      occurrenceMeta: this.getOccurrenceMetaRecord(occurrenceId),
    };
  }

  async mustGetOccurrence(occurrenceId: OccurrenceId): Promise<NodeOccurrence> {
    const node = await this.getOccurrence(occurrenceId);
    if (!node) {
      throw new NotFoundError("occurrence", occurrenceId);
    }
    return node;
  }

  async getOccurrences(nodeId: NodeId): Promise<NodeOccurrence[]> {
    const ids = await this.store.getOccurrenceIdsForNode(nodeId);
    const out: NodeOccurrence[] = [];
    for (const id of ids) {
      const occ = await this.getOccurrence(id);
      if (occ != null) {
        out.push(occ);
      }
    }
    return out;
  }

  async getCanonicalOccurrenceId(nodeId: NodeId): Promise<OccurrenceId> {
    return this.store.canonicalOccurrenceIdOf(nodeId);
  }

  async getRootOccurrences(): Promise<NodeOccurrence[]> {
    const out: NodeOccurrence[] = [];
    for (const id of this.getRootOccurrenceIds()) {
      const occ = await this.getOccurrence(id);
      if (occ != null) {
        out.push(occ);
      }
    }
    return out;
  }

  async getOccurrenceChildren(occurrenceId: OccurrenceId): Promise<NodeOccurrence[]> {
    const out: NodeOccurrence[] = [];
    for (const id of this.getChildOccurrenceIds(occurrenceId)) {
      const occ = await this.getOccurrence(id);
      if (occ != null) {
        out.push(occ);
      }
    }
    return out;
  }

  getDeltas(occurrenceId: OccurrenceId): Promise<Delta> {
    return this.store.getDeltas(occurrenceId);
  }

  async replaceDeltas(occurrenceId: OccurrenceId, deltas: Delta): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.replaceDeltas(occurrenceId, deltas);
      this.commitIfNeeded();
      this.emit([{ type: "entityUpdated", nodeId, field: "text" }]);
    });
  }

  async mark(
    occurrenceId: OccurrenceId,
    range: MarkRange,
    key: string,
    value: unknown,
  ): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.mark(occurrenceId, range, key, value);
      this.commitIfNeeded();
      this.emit([{ type: "entityUpdated", nodeId, field: "text" }]);
    });
  }

  async unmark(occurrenceId: OccurrenceId, range: MarkRange, key: string): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.unmark(occurrenceId, range, key);
      this.commitIfNeeded();
      this.emit([{ type: "entityUpdated", nodeId, field: "text" }]);
    });
  }

  getProp(occurrenceId: OccurrenceId, key: string): Promise<unknown> {
    return this.store.getProp(occurrenceId, key);
  }

  async setProp(occurrenceId: OccurrenceId, key: string, value: unknown): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.setProp(occurrenceId, key, value);
      this.commitIfNeeded();
      this.emit([{ type: "entityUpdated", nodeId, field: "props", key }]);
    });
  }

  async unsetProp(occurrenceId: OccurrenceId, key: string): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.unsetProp(occurrenceId, key);
      this.commitIfNeeded();
      this.emit([{ type: "entityUpdated", nodeId, field: "props", key }]);
    });
  }

  async setProps(occurrenceId: OccurrenceId, props: Record<string, unknown>): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.setProps(occurrenceId, props);
      this.commitIfNeeded();
      this.emit(
        Object.keys(props).map((key) => ({
          type: "entityUpdated" as const,
          nodeId,
          field: "props" as const,
          key,
        })),
      );
    });
  }

  getProps(occurrenceId: OccurrenceId): Promise<Record<string, unknown>> {
    return this.store.getProps(occurrenceId);
  }

  getEntityMeta(occurrenceId: OccurrenceId, key: string): Promise<unknown> {
    return this.store.getEntityMeta(occurrenceId, key);
  }

  async setEntityMeta(occurrenceId: OccurrenceId, key: string, value: unknown): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.setEntityMeta(occurrenceId, key, value);
      this.commitIfNeeded();
    });
  }

  async unsetEntityMeta(occurrenceId: OccurrenceId, key: string): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(async () => {
      const nodeId = this.store.nodeIdOf(occurrenceId);
      await this.captureEntityBeforeIfRecording(nodeId);
      await this.store.unsetEntityMeta(occurrenceId, key);
      this.commitIfNeeded();
    });
  }

  getEntityMetaRecord(occurrenceId: OccurrenceId): Promise<Record<string, unknown>> {
    return this.store.getEntityMetaRecord(occurrenceId);
  }

  getOccurrenceProp(occurrenceId: OccurrenceId, key: string): unknown {
    return this.store.getOccurrenceProp(occurrenceId, key);
  }

  async setOccurrenceProp(occurrenceId: OccurrenceId, key: string, value: unknown): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(() => {
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

  async unsetOccurrenceProp(occurrenceId: OccurrenceId, key: string): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(() => {
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

  async setOccurrenceMeta(occurrenceId: OccurrenceId, key: string, value: unknown): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(() => {
      this.store.setOccurrenceMeta(occurrenceId, key, value);
      this.commitIfNeeded();
    });
  }

  async unsetOccurrenceMeta(occurrenceId: OccurrenceId, key: string): Promise<void> {
    this.requireWritable();
    await this.runAutoGrouped(() => {
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

  async transact<T>(fn: () => T | Promise<T>): Promise<T> {
    // Re-entrant: a batch inside a batch joins the outer group (one undo step) instead of
    // throwing. This lets a composite op group itself while calling other grouped primitives
    // (e.g. setFieldValues → removeOccurrenceOrHardDelete, or paste → cloneOccurrence). Only
    // the outermost transact owns begin/end; inner calls run fn bare against the open group.
    if (this.inTransaction) {
      return await fn();
    }
    this.actionHistory.begin();
    this.inTransaction = true;
    this.historyActive = true; // suppress per-op auto-grouping; the transaction is the group
    try {
      const result = await fn();
      this.store.commit();
      return result;
    } finally {
      this.historyActive = false;
      this.inTransaction = false;
      await this.actionHistory.end();
    }
  }

  batch<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.transact(fn);
  }

  async undo(): Promise<boolean> {
    if (this._readonly) {
      return false;
    }
    this.historyActive = true;
    try {
      return await this.actionHistory.undo();
    } finally {
      this.historyActive = false;
    }
  }

  async redo(): Promise<boolean> {
    if (this._readonly) {
      return false;
    }
    this.historyActive = true;
    try {
      return await this.actionHistory.redo();
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

  /** Install/uninstall the before-image capture callback. ActionHistory drives this around a group
   *  so entity-mutating mutators record their pre-mutation state into its (first-touch-wins) map. */
  setEntityCapture(cb: ((nodeId: NodeId, before: NodeEntitySnapshot | null) => void) | null): void {
    this.entityCapture = cb;
  }

  /** Record `nodeId`'s pre-mutation entity if a capture is active (no-op otherwise). Called at the
   *  top of every entity-mutating mutator. Reads ONLY the touched node's shard — which the mutation
   *  is about to touch anyway, so it adds no fault-in beyond what the mutation already incurs. */
  private async captureEntityBeforeIfRecording(nodeId: NodeId): Promise<void> {
    if (this.entityCapture !== null) {
      this.entityCapture(nodeId, await this.getEntitySnapshot(nodeId));
    }
  }

  /** The entity snapshot of `nodeId` (canonical + deltas/props/meta), or null if the node is absent.
   *  Resolves nodeId → its one owning shard; never scans other shards. Public so ActionHistory can
   *  read the matching after-image at `end()` for the same touched set. */
  async getEntitySnapshot(nodeId: NodeId): Promise<NodeEntitySnapshot | null> {
    try {
      const canonicalOccurrenceId = await this.store.canonicalOccurrenceIdOf(nodeId);
      return {
        nodeId,
        canonicalOccurrenceId,
        deltas: await this.store.getDeltas(canonicalOccurrenceId),
        props: await this.store.getProps(canonicalOccurrenceId),
        meta: await this.store.getEntityMetaRecord(canonicalOccurrenceId),
      };
    } catch (e) {
      // A missing node (e.g. createNode's target before it exists) is the not-found case → null.
      // Anything else (corruption, a shard fault) propagates — the old bare catch masked those.
      if (e instanceof NotFoundError) {
        return null;
      }
      throw e;
    }
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
   *  (top-level call); runs bare when a group is already open. Two "outer owns it" signals:
   *   - `historyActive` — a transact/batch or undo/redo application is driving (the established path).
   *   - `entityCapture` active — a (possibly standalone) ActionHistory began a group and installed
   *     its before-image callback; that outer owns the grouping + capture, so this mutator runs bare
   *     and its before-image is recorded into the outer's action. */
  private async runAutoGrouped<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.historyActive || this.entityCapture !== null) {
      return await fn();
    }
    this.historyActive = true;
    this.actionHistory.begin();
    try {
      return await fn();
    } finally {
      await this.actionHistory.end();
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
