// Main entry point
export { Engine } from "./engine.js";
export type { EngineOptions } from "./engine.js";

// Workspace
export { Workspace } from "./workspace.js";
export type { WorkspaceOptions, DocOptions } from "./workspace.js";

// Syncable — the opaque CRDT sync/persistence contract (closes the CRDT backend behind bytes).
export type { SyncBytes, SyncableDoc, SyncableComposite } from "./syncable.js";
export { SYS_PREFIX } from "./syncable.js";
export type { Outliner } from "./sharded-store.js";
export type { MetaDoc } from "./meta-doc.js";
export { LoroMetaDoc } from "./meta-doc.js";

// DocStore port — the persistence contract core owns; the runtime adapts the persistence leaf to it.
export type { DocStore, LoadedDocBytes } from "./doc-store.js";
export { InMemoryDocStore } from "./in-memory-doc-store.js";

// WorkspaceDocSet — the unified per-workspace doc collection (outliner + meta docs) the broker reads.
export { WorkspaceDocSet } from "./doc-set.js";
export type { DocSetEntry, SecurityClass } from "./doc-set.js";

// Types
export type {
  Delta,
  DeltaInsert,
  MarkRange,
  NodeEntitySnapshot,
  NodeId,
  NodeOccurrence,
  NodeOccurrenceSnapshot,
  DocSnapshot,
  OccurrenceId,
  Cursor,
  TextSelection,
  BlockSelection,
  Selection,
  NodeUpdatedPayload,
  EngineSlots,
} from "./types.js";

// Delta utilities
export { deltaToText, textToDelta } from "./delta/utils.js";

// Serializers
export { toJSON, fromJSON } from "./serializers/json.js";
