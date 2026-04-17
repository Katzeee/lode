// ── Primitives ────────────────────────────────────────────────────────────────

export type BlockId = string;

export interface DeltaInsert {
  insert: string;
  attributes?: Record<string, unknown>;
}
export type Delta = DeltaInsert[];

export interface MarkRange {
  start: number;
  end: number;
}

// ── Block state ────────────────────────────────────────────────────────────────

export interface BlockView {
  readonly id: BlockId;
  readonly deltas: Delta;
  readonly parentId: BlockId | null;
  readonly childIds: BlockId[];
  readonly index: number;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly isCollapsed: boolean;
  readonly isVisible: boolean;
  readonly props: Record<string, unknown>;
  readonly ext: Record<string, unknown>;
}

// ── Selection ─────────────────────────────────────────────────────────────────

export interface Cursor {
  blockId: BlockId;
  offset: number;
}

export interface TextSelection {
  type: "text";
  anchor: Cursor;
  focus: Cursor;
}

export interface BlockSelection {
  type: "block";
  blockIds: BlockId[];
}

export type Selection = TextSelection | BlockSelection | null;

// ── Events ────────────────────────────────────────────────────────────────────

export type EventOrigin = "user" | "undo" | "redo" | "import" | `peer:${string}`;

export type EngineEvent =
  | { type: "block:created"; blockId: BlockId; parentId: BlockId | null; index: number; origin: EventOrigin }
  | { type: "block:deleted"; blockId: BlockId; origin: EventOrigin }
  | { type: "block:moved"; blockId: BlockId; newParentId: BlockId | null; newIndex: number; origin: EventOrigin }
  | { type: "text:changed"; blockId: BlockId; deltas: Delta; origin: EventOrigin }
  | { type: "prop:changed"; blockId: BlockId; key: string; value: unknown; origin: EventOrigin }
  | { type: "mark:changed"; blockId: BlockId; range: MarkRange; markKey: string; value: unknown | null; origin: EventOrigin }
  | { type: "collapsed:changed"; blockId: BlockId; isCollapsed: boolean }
  | { type: "selection:changed"; selection: Selection }
  | { type: "command:executed"; name: string; args?: unknown; success: boolean }
  | { type: "history:push" }
  | { type: "history:undo"; success: boolean }
  | { type: "history:redo"; success: boolean }
  | { type: "readonly:changed"; readonly: boolean };

export type EngineEventType = EngineEvent["type"];

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  blockId: BlockId;
  range: MarkRange;
  text: string;
}

// ── Serialization ─────────────────────────────────────────────────────────────

export interface BlockSnapshot {
  id: BlockId;
  deltas: Delta;
  props: Record<string, unknown>;
  children: BlockSnapshot[];
}

export interface DocSnapshot {
  version: 2;
  blocks: BlockSnapshot[];
}
