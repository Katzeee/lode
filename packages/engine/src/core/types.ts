// ── Primitives ────────────────────────────────────────────────────────────────

export type NodeId = string;
export type OccurrenceId = string;

export type DeltaInsert = {
  insert: string;
  attributes?: Record<string, unknown>;
};
export type Delta = DeltaInsert[];

export type MarkRange = {
  start: number;
  end: number;
};

// ── Node occurrence view ──────────────────────────────────────────────────────

export type NodeOccurrence = {
  readonly nodeId: NodeId;
  readonly occurrenceId: OccurrenceId;
  readonly parentOccurrenceId: OccurrenceId | null;
  readonly canonicalOccurrenceId: OccurrenceId;
  readonly canonicalChildOccurrenceIds: OccurrenceId[];
  readonly props: Readonly<Record<string, unknown>>;
  readonly entityMeta: Readonly<Record<string, unknown>>;
  readonly occurrenceProps: Readonly<Record<string, unknown>>;
  readonly occurrenceMeta: Readonly<Record<string, unknown>>;
  readonly deltas: Delta;
};

// ── Selection (data types only — state managed at session layer, not engine) ──

export type Cursor = {
  occurrenceId: OccurrenceId;
  offset: number;
};

export type TextSelection = {
  type: "text";
  anchor: Cursor;
  focus: Cursor;
};

export type BlockSelection = {
  type: "block";
  occurrenceIds: OccurrenceId[];
};

export type Selection = TextSelection | BlockSelection | null;

// ── Notifications (slots) ─────────────────────────────────────────────────────

export type NodeUpdatedPayload =
  | { type: "entityAdded"; nodeId: NodeId; occurrenceId: OccurrenceId }
  | { type: "entityDeleted"; nodeId: NodeId }
  | { type: "entityUpdated"; nodeId: NodeId; field: "text" | "props"; key?: string }
  | {
      type: "occurrenceUpdated";
      occurrenceId: OccurrenceId;
      nodeId: NodeId;
      field: "props";
      key?: string;
    }
  | {
      type: "occurrenceAdded";
      occurrenceId: OccurrenceId;
      nodeId: NodeId;
      parentOccurrenceId: OccurrenceId | null;
    }
  | {
      type: "occurrenceMoved";
      occurrenceId: OccurrenceId;
      nodeId: NodeId;
      parentOccurrenceId: OccurrenceId | null;
    }
  | {
      type: "occurrenceDeleted";
      occurrenceId: OccurrenceId;
      nodeId: NodeId;
      parentOccurrenceId: OccurrenceId | null;
    }
  | { type: "canonicalChanged"; nodeId: NodeId; occurrenceId: OccurrenceId };

import type { Subject } from "rxjs";

export type EngineSlots = {
  nodeUpdated: Subject<NodeUpdatedPayload>;
};

// ── Serialization ─────────────────────────────────────────────────────────────

export type NodeEntitySnapshot = {
  nodeId: NodeId;
  canonicalOccurrenceId: OccurrenceId;
  deltas: Delta;
  props: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export type NodeOccurrenceSnapshot = {
  occurrenceId: OccurrenceId;
  nodeId: NodeId;
  parentOccurrenceId: OccurrenceId | null;
  physicalChildOccurrenceIds: OccurrenceId[];
  occurrenceProps: Record<string, unknown>;
  occurrenceMeta: Record<string, unknown>;
};

export type DocSnapshot = {
  version: 4;
  entities: NodeEntitySnapshot[];
  occurrences: NodeOccurrenceSnapshot[];
  rootOccurrenceIds: OccurrenceId[];
};

// ── Sync ──────────────────────────────────────────────────────────────────────

export type { VersionVector } from "loro-crdt";
