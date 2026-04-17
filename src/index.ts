// Main entry point
export { BlockEngine, CommandChain } from "./engine.js";
export type { BlockEngineOptions } from "./engine.js";

// Types
export type {
  BlockId,
  Delta,
  DeltaInsert,
  MarkRange,
  BlockView,
  BlockSnapshot,
  DocSnapshot,
  Cursor,
  TextSelection,
  BlockSelection,
  Selection,
  EngineEvent,
  EngineEventType,
  EventOrigin,
  SearchResult,
} from "./types.js";

// Plugin system
export type {
  Plugin,
  EngineContext,
  CommandDef,
  InstalledPlugin,
} from "./plugins/index.js";

// Block spec system
export type { BlockSpec } from "./specs/index.js";
export {
  builtinSpecs,
  paragraphSpec,
  headingSpec,
  bulletSpec,
  numberedSpec,
  todoSpec,
  codeSpec,
  quoteSpec,
  dividerSpec,
} from "./specs/index.js";

// Delta utilities
export {
  getDeltaLength,
  splitDeltaAt,
  sliceDelta,
  mergeDelta,
  applyAttributes,
  toggleAttribute,
  isAttributeActiveInRange,
  getAttributeAtOffset,
  deltaToText,
  textToDelta,
  deltasEqual,
} from "./delta/utils.js";

// Selection utilities
export {
  buildCombo,
  getAttributesAtOffset as getCursorAttributes,
} from "./selection/utils.js";
export {
  isCollapsed as isCollapsedCursor,
  normalizeSelection,
  getBlockRange,
} from "./selection/model.js";

// Serializers
export { toMarkdown, fromMarkdown } from "./serializers/markdown.js";
export { toJSON, fromJSON } from "./serializers/json.js";

// Persistence (Node.js)
export { FileStore } from "./persistence/file-store.js";
