// Main entry point
export { Engine } from "./engine.js";
export type { EngineOptions } from "./engine.js";

// Workspace
export { Workspace } from "./workspace.js";
export type { WorkspaceOptions, DocOptions } from "./workspace.js";

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
  VersionVector,
} from "./types.js";

// Delta utilities
export { deltaToText, textToDelta } from "./delta/utils.js";

// Serializers
export { toJSON, fromJSON } from "./serializers/json.js";

// Persistence (Node.js)
export { FileStore } from "./persistence/file-store.js";
