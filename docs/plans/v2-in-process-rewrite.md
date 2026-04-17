# BlockEngine v2: In-Process Architecture

> Simplicity is the ultimate sophistication.
> The best code is no code. The best abstraction is no abstraction.
> Every layer that can be removed must be removed.

---

## The Fundamental Shift

v1 modeled the engine as a **subprocess**: CRDT lived in a headless process, the UI talked to it via JSON-RPC over stdio. The idea was clean in theory — any client, any language, any transport. In practice it created:

- Every mutation is `async` because of IPC roundtrips
- Two plugin layers (EnginePlugin + BlockStorePlugin) because the boundary cut through the system
- An `OutlineClient` wrapper that does nothing except serialize/deserialize what `OutlinerDoc` already provides
- `optimistic updates` + `pendingOps` + `confirmedDeltas` — complexity invented to hide IPC latency
- A test suite that spawns child processes

**tiptap and BlockSuite run in the same process as the application. That is not an implementation detail — it is the correct architecture for a store library.**

The v2 design is:

```
User Application
└── BlockEngine  (same process, same heap, direct method calls)
    ├── Loro CRDT  (in-process, synchronous)
    ├── Command registry + built-in commands
    ├── Plugin system  (single layer)
    ├── Reactive subscriptions
    └── Serializers (Markdown / JSON)
```

### What Disappears Entirely

| Directory / File | Reason |
|---|---|
| `src/rpc/` | No IPC, no JSON-RPC |
| `src/bin/serve.ts` | No subprocess to spawn |
| `src/client/outline-client.ts` | No client/server split |
| `src/engine/plugin-manager.ts` | Merged into single plugin system |
| `src/view/block-store.ts` | Replaced by `BlockEngine` |
| `src/view/context.ts` | Replaced by `EngineContext` |
| `src/view/plugin-registry.ts` | Merged into plugin system |
| `src/view/command.ts` | Rewritten as part of engine |
| Two-layer plugin model | One layer: `Plugin` |
| `optimistic updates` / `pendingOps` / `confirmedDeltas` | No IPC, no latency to hide |
| All `async` on mutations | Mutations are now synchronous |

### Before vs After

```typescript
// v1 — abandoned
const client = new OutlineClient({ command: "block-engine-serve", filePath: "doc.loro" });
await client.start();
const store = new BlockStore(client);
await store.mount();
const id = await store.createBlock();
await store.flushDeltas(id);

// v2 — target
const engine = new BlockEngine();
engine.use(myPlugin);
const id = engine.createBlock();
engine.exec("indent");
engine.chain().exec("toggleMark", "bold").exec("setBlockType", "heading").run();
```

---

## New File Structure

```
src/
  index.ts                    # Public barrel export
  engine.ts                   # BlockEngine — the single entry point class
  types.ts                    # All shared types (BlockId, Delta, BlockView, Selection, ...)

  crdt/
    doc.ts                    # Loro wrapper: block tree, undo/redo, transactions, events
    block.ts                  # Single block accessor (internal)

  delta/
    utils.ts                  # splitDeltaAt, getDeltaLength, sliceDelta, mergeDelta,
                              #   applyAttributes, deltaToText, textToDelta, deltasEqual

  selection/
    model.ts                  # Selection type + cursor operations
    utils.ts                  # buildCombo, getAttributesAtOffset

  commands/
    index.ts                  # registerBuiltins() — registers all built-in commands
    tree.ts                   # indent, outdent, moveUp, moveDown, toggleCollapsed
    text.ts                   # splitBlock, mergeBlockWithPrev, deleteSelection
    marks.ts                  # toggleMark, setMark, unsetMark
    history.ts                # undo, redo (thin wrappers with focus management)

  plugins/
    index.ts                  # Plugin interface, PluginManager

  specs/
    index.ts                  # BlockSpec registry — lightweight type system

  serializers/
    markdown.ts               # toMarkdown / fromMarkdown
    json.ts                   # toJSON / fromJSON (human-readable, not Loro binary)

  persistence/
    file-store.ts             # FileStore: save/load Loro binary snapshot (Node.js)
```

Total target: ~1,200 lines of source. v1 was ~2,600 lines including the RPC machinery.

---

## Part 1 — Core Types (`src/types.ts`)

```typescript
// ── Primitives ────────────────────────────────────────────────────────────────

export type BlockId = string;

export interface DeltaInsert {
  insert: string;
  attributes?: Record<string, unknown>;
}
export type Delta = DeltaInsert[];

export interface MarkRange {
  start: number; // inclusive
  end: number;   // exclusive
}

// ── Block state ────────────────────────────────────────────────────────────────

export interface BlockView {
  readonly id: BlockId;
  // Text content
  readonly deltas: Delta;
  // Tree
  readonly parentId: BlockId | null;
  readonly childIds: BlockId[];
  readonly index: number;          // position among siblings (0-based)
  // Derived tree properties (computed, cached by engine)
  readonly depth: number;          // distance from root (root children = 0)
  readonly hasChildren: boolean;   // childIds.length > 0
  // Outliner state
  readonly isCollapsed: boolean;   // stored in Loro props under "_collapsed"
  readonly isVisible: boolean;     // false if any ancestor is collapsed
  // User data
  readonly props: Record<string, unknown>;
  // Plugin-private data (never persisted to Loro)
  readonly ext: Record<string, unknown>;
}

// ── Selection ──────────────────────────────────────────────────────────────────

export interface Cursor {
  blockId: BlockId;
  offset: number;
}

export interface TextSelection {
  type: "text";
  anchor: Cursor;  // where selection started
  focus: Cursor;   // where selection ends (may be before anchor)
}

export interface BlockSelection {
  type: "block";
  blockIds: BlockId[];
}

export type Selection = TextSelection | BlockSelection | null;

// ── Events ────────────────────────────────────────────────────────────────────

export type EventOrigin = "user" | "undo" | "redo" | "import" | `peer:${string}`;

export type EngineEvent =
  | { type: "block:created";    blockId: BlockId; parentId: BlockId | null; index: number; origin: EventOrigin }
  | { type: "block:deleted";    blockId: BlockId; origin: EventOrigin }
  | { type: "block:moved";      blockId: BlockId; newParentId: BlockId | null; newIndex: number; origin: EventOrigin }
  | { type: "text:changed";     blockId: BlockId; deltas: Delta; origin: EventOrigin }
  | { type: "prop:changed";     blockId: BlockId; key: string; value: unknown; origin: EventOrigin }
  | { type: "mark:changed";     blockId: BlockId; range: MarkRange; markKey: string; value: unknown | null; origin: EventOrigin }
  | { type: "collapsed:changed"; blockId: BlockId; isCollapsed: boolean }
  | { type: "selection:changed"; selection: Selection }
  | { type: "command:executed"; name: string; args?: unknown; success: boolean }
  | { type: "history:push" }
  | { type: "history:undo";     success: boolean }
  | { type: "history:redo";     success: boolean }
  | { type: "readonly:changed"; readonly: boolean };

export type EngineEventType = EngineEvent["type"];

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  blockId: BlockId;
  range: MarkRange;
  text: string;    // matched text
}

// ── Serialization ─────────────────────────────────────────────────────────────

export interface BlockSnapshot {
  id: BlockId;
  deltas: Delta;
  props: Record<string, unknown>;
  children: BlockSnapshot[];  // nested tree, not flat
}

export interface DocSnapshot {
  version: 2;
  blocks: BlockSnapshot[];   // root-level blocks
}
```

---

## Part 2 — Delta Utilities (`src/delta/utils.ts`)

These are pure functions. No engine dependency. The fundamental building blocks for split/merge/format.

```typescript
/** Total character count of a delta sequence. */
export function getDeltaLength(deltas: Delta): number

/** Split a delta at a character offset. Returns [before, after].
 *  Preserves attributes across the split point. */
export function splitDeltaAt(deltas: Delta, offset: number): [Delta, Delta]

/** Extract a sub-range from a delta. */
export function sliceDelta(deltas: Delta, start: number, end: number): Delta

/** Concatenate two deltas, merging adjacent spans with identical attributes. */
export function mergeDelta(a: Delta, b: Delta): Delta

/** Apply attribute overrides to a range, returning a new delta.
 *  Pass null as attribute value to remove an attribute. */
export function applyAttributes(
  deltas: Delta,
  start: number,
  end: number,
  attrs: Record<string, unknown | null>
): Delta

/** Toggle an attribute over a range:
 *  - If the attribute is active on the entire range, remove it.
 *  - Otherwise, apply it to the full range.
 *  "Active" means every character in [start, end) has the attribute. */
export function toggleAttribute(
  deltas: Delta,
  start: number,
  end: number,
  key: string,
  value: unknown
): Delta

/** True if every character in [start, end) has the given attribute. */
export function isAttributeActiveInRange(
  deltas: Delta,
  start: number,
  end: number,
  key: string
): boolean

/** Retrieve the attribute value at a given offset (null if absent). */
export function getAttributeAtOffset(
  deltas: Delta,
  offset: number,
  key: string
): unknown

/** Collapse delta to plain text. */
export function deltaToText(deltas: Delta): string

/** Wrap plain text as a single-span delta. */
export function textToDelta(text: string): Delta

/** Deep equality for deltas. */
export function deltasEqual(a: Delta, b: Delta): boolean
```

---

## Part 3 — CRDT Layer (`src/crdt/doc.ts`)

The Loro wrapper is simplified: no RPC registration, no hook pipeline for external plugins (hooks are handled by the engine's plugin system), no event batching for IPC. Just a clean synchronous document model.

```typescript
export class BlockDoc {
  constructor(bytes?: Uint8Array) {}

  // ── Readonly ────────────────────────────────────────────────────────────────
  get readonly(): boolean
  setReadonly(val: boolean): void

  // ── Block CRUD ──────────────────────────────────────────────────────────────
  createBlock(parentId?: BlockId, index?: number): BlockId
  deleteBlock(id: BlockId): void
  moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): void

  // ── Text ────────────────────────────────────────────────────────────────────
  getDeltas(id: BlockId): Delta
  replaceDeltas(id: BlockId, deltas: Delta): void
  mark(id: BlockId, range: MarkRange, key: string, value: unknown): void
  unmark(id: BlockId, range: MarkRange, key: string): void

  // ── Props ───────────────────────────────────────────────────────────────────
  getProp(id: BlockId, key: string): unknown
  setProp(id: BlockId, key: string, value: unknown): void
  getProps(id: BlockId): Record<string, unknown>

  // ── Tree queries ────────────────────────────────────────────────────────────
  getRootIds(): BlockId[]
  getParentId(id: BlockId): BlockId | null
  getChildIds(id: BlockId): BlockId[]
  getAllIds(): BlockId[]         // DFS order
  exists(id: BlockId): boolean

  // ── History ─────────────────────────────────────────────────────────────────
  transact(fn: () => void): void
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean

  // ── Persistence ─────────────────────────────────────────────────────────────
  export(): Uint8Array
  import(bytes: Uint8Array): void

  // ── Events ──────────────────────────────────────────────────────────────────
  // Fires synchronously after each mutation (or after transact() completes).
  // Returns a list of fine-grained EngineEvents describing what changed.
  subscribe(listener: (events: EngineEvent[]) => void): () => void
}
```

Key changes from v1 `OutlinerDoc`:
- No `Block` wrapper class exposed publicly — ids are the currency
- No `BeforeHook` / `AfterHook` infrastructure — the engine handles that via plugin `onBefore`
- `subscribe` fires synchronously and in-process — no serialization overhead
- `createBlock` returns `BlockId` directly (was returning `Block` object)

---

## Part 4 — Main Engine (`src/engine.ts`)

`BlockEngine` is the single facade users interact with. It owns the `BlockDoc`, maintains the `BlockView` cache, manages plugins and commands, and exposes the full API.

### 4.1 Constructor and Lifecycle

```typescript
export interface BlockEngineOptions {
  /** Initial document bytes (Loro binary). Omit to start empty. */
  initialBytes?: Uint8Array;
  /** If true, all mutations throw. */
  readonly?: boolean;
  /** History merge window in ms (0 = never merge). Default: 500 */
  historyMergeInterval?: number;
}

export class BlockEngine {
  constructor(options?: BlockEngineOptions)

  /** Install a plugin. Must be called before mount(). */
  use(plugin: Plugin): this

  /** Initialize: runs plugin install hooks, populates BlockView cache. */
  mount(): void

  /** Tear down: disposes all plugins, clears subscriptions. */
  unmount(): void
}
```

### 4.2 Block Operations (synchronous)

```typescript
// ── CRUD ────────────────────────────────────────────────────────────────────────

createBlock(parentId?: BlockId, index?: number): BlockId
deleteBlock(id: BlockId): void
moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): void

// ── Outliner-specific ────────────────────────────────────────────────────────────

/**
 * Make `id` the last child of its previous sibling.
 * No-op if `id` has no previous sibling.
 */
indent(id: BlockId): void

/**
 * Make `id` the next sibling of its parent.
 * No-op if `id` is already at root level.
 */
outdent(id: BlockId): void

/** Swap `id` with its previous sibling. */
moveUp(id: BlockId): void

/** Swap `id` with its next sibling. */
moveDown(id: BlockId): void

// ── Split / Merge ─────────────────────────────────────────────────────────────────

/**
 * Split block `id` at `offset`.
 * - Deltas after offset move to a new block inserted immediately after `id`.
 * - If `id` has children and offset is at end, new block becomes first child.
 * - Otherwise, new block is the next sibling.
 * - Marks spanning the split point are preserved on both sides.
 * - Returns the new block's id.
 * - Updates selection to { type: "text", anchor: { blockId: newId, offset: 0 }, focus: same }.
 */
splitBlock(id: BlockId, offset: number): BlockId

/**
 * Merge `id` into the block immediately before it in DFS order.
 * - Appends `id`'s deltas to the predecessor's deltas.
 * - `id`'s children are re-parented to the predecessor (appended to its children).
 * - `id` is deleted.
 * - Updates selection to the junction point in the predecessor.
 */
mergeBlockWithPrev(id: BlockId): void

// ── Collapse (outliner fold state) ────────────────────────────────────────────────

setCollapsed(id: BlockId, collapsed: boolean): void
toggleCollapsed(id: BlockId): void
isCollapsed(id: BlockId): boolean
```

### 4.3 Text and Marks

```typescript
// ── Text ─────────────────────────────────────────────────────────────────────────

/** Replace the entire text content of a block. */
replaceDeltas(id: BlockId, deltas: Delta): void

// ── Mark operations (explicit range) ─────────────────────────────────────────────

mark(id: BlockId, range: MarkRange, key: string, value: unknown): void
unmark(id: BlockId, range: MarkRange, key: string): void

// ── Mark operations (selection-aware) ────────────────────────────────────────────

/**
 * Apply a mark to the current selection.
 * If the selection spans multiple blocks, applies to each block's portion.
 * Has no effect if selection is null.
 */
setMark(key: string, value: unknown): void

/** Remove a mark from the current selection. */
unsetMark(key: string): void

/**
 * Toggle a mark over the current selection.
 * If the mark is active on every character in the selection, removes it.
 * Otherwise, applies it to the entire selection.
 */
toggleMark(key: string, value?: unknown): void
```

### 4.4 Props and Block Type

```typescript
setProp(id: BlockId, key: string, value: unknown): void
getProp(id: BlockId, key: string): unknown

/**
 * Set the block type. Validates against registered specs (if any).
 * Convenience for setProp(id, "type", type).
 */
setBlockType(id: BlockId, type: string): void
getBlockType(id: BlockId): string | undefined
```

### 4.5 Queries

```typescript
// ── BlockView cache ───────────────────────────────────────────────────────────────

getBlock(id: BlockId): BlockView | undefined
getRootIds(): BlockId[]
getAllBlockIds(): BlockId[]    // DFS order, respects tree structure

// ── Visibility (outliner-aware) ───────────────────────────────────────────────────

/**
 * Returns all block IDs that should be visible in the current collapsed state.
 * Collapsed blocks' descendants are excluded.
 * Order: DFS pre-order (same as getAllBlockIds but filtered).
 */
getVisibleIds(): BlockId[]

// ── Tree navigation ───────────────────────────────────────────────────────────────

getNext(id: BlockId): BlockView | undefined   // next in DFS order
getPrev(id: BlockId): BlockView | undefined   // prev in DFS order
getNextSibling(id: BlockId): BlockView | undefined
getPrevSibling(id: BlockId): BlockView | undefined
getParent(id: BlockId): BlockView | undefined
getChildren(id: BlockId): BlockView[]
getDescendants(id: BlockId): BlockId[]        // DFS, all levels
getAncestors(id: BlockId): BlockId[]          // [root→parent], nearest last
getDepth(id: BlockId): number                 // 0 = root child
getSiblings(id: BlockId): BlockId[]           // all siblings including self

// ── Search ────────────────────────────────────────────────────────────────────────

search(query: string | RegExp, scope?: BlockId): SearchResult[]
```

### 4.6 Selection

```typescript
getSelection(): Selection
setSelection(sel: Selection): void

// ── Derived selection queries ─────────────────────────────────────────────────────

/** True if selection is a TextSelection with anchor === focus. */
isCollapsedCursor(): boolean

/**
 * Returns the selection range within `blockId`'s deltas, or null if the block
 * is not included in the current selection.
 * For a TextSelection spanning multiple blocks, returns [0, length] for middle
 * blocks and the appropriate partial range for anchor/focus blocks.
 */
getSelectionRange(blockId: BlockId): MarkRange | null

collapseToStart(): void    // move focus to anchor position
collapseToEnd(): void      // move anchor to focus position

/** Select all content in a block (TextSelection from 0 to length). */
selectBlock(id: BlockId): void

/** Select all root-level blocks (BlockSelection). */
selectAll(): void

// ── Mark queries (selection-aware) ───────────────────────────────────────────────

/**
 * True if every character in the current selection has the mark active.
 * For BlockSelection, checks the entire text of each selected block.
 */
isMarkActive(key: string): boolean
getMarkValue(key: string): unknown    // value at anchor cursor, or null
```

### 4.7 History

```typescript
undo(): boolean
redo(): boolean
canUndo(): boolean
canRedo(): boolean

/**
 * Group a set of mutations into a single undo step and notify
 * subscribers exactly once after all mutations complete.
 */
batch(fn: () => void): void
```

### 4.8 Command System

```typescript
// ── Registration ──────────────────────────────────────────────────────────────────

registerCommand(name: string, def: CommandDef): void

// ── Execution ─────────────────────────────────────────────────────────────────────

/** Execute a command. Returns true if command ran, false if can() returned false. */
exec(name: string, args?: unknown): boolean

/** Check if a command would execute (calls can() if defined). */
can(name: string, args?: unknown): boolean

/** Begin a chainable command sequence. */
chain(): CommandChain
```

### 4.9 Reactive Subscriptions

```typescript
subscribeBlock(id: BlockId, listener: () => void): () => void
subscribeTree(listener: () => void): () => void
subscribeSelection(listener: () => void): () => void

/**
 * Subscribe to specific engine events.
 * Returns an unsubscribe function.
 */
on<T extends EngineEventType>(
  event: T,
  handler: (e: Extract<EngineEvent, { type: T }>) => void
): () => void
```

### 4.10 Plugin Integration

```typescript
getPlugin<T = unknown>(name: string): T | undefined
```

### 4.11 Serialization

```typescript
// ── Markdown ──────────────────────────────────────────────────────────────────────

/** Export a subtree (or entire doc if no id) as Markdown. */
toMarkdown(rootId?: BlockId): string

/** Import Markdown, replacing the current document (or a subtree). */
fromMarkdown(text: string, parentId?: BlockId): void

// ── Plain JSON ────────────────────────────────────────────────────────────────────

/** Human-readable nested JSON (not Loro binary). */
toJSON(rootId?: BlockId): DocSnapshot

/** Import from DocSnapshot, replacing the current document. */
fromJSON(snapshot: DocSnapshot, parentId?: BlockId): void

// ── Loro binary ───────────────────────────────────────────────────────────────────

/** Loro binary snapshot — for persistence (FileStore, IndexedDB, etc.). */
export(): Uint8Array

/** Import Loro binary and refresh all block views. */
import(bytes: Uint8Array): void
```

### 4.12 Readonly

```typescript
get readonly(): boolean
set readonly(val: boolean)
```

---

## Part 5 — Selection Utilities (`src/selection/`)

### `src/selection/model.ts`

```typescript
/** Returns true if anchor and focus are at the same position. */
export function isCollapsed(sel: TextSelection): boolean

/** Normalize a TextSelection so anchor always comes before focus in document order. */
export function normalizeSelection(
  sel: TextSelection,
  getBlock: (id: BlockId) => BlockView | undefined
): TextSelection

/** Get the bounding range of a TextSelection within a single block.
 *  Returns null if the block is not part of the selection. */
export function getBlockRange(
  blockId: BlockId,
  sel: TextSelection,
  getBlock: (id: BlockId) => BlockView | undefined
): MarkRange | null
```

### `src/selection/utils.ts`

```typescript
export function buildCombo(
  key: string,
  modifiers: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean },
  platform?: "mac" | "other"
): string

export function getAttributeAtOffset(deltas: Delta, offset: number): Record<string, unknown>
```

---

## Part 6 — Plugin System (`src/plugins/index.ts`)

Single layer. No EnginePlugin vs BlockStorePlugin split.

```typescript
export interface CommandDef {
  /**
   * Execute the command. Return value is ignored.
   * Mutations made inside execute() are automatically batched into
   * a single undo step and emit one subscriber notification.
   */
  execute(ctx: EngineContext, args?: unknown): void;

  /**
   * Return false to prevent execution (exec() returns false).
   * Omit to always allow.
   */
  can?(ctx: EngineContext, args?: unknown): boolean;
}

export interface Plugin {
  readonly name: string;
  readonly priority?: number;    // lower runs first; default 100

  /** Per-plugin storage, isolated from other plugins. */
  defaultStorage?(): Record<string, unknown>;

  /**
   * Called during engine.mount().
   * Return dispose() to clean up on engine.unmount().
   */
  install(ctx: EngineContext): { dispose(): void };

  /** Expose a typed API to other plugins via engine.getPlugin(name). */
  getPublicApi?(): unknown;
}

export interface InstalledPlugin {
  dispose(): void;
}

// ── EngineContext ─────────────────────────────────────────────────────────────────
// Passed to plugins and commands. Identical surface to BlockEngine's public API,
// plus plugin-private storage.

export interface EngineContext {
  // All BlockEngine public methods (exact same signatures)
  readonly engine: BlockEngine;

  // Plugin-private per-instance storage
  storage: Record<string, unknown>;

  // Inter-plugin communication
  getPlugin<T = unknown>(name: string): T | undefined;

  // Event subscription (plugins can listen to engine events)
  on<T extends EngineEventType>(
    event: T,
    handler: (e: Extract<EngineEvent, { type: T }>) => void
  ): () => void;
}
```

**Key decision**: `EngineContext` exposes `engine` directly. Plugins do `ctx.engine.createBlock()` rather than going through a separate proxy. This removes indirection and makes the type system trivial — plugins have exactly the same power as user code.

---

## Part 7 — Block Spec System (`src/specs/index.ts`)

Lightweight. Not a schema validator — just a type registry that lets plugins and serializers know what block types exist.

```typescript
export interface BlockSpec {
  /** Block type identifier (stored in props["type"]). */
  readonly type: string;

  /** Default props when a block of this type is created. */
  defaultProps?(): Record<string, unknown>;

  /**
   * Which block types are allowed as direct children.
   * Omit / null = any type allowed.
   */
  allowedChildren?: string[] | null;

  /**
   * Commands specific to this block type.
   * Registered automatically when the spec is registered.
   */
  commands?: Record<string, CommandDef>;

  /**
   * Markdown serialization for this type.
   * If omitted, falls back to paragraph serialization.
   */
  markdown?: {
    serialize(block: BlockView, children: string): string;
    deserialize?(line: string): { props: Record<string, unknown>; text: string } | null;
  };
}

// Usage:
engine.registerSpec(headingSpec);
engine.getSpec("heading");     // → BlockSpec | undefined
engine.getRegisteredTypes();   // → string[]
```

Built-in specs (registered by `registerBuiltins()`):
- `"paragraph"` (default)
- `"heading"` (props: `{ level: 1 | 2 | 3 | 4 | 5 | 6 }`)
- `"bullet"` (unordered list item)
- `"numbered"` (ordered list item, props: `{ order?: number }`)
- `"todo"` (props: `{ checked: boolean }`)
- `"code"` (props: `{ language?: string }`)
- `"quote"`
- `"divider"` (no text content)

---

## Part 8 — Built-in Commands (`src/commands/`)

All commands are registered during `engine.mount()` by `registerBuiltins(engine)`. They are named with a consistent convention. Users can override any by re-registering with the same name.

### `src/commands/tree.ts`

```typescript
// "indent" — make block last child of previous sibling
// args: { blockId: BlockId } | undefined (uses selection if omitted)
// can: false if no previous sibling exists

// "outdent" — lift block to be next sibling of parent
// args: { blockId: BlockId } | undefined
// can: false if already at root level

// "moveUp" — swap with previous sibling
// args: { blockId: BlockId } | undefined
// can: false if first sibling

// "moveDown" — swap with next sibling
// args: { blockId: BlockId } | undefined
// can: false if last sibling

// "toggleCollapsed" — toggle fold state
// args: { blockId: BlockId } | undefined
// can: false if block has no children
```

### `src/commands/text.ts`

```typescript
// "splitBlock"
// args: { blockId: BlockId; offset: number } | undefined (uses selection cursor)
// can: false if selection is null or readonly

// "mergeBlockWithPrev"
// args: { blockId: BlockId } | undefined
// can: false if no previous block in DFS order, or at root start

// "deleteSelection"
// Deletes all selected blocks (BlockSelection) or selected text (TextSelection).
// For partial text selection: removes text, keeps block.
// For TextSelection spanning multiple blocks: keeps anchor block with text up to
// anchor offset + focus text from focus offset, deletes intermediate blocks.
// can: false if selection is null
```

### `src/commands/marks.ts`

```typescript
// "toggleMark" — toggle over selection
// args: { key: string; value?: unknown }
// can: false if selection is null or readonly

// "setMark" — apply over selection
// args: { key: string; value: unknown }
// can: false if selection is null or readonly

// "unsetMark" — remove from selection
// args: { key: string }
// can: false if selection is null or readonly

// "setBlockType" — set props["type"] and merge defaultProps
// args: { type: string; blockId?: BlockId }
// can: false if type is not registered and strict mode is on
```

### `src/commands/history.ts`

```typescript
// "undo"
// can: engine.canUndo()

// "redo"
// can: engine.canRedo()
```

### Command name conventions

```
tree:    indent  outdent  moveUp  moveDown  toggleCollapsed
text:    splitBlock  mergeBlockWithPrev  deleteSelection
marks:   toggleMark  setMark  unsetMark
type:    setBlockType
history: undo  redo
```

---

## Part 9 — Serializers (`src/serializers/`)

### `src/serializers/markdown.ts`

```typescript
/**
 * Serialize a BlockEngine document (or subtree) to Markdown.
 *
 * Indentation: each nesting level adds two spaces or a nested list marker.
 * Block type mapping:
 *   paragraph → plain text paragraph
 *   heading   → # / ## / ### ... based on props.level
 *   bullet    → "- text"
 *   numbered  → "1. text"
 *   todo      → "- [ ] text" / "- [x] text"
 *   code      → ```lang\n...\n```
 *   quote     → "> text"
 *   divider   → "---"
 *   (unknown) → plain text paragraph
 *
 * Delta → inline Markdown:
 *   bold  → **text**
 *   italic → _text_
 *   code  → `text`
 *   link  → [text](href)
 *   (unknown mark) → text (mark attributes dropped)
 */
export function toMarkdown(
  engine: BlockEngine,
  rootId?: BlockId
): string

/**
 * Parse Markdown into blocks, appended under parentId (or at root).
 * Creates blocks with appropriate types and props.
 *
 * Inline parsing:
 *   **text** / __text__ → bold mark
 *   *text* / _text_     → italic mark
 *   `code`              → code mark
 *   [text](href)        → link mark with { href }
 */
export function fromMarkdown(
  engine: BlockEngine,
  text: string,
  parentId?: BlockId
): BlockId[]    // IDs of the created top-level blocks
```

### `src/serializers/json.ts`

```typescript
/**
 * Export as a human-readable nested JSON tree.
 * DocSnapshot.blocks is an array of nested BlockSnapshot objects.
 */
export function toJSON(engine: BlockEngine, rootId?: BlockId): DocSnapshot

/**
 * Import from DocSnapshot. Creates blocks preserving IDs if they don't conflict,
 * otherwise generates new IDs.
 */
export function fromJSON(
  engine: BlockEngine,
  snapshot: DocSnapshot,
  parentId?: BlockId
): BlockId[]
```

---

## Part 10 — CommandChain (`src/engine.ts` inline)

```typescript
export class CommandChain {
  constructor(private engine: BlockEngine) {}

  exec(name: string, args?: unknown): this {
    this._steps.push({ name, args });
    return this;
  }

  /**
   * Run all queued commands in sequence inside a single batch().
   * Returns true if all commands returned true.
   */
  run(): boolean {
    let allOk = true;
    this.engine.batch(() => {
      for (const step of this._steps) {
        if (!this.engine.exec(step.name, step.args)) allOk = false;
      }
    });
    return allOk;
  }
}
```

---

## Part 11 — Public Exports (`src/index.ts`)

```typescript
// Main entry point
export { BlockEngine } from "./engine.js";
export type { BlockEngineOptions } from "./engine.js";

// Types
export type {
  BlockId, Delta, DeltaInsert, MarkRange,
  BlockView, BlockSnapshot, DocSnapshot,
  Cursor, TextSelection, BlockSelection, Selection,
  EngineEvent, EngineEventType, EventOrigin,
  SearchResult,
} from "./types.js";

// Plugin system
export type { Plugin, EngineContext, CommandDef, InstalledPlugin } from "./plugins/index.js";

// Block spec system
export type { BlockSpec } from "./specs/index.js";

// Command chain
export { CommandChain } from "./engine.js";

// Delta utilities (framework authors need these for input handling)
export {
  getDeltaLength, splitDeltaAt, sliceDelta, mergeDelta,
  applyAttributes, toggleAttribute, isAttributeActiveInRange,
  getAttributeAtOffset, deltaToText, textToDelta, deltasEqual,
} from "./delta/utils.js";

// Selection utilities
export { buildCombo, getAttributeAtOffset as getCursorAttributes } from "./selection/utils.js";
export { isCollapsed as isCollapsedCursor, normalizeSelection, getBlockRange } from "./selection/model.js";

// Serializers (tree-shakeable)
export { toMarkdown, fromMarkdown } from "./serializers/markdown.js";
export { toJSON, fromJSON } from "./serializers/json.js";

// Persistence (Node.js)
export { FileStore } from "./persistence/file-store.js";
```

---

## Part 12 — BlockView Cache Implementation Notes

The engine maintains a `Map<BlockId, BlockView>` cache. Every mutation that changes the CRDT fires `doc.subscribe()`, which rebuilds the affected `BlockView` entries and triggers listeners.

### Computed field strategy

| Field | Strategy |
|---|---|
| `deltas` | Read from Loro on each update, cached |
| `parentId`, `childIds`, `index` | Read from Loro tree on each update |
| `depth` | Computed from `parentId` chain on update, cached |
| `hasChildren` | `childIds.length > 0`, trivial |
| `isCollapsed` | Read from `props["_collapsed"]` (Loro-persisted) |
| `isVisible` | Computed from ancestor `isCollapsed` chain on update |
| `props` | Read from Loro on each update |
| `ext` | Never persisted; lives in a parallel `Map<BlockId, Record>` |

### Notification strategy

When a mutation fires:
1. Determine which `BlockId`s were affected (from CRDT events)
2. Rebuild `BlockView` for each affected id
3. Recompute `depth` and `isVisible` for all descendants if a move/collapse happened
4. Call `subscribeBlock` listeners for each changed id
5. Call `subscribeTree` listener if tree structure changed
6. All of this happens synchronously before `exec()` / `createBlock()` / etc. returns

Inside `batch()`, steps 3-6 are deferred until the batch function returns.

---

## Part 13 — Implementation Order

### Phase 0: Delete (Day 1)

Remove everything that no longer exists in the design:

```
DELETE: src/rpc/
DELETE: src/bin/
DELETE: src/client/
DELETE: src/engine/
DELETE: src/view/
DELETE: tests/rpc/
DELETE: tests/client/
DELETE: tests/view/   (will be replaced)
DELETE: tests/e2e/    (will be replaced)
```

Keep:
```
KEEP (adapt): src/crdt/block.ts → becomes internal only, no public export
KEEP (adapt): src/crdt/outliner-doc.ts → becomes src/crdt/doc.ts
KEEP (keep):  src/persistence/file-store.ts
KEEP (keep):  src/crdt/types.ts → merge into src/types.ts
```

Remove from `package.json` dependencies: nothing (loro-crdt stays).
Add to `devDependencies` if missing: nothing new.

---

### Phase 1: Types + Delta Utils (Day 1-2)

1. Write `src/types.ts` (all types from Part 1)
2. Write `src/delta/utils.ts` (all functions from Part 2)
3. Write tests: `tests/delta/utils.test.ts`
   - `splitDeltaAt`: split at 0, middle, end, across multiple spans
   - `mergeDelta`: adjacent same-attributes merge, different-attributes stay separate
   - `sliceDelta`: partial span, boundary conditions
   - `toggleAttribute`: full active → remove; partial → apply all; none → apply all
   - `isAttributeActiveInRange`: all active, partial, none

**These are pure functions. Test them in isolation. Get them right before anything else depends on them.**

---

### Phase 2: CRDT Layer (Day 2-3)

1. Write `src/crdt/doc.ts` (BlockDoc from Part 3)
2. Write tests: `tests/crdt/doc.test.ts`
   - Block CRUD (create, delete, move)
   - Delta replace, mark, unmark
   - Props
   - Tree queries (getRootIds, getChildIds, getAllIds)
   - Undo/redo, transact()
   - Export/import round-trip
   - subscribe() fires correctly for each operation type
   - readonly mode

---

### Phase 3: BlockEngine Core (Day 3-5)

1. Write `src/engine.ts`:
   - BlockView cache management
   - `createBlock`, `deleteBlock`, `moveBlock`
   - `replaceDeltas`, `mark`, `unmark`
   - `setProp`, `getBlockType`, `setBlockType`
   - `setCollapsed`, `isCollapsed`, `toggleCollapsed`
   - `getBlock`, `getRootIds`, `getAllBlockIds`, `getVisibleIds`
   - `getNext`, `getPrev`, `getAncestors`, `getDepth`, `getSiblings`, ...
   - `getSelection`, `setSelection`
   - `isMarkActive`, `getMarkValue`, `getSelectionRange`
   - `isCollapsedCursor`, `collapseToStart`, `collapseToEnd`, `selectBlock`, `selectAll`
   - `subscribeBlock`, `subscribeTree`, `subscribeSelection`, `on()`
   - `undo`, `redo`, `canUndo`, `canRedo`, `batch()`
   - `export`, `import`
   - `mount`, `unmount`, `use`
   - `search`

2. Write tests: `tests/engine/core.test.ts`
   - All CRUD + query methods
   - BlockView computed fields (depth, isVisible, isCollapsed, hasChildren, index)
   - Subscriber notification patterns (batch, single mutation)
   - Undo/redo
   - Readonly mode

---

### Phase 4: Selection and Mark Operations (Day 5-6)

1. Write `src/selection/model.ts`, `src/selection/utils.ts`
2. Add to engine: `setMark`, `unsetMark`, `toggleMark` (selection-aware)
3. Add to engine: `splitBlock`, `mergeBlockWithPrev`

4. Write tests: `tests/engine/selection.test.ts`
   - `getSelectionRange` for single block, multi-block spanning
   - `toggleMark` on empty selection, partial, full
   - `splitBlock` at start, middle, end; with/without children
   - `mergeBlockWithPrev` with children, with marks at boundary

---

### Phase 5: Plugin System + Command System (Day 6-7)

1. Write `src/plugins/index.ts` (Plugin, EngineContext, PluginManager)
2. Write `src/commands/tree.ts`, `text.ts`, `marks.ts`, `history.ts`
3. Write `src/commands/index.ts` (registerBuiltins)
4. Add `registerCommand`, `exec`, `can`, `chain()` to engine

5. Write tests: `tests/engine/commands.test.ts`
   - `indent`: normal case, no prev sibling (no-op), undo
   - `outdent`: normal case, already root (no-op), undo
   - `moveUp`, `moveDown`
   - `splitBlock` via command (uses selection)
   - `mergeBlockWithPrev` via command
   - `toggleMark` via command
   - `chain().exec().exec().run()`: all succeed, first fails (chain aborts)
   - `can()` correctly returns false for blocked commands

---

### Phase 6: Block Specs (Day 7)

1. Write `src/specs/index.ts`
2. Register built-in specs in `registerBuiltins()`
3. Write tests: `tests/engine/specs.test.ts`
   - Register spec, retrieve spec
   - `setBlockType` applies defaultProps
   - Built-in types all registered correctly

---

### Phase 7: Serializers (Day 8-9)

1. Write `src/serializers/markdown.ts`
2. Write `src/serializers/json.ts`
3. Add `toMarkdown`, `fromMarkdown`, `toJSON`, `fromJSON` to engine (delegate to serializers)

4. Write tests: `tests/serializers/markdown.test.ts`
   - Heading levels, bullet/numbered/todo/code/quote/divider
   - Nested blocks (indentation)
   - Inline marks: bold, italic, code, link
   - Round-trip: `fromMarkdown(toMarkdown(engine))` preserves structure
   - Markdown → blocks → Markdown identity (for supported types)

5. Write tests: `tests/serializers/json.test.ts`
   - Round-trip: `fromJSON(toJSON(engine))` recreates identical structure
   - Subtree export/import

---

### Phase 8: Wiring + Public Export (Day 9)

1. Write `src/index.ts` per Part 11
2. Verify tree-shaking: `toMarkdown` import doesn't pull in `toJSON`
3. Run full test suite: target 0 failures

---

## Part 14 — Test Strategy

### Target coverage by module

| Module | Test file | Focus |
|---|---|---|
| `delta/utils` | `tests/delta/utils.test.ts` | Pure functions, edge cases |
| `crdt/doc` | `tests/crdt/doc.test.ts` | CRDT correctness, event firing |
| `engine/core` | `tests/engine/core.test.ts` | BlockView cache, subscriptions |
| `engine/selection` | `tests/engine/selection.test.ts` | Multi-block selection, mark ops |
| `engine/commands` | `tests/engine/commands.test.ts` | Built-in command semantics |
| `engine/specs` | `tests/engine/specs.test.ts` | Type registry |
| `serializers` | `tests/serializers/*.test.ts` | Round-trips |
| `integration` | `tests/integration.test.ts` | Full workflows |

### No process spawning in tests

All tests run in-process. `beforeEach` creates a `new BlockEngine()` + `.mount()`. No async subprocess setup. Tests are fast.

### Integration test scenarios

```typescript
// Scenario 1: Outline editing workflow
const engine = new BlockEngine();
engine.mount();
const root = engine.createBlock();
engine.setBlockType(root, "bullet");
engine.replaceDeltas(root, textToDelta("First item"));
const child = engine.splitBlock(root, getDeltaLength(engine.getBlock(root)!.deltas));
engine.indent(child);
expect(engine.getBlock(child)!.parentId).toBe(root);
expect(engine.getBlock(child)!.depth).toBe(1);

// Scenario 2: Mark toggle across multiple blocks
engine.setSelection({ type: "text", anchor: { blockId: a, offset: 0 }, focus: { blockId: b, offset: 3 } });
engine.exec("toggleMark", { key: "bold" });
expect(engine.isMarkActive("bold")).toBe(true);
engine.exec("toggleMark", { key: "bold" });
expect(engine.isMarkActive("bold")).toBe(false);

// Scenario 3: Undo/redo preserves selection
engine.batch(() => {
  engine.indent(id1);
  engine.indent(id2);
});
engine.undo();
expect(engine.getBlock(id1)!.depth).toBe(0);
expect(engine.getBlock(id2)!.depth).toBe(0);

// Scenario 4: Markdown round-trip
engine.fromMarkdown("# Heading\n\n- Item 1\n  - Nested");
const md = engine.toMarkdown();
expect(md).toContain("# Heading");
expect(md).toContain("- Item 1");
```

---

## Part 15 — How Users Wire Their Framework

### React

```typescript
import { BlockEngine, getDeltaLength } from "block-engine";
import { useSyncExternalStore } from "react";

const engine = new BlockEngine();
engine.mount();

function useBlock(id: string) {
  return useSyncExternalStore(
    cb => engine.subscribeBlock(id, cb),
    () => engine.getBlock(id)
  );
}

function useVisibleIds() {
  return useSyncExternalStore(
    cb => engine.subscribeTree(cb),
    () => engine.getVisibleIds()
  );
}

// Handling Enter key in a block editor:
function handleKeyDown(e: KeyboardEvent, blockId: string, cursorOffset: number) {
  if (e.key === "Enter") {
    e.preventDefault();
    engine.exec("splitBlock", { blockId, offset: cursorOffset });
  } else if (e.key === "Tab") {
    e.preventDefault();
    engine.exec(e.shiftKey ? "outdent" : "indent", { blockId });
  } else if (e.key === "Backspace" && cursorOffset === 0) {
    e.preventDefault();
    engine.exec("mergeBlockWithPrev", { blockId });
  }
}
```

### Ink (TUI)

```typescript
import { BlockEngine } from "block-engine";
import { useInput, useState, useEffect } from "ink";

const engine = new BlockEngine();
engine.mount();

function useBlock(id: string) {
  const [block, setBlock] = useState(() => engine.getBlock(id));
  useEffect(() => engine.subscribeBlock(id, () => setBlock(engine.getBlock(id))), [id]);
  return block;
}

useInput((input, key) => {
  if (key.tab) engine.exec(key.shift ? "outdent" : "indent");
  if (key.return) engine.exec("splitBlock", { blockId: focusedId, offset: cursorPos });
});
```

### Lexical

```typescript
// Lexical editor plugin that delegates state to BlockEngine
// User writes a LexicalBlockEnginePlugin that:
// - On Lexical onChange: calls engine.replaceDeltas(id, lexicalToDeltas(editorState))
// - Subscribes engine.subscribeBlock(id) and applies changes to Lexical editor state
// - Forwards key events to engine commands
```

### CLI / AI Agent (headless)

```typescript
// No UI at all — just use engine API directly
const engine = new BlockEngine();
engine.fromMarkdown(fs.readFileSync("doc.md", "utf-8"));

// AI agent manipulates document
engine.createBlock(undefined, 0);
engine.exec("setBlockType", { blockId: id, type: "heading" });
engine.replaceDeltas(id, textToDelta("Generated heading"));

// Save
const store = new FileStore("doc.loro");
await store.save(engine.export());

// Export for LLM context
const markdown = engine.toMarkdown();
const response = await llm.complete(markdown);
engine.fromMarkdown(response);
```

---

## Part 16 — API Comparison (Store Layer Only)

| Capability | tiptap (Editor) | BlockSuite (Doc/Store) | BlockEngine v2 |
|---|---|---|---|
| In-process | ✅ | ✅ | ✅ |
| CRDT backend | ProseMirror | Loro/Y.js | Loro |
| Block tree | ✅ (node hierarchy) | ✅ (block tree) | ✅ |
| Rich text (Delta) | ✅ (ProseMirror nodes) | ✅ (Loro text) | ✅ |
| Marks/attributes | ✅ | ✅ | ✅ |
| Block props | ✅ (node attrs) | ✅ | ✅ |
| Undo/redo | ✅ | ✅ | ✅ |
| `batch()` / transaction | ✅ | ✅ | ✅ |
| `splitBlock` | ✅ (`splitNode`) | ✅ | ✅ |
| `mergeBlock` | ✅ (`joinBackward`) | ✅ | ✅ |
| `indent` / `outdent` | via ListItem ext | ✅ | ✅ |
| `toggleMark` (selection-aware) | ✅ | ✅ | ✅ |
| Multi-block selection | ✅ | ✅ | ✅ |
| `getDepth` | ✅ | ✅ | ✅ |
| `getAncestors` | ✅ | ✅ | ✅ |
| `getVisibleIds` (collapse-aware) | ❌ (not an outliner) | ✅ | ✅ |
| Collapse / fold | ❌ | ✅ | ✅ |
| Block type spec registry | ✅ (Extensions) | ✅ (BlockSpec) | ✅ (lightweight) |
| Built-in commands | ✅ (~50) | ✅ (per spec) | ✅ (~15 core) |
| Plugin system | ✅ (Extensions) | ✅ (services) | ✅ |
| `isMarkActive` | ✅ | ✅ | ✅ |
| `getMarkValue` | ✅ | ✅ | ✅ |
| `search()` | ✅ (ext) | ✅ | ✅ |
| Markdown import | ✅ | ✅ | ✅ |
| Markdown export | ✅ | ✅ | ✅ |
| Plain JSON import/export | ✅ | ✅ | ✅ |
| Reactive subscriptions | ✅ (events) | ✅ | ✅ |
| Framework adapters | ✅ (React/Vue/Svelte) | ✅ (Lit built-in) | user-written |
| Collaborative sync | ✅ (Hocuspocus) | ✅ (Y.js) | future (Loro P2P) |
| Clipboard handling | ✅ | ✅ | ❌ user-written |
| Delta utilities library | ❌ (ProseMirror API) | ❌ | ✅ |
| `buildCombo` | ❌ | ❌ | ✅ |

---

## Summary

The rewrite collapses three layers (OutlineClient + BlockStore + Headless Engine) into one class, eliminates all async overhead on mutations, unifies the two-plugin system into one, and adds the missing store-level operations that blocked users from implementing real outliner applications.

What was 2,600 lines across 19 files becomes ~1,200 lines across 14 files — with more capability.

The test suite goes from spawning subprocesses to creating `new BlockEngine()` in `beforeEach`.

The user API goes from `await store.createBlock()` to `engine.createBlock()`.
