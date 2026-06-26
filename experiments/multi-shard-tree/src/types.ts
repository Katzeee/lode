import type { VersionVector } from "loro-crdt";

export type NodeId = string;
export type OccurrenceId = string;

/**
 * Observable view of one node (the "entity"). Content is canonical: shared by
 * every occurrence of this node (Tana-style transclusion).
 */
export type NodeView = {
  nodeId: NodeId;
  text: string;
  /** Rich-text delta (preserves marks) — the FULL content, unlike `text` (mark-stripped). */
  delta: unknown[];
  props: Record<string, unknown>;
  /** The occurrence considered this node's "home". Must be one of `occurrences`. */
  canonicalOccurrenceId: OccurrenceId;
  /** Every occurrence (position in the outline) referencing this node. */
  occurrences: OccurrenceId[];
};

/** Observable view of one position in the outline tree. */
export type OccurrenceView = {
  occurrenceId: OccurrenceId;
  nodeId: NodeId;
  parentOccurrenceId: OccurrenceId | null;
  childOccurrenceIds: OccurrenceId[];
  /** Per-occurrence meta (managed-child provenance, etc.) — lives in the treeDoc. */
  meta: Record<string, unknown>;
};

/**
 * Fully-resolved, observable tree state. This is what differential tests compare
 * and what `validateSnapshot` checks. Both the single-doc oracle and the
 * multi-shard engine must produce equivalent snapshots for equivalent op logs.
 */
export type TreeSnapshot = {
  nodes: Record<NodeId, NodeView>;
  occurrences: Record<OccurrenceId, OccurrenceView>;
  roots: OccurrenceId[];
};

/**
 * The outline contract both engines implement. Mutations + reads + the
 * structural-correctness check. Domain code (reconcile) sits on top of this and
 * never sees whether the engine is internally sharded.
 *
 * `nodeId` is always caller-supplied so two engines driven by the same op log
 * share logical identity; occurrence ids are opaque (Loro TreeIDs) and must NOT
 * be compared across engines directly — compare `canonicalStructure()` instead.
 */
export interface OutlineApi {
  // ── mutations ────────────────────────────────────────────────────────────
  /** Create a brand-new node (entity) and its canonical occurrence. */
  createNode(
    nodeId: NodeId,
    parent: OccurrenceId | null,
    index?: number,
    text?: string,
  ): OccurrenceId;
  /** Add another occurrence (position) of an existing node. Canonical unchanged. */
  createReference(targetNodeId: NodeId, parent: OccurrenceId | null, index?: number): OccurrenceId;
  moveOccurrence(occ: OccurrenceId, parent: OccurrenceId | null, index?: number): void;
  /**
   * Re-point a node's canonical occurrence to an existing occurrence of that node
   * (production's `setCanonicalOccurrence` / `promoteCanonicalOccurrence` path).
   * Canonical is MUTABLE — unlike create-time assignment, it can move. Which
   * occurrence is canonical decides what removing an occurrence does (canonical
   * removal hard-deletes the node), so this changes cascade + undo behavior.
   */
  setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): void;
  /** Remove one occurrence. If it is the canonical one, the node is hard-deleted. */
  removeOccurrence(occ: OccurrenceId): void;
  /** Remove a node entirely (entity + every occurrence of it). */
  hardDeleteNode(nodeId: NodeId): void;
  /** Replace the node's canonical text content. */
  setText(nodeId: NodeId, text: string): void;
  setEntityProp(nodeId: NodeId, key: string, value: unknown): void;
  /** Rich text: read the content as a delta (preserves marks). */
  contentDelta(nodeId: NodeId): unknown[];
  /** Rich text: replace the content with a delta (restores marks). */
  applyContentDelta(nodeId: NodeId, delta: unknown[]): void;
  /** Rich text: apply a mark to a [start, end) range. */
  markText(nodeId: NodeId, start: number, end: number, key: string, value: unknown): void;
  /** Rich text: insert a string at pos. */
  insertText(nodeId: NodeId, pos: number, str: string): void;
  /**
   * Per-occurrence meta (production's managed-child provenance lives here:
   * `managedKind` + `managedBySchemas`, the latter an array whose entries carry an
   * OCCURRENCE id that is stable across moves but churns across delete/recreate).
   * Physically on the tree node's `data`, i.e. in the treeDoc — so it syncs with
   * the structure, not the shard. Modeling it lets us verify sharding preserves
   * occurrence-level relationship data.
   */
  setOccurrenceMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void;
  getOccurrenceMeta(occurrenceId: OccurrenceId, key: string): unknown;

  // ── reads ─────────────────────────────────────────────────────────────────
  snapshot(): TreeSnapshot;
  liveNodeIds(): NodeId[];
  existsNode(nodeId: NodeId): boolean;
  existsOccurrence(occ: OccurrenceId): boolean;

  // ── correctness ───────────────────────────────────────────────────────────
  /** Throw if any structural invariant is violated (engine responsibility). */
  validateInvariants(): void;

  // ── crdt sync (engine-specific shape; see SyncAdapter for multi-replica) ──
  commit(): void;
}

export type { VersionVector };
