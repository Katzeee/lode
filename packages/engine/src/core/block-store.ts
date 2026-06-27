import type { VersionVector } from "loro-crdt";
import type { Delta, MarkRange, NodeId, OccurrenceId } from "./types.js";

/**
 * The storage contract the Engine depends on. The production implementation is
 * `ShardedBlockStore` (treeDoc + N content shards); the Engine is storage-agnostic so
 * domain/services above it are untouched. Undo/redo is Engine-layer (`ActionHistory`),
 * not a store concern, so the contract has no undo method.
 */
export type BlockStore = {
  // ── transaction / lifecycle ────────────────────────────────────────────────
  commit(): void;

  // ── entity (node content) CRUD ─────────────────────────────────────────────
  createEntity(
    nodeId: NodeId,
    canonicalOccurrenceId: OccurrenceId,
    props?: Record<string, unknown>,
  ): void;
  requireEntity(nodeId: NodeId): void;
  deleteEntity(nodeId: NodeId): void;
  setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): void;
  canonicalOccurrenceIdOf(nodeId: NodeId): OccurrenceId;

  // ── occurrence (tree position) CRUD ────────────────────────────────────────
  createOccurrenceRecord(
    nodeId: NodeId,
    occId: string,
    parentOccurrenceId?: OccurrenceId | null,
    index?: number,
  ): OccurrenceId;
  moveOccurrenceRecord(
    occurrenceId: OccurrenceId,
    parentOccurrenceId: OccurrenceId | null,
    index?: number,
  ): void;
  deleteOccurrenceRecord(occurrenceId: OccurrenceId): void;
  nodeIdOf(occurrenceId: OccurrenceId): NodeId;
  /** The permanent app-level occId stored on the occurrence's tree node. */
  occIdOf(occurrenceId: OccurrenceId): string;
  occurrenceExists(occurrenceId: OccurrenceId): boolean;
  getOccurrenceIdsForNode(nodeId: NodeId): OccurrenceId[];
  getRootOccurrenceIds(): OccurrenceId[];
  getParentOccurrenceId(occurrenceId: OccurrenceId): OccurrenceId | null;
  getChildOccurrenceIds(occurrenceId: OccurrenceId): OccurrenceId[];

  // ── rich text ──────────────────────────────────────────────────────────────
  getDeltas(occurrenceId: OccurrenceId): Delta;
  replaceDeltas(occurrenceId: OccurrenceId, deltas: Delta): void;
  mark(occurrenceId: OccurrenceId, range: MarkRange, key: string, value: unknown): void;
  unmark(occurrenceId: OccurrenceId, range: MarkRange, key: string): void;

  // ── entity props + meta ────────────────────────────────────────────────────
  getProp(occurrenceId: OccurrenceId, key: string): unknown;
  setProp(occurrenceId: OccurrenceId, key: string, value: unknown): void;
  unsetProp(occurrenceId: OccurrenceId, key: string): void;
  setProps(occurrenceId: OccurrenceId, props: Record<string, unknown>): void;
  getProps(occurrenceId: OccurrenceId): Record<string, unknown>;
  getEntityMeta(occurrenceId: OccurrenceId, key: string): unknown;
  setEntityMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void;
  unsetEntityMeta(occurrenceId: OccurrenceId, key: string): void;
  getEntityMetaRecord(occurrenceId: OccurrenceId): Record<string, unknown>;

  // ── occurrence props + meta ────────────────────────────────────────────────
  getOccurrenceProp(occurrenceId: OccurrenceId, key: string): unknown;
  setOccurrenceProp(occurrenceId: OccurrenceId, key: string, value: unknown): void;
  unsetOccurrenceProp(occurrenceId: OccurrenceId, key: string): void;
  getOccurrenceProps(occurrenceId: OccurrenceId): Record<string, unknown>;
  getOccurrenceMeta(occurrenceId: OccurrenceId, key: string): unknown;
  setOccurrenceMeta(occurrenceId: OccurrenceId, key: string, value: unknown): void;
  unsetOccurrenceMeta(occurrenceId: OccurrenceId, key: string): void;
  getOccurrenceMetaRecord(occurrenceId: OccurrenceId): Record<string, unknown>;

  // ── persistence / sync bytes ───────────────────────────────────────────────
  exportSnapshot(): Uint8Array;
  exportUpdateFrom(from: VersionVector): Uint8Array;
  importUpdate(bytes: Uint8Array): void;
  getVersion(): VersionVector;
};
