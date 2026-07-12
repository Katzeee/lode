// Main entry point
export { Engine } from "./engine.js";
export type { EngineOptions } from "./engine.js";

// Workspace
export { Workspace } from "./workspace.js";
export type { WorkspaceOptions } from "./workspace.js";

// Syncable — the opaque CRDT sync/persistence contract (closes the CRDT backend behind bytes).
export type { SyncBytes, SyncableDoc, SyncableComposite } from "./store/syncable.js";
export { SYS_PREFIX } from "./store/syncable.js";
export type { Outliner } from "./store/sharded-store.js";
export type { MetaDoc } from "./store/meta-doc.js";
export { LoroMetaDoc } from "./store/meta-doc.js";

// DocStore port — the persistence contract core owns; the runtime adapts the persistence leaf to it.
export type { DocStore, LoadedDocBytes } from "./store/doc-store.js";
export { InMemoryDocStore } from "./store/in-memory-doc-store.js";

// WorkspaceDocSet — the unified per-workspace doc collection (outliner + meta docs) the broker reads.
export { WorkspaceDocSet } from "./store/doc-set.js";
export type { DocSetEntry, SecurityClass } from "./store/doc-set.js";

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
} from "./types.js";

// Delta utilities
export { deltaToText, textToDelta } from "./delta.js";

// Serializers
export { toJSON, fromJSON } from "./serialize.js";

// Bare forest cascade (pure occurrence/canonical tree algebra over the Engine; no product guards).
// Domain wraps these with managed-child / protected-node guards for user paths.
export { applyCascade, cascadeClosure, cascadeHardDelete, cascadeRemove } from "./cascade.js";
