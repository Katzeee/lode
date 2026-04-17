# Headless Outliner Engine v1.0 — Self-Contained Implementation Plan

## What You Are Building

A TypeScript library for building Tana/Notion-style outliner/block-editor applications. It has two parts:

**Part 1 — Headless Process**: A Node.js server process that manages CRDT state (using `loro-crdt`), exposes a JSON-RPC 2.0 API over stdio, and handles persistence. It runs as a subprocess.

**Part 2 — ViewStore**: A client-side TypeScript library that communicates with the headless process via IPC, maintains optimistic local state, provides a selection model, command system, and plugin API for UI frameworks to build on top of.

This is **not a rendering library**. It does not touch the DOM. It manages data and state only. The UI framework (React, Solid, Vue, or vanilla JS) is the user's responsibility.

**Block types are transparent**: The engine does NOT know about "heading", "todo", etc. Those are user conventions stored in `props.type`. All blocks are treated identically by the engine.

---

## Project Setup

### Directory: `D:\codes\blockengine`

This is a **new project from scratch**. Create all files listed below.

### `package.json`

```json
{
  "name": "block-engine",
  "version": "1.0.0",
  "type": "module",
  "bin": { "block-engine": "./dist/bin/serve.js" },
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./client": { "import": "./dist/client/outline-client.js" }
  },
  "scripts": {
    "dev": "tsx src/bin/serve.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "loro-crdt": "^1.11.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], pool: "forks", testTimeout: 15000 }
});
```

### `.gitignore`

```
node_modules/
dist/
*.loro
*.tmp
```

---

## Critical Loro API Constraints

Read this before writing any code that uses `loro-crdt`.

1. **`configTextStyle` must be called before `mark()`**: Call `doc.configTextStyle(...)` in `OutlinerDoc` constructor **before** `doc.import(bytes)`.
2. **`LoroText.toDelta()` returns a union type**: Loro's delta items can be `{insert,attributes}`, `{delete:number}`, or `{retain:number}`. Filter to `typeof d.insert === "string"` to get only insert spans.
3. **`LoroTreeNode.parent()` returns a node, not an ID**: Use `node.parent()?.id` to get the TreeID string.
4. **`tree.delete()` is soft-delete**: Check `node.isDeleted()` when doing `getBlock()`.
5. **TreeID string format**: `"counter@peerID"` — this is a plain string type in TypeScript.
6. **Text change events**: Loro's `doc.subscribe()` only fires for tree structure changes (create/delete/move). After RPC handlers for `text.mark`, `text.unmark`, `text.replaceDeltas` run, call `server.notify("onChange", { changes: [{ action: "update", blockId }] })` directly.
7. **`LoroDoc.commit()`**: Must be called after mutations to trigger event delivery.
8. **`UndoManager` with `mergeInterval: 0`**: Avoid — in Loro, `mergeInterval: 0` means "always merge all ops". Use `500` for production-style batching.

---

## Complete File Tree

```
src/
  bin/serve.ts
  client/outline-client.ts
  crdt/block.ts
  crdt/outliner-doc.ts
  crdt/types.ts
  index.ts
  persistence/file-store.ts
  plugins/ai-completion.ts
  plugins/input-rules.ts
  plugins/keymap.ts
  rpc/methods.ts
  rpc/server.ts
  rpc/transport.ts
  rpc/types.ts
  view/command.ts
  view/selection.ts
  view/types.ts
  view/view-store.ts
tests/
  crdt/block.test.ts
  crdt/outliner-doc.test.ts
  integration/e2e.test.ts
  persistence/file-store.test.ts
  plugins/ai-completion.test.ts
  plugins/input-rules.test.ts
  plugins/keymap.test.ts
  rpc/methods.test.ts
  rpc/transport.test.ts
  view/command.test.ts
  view/selection.test.ts
  view/view-store.test.ts
```

---

## Implementation Order

Implement strictly in this order:

1. `src/crdt/types.ts`
2. `src/crdt/block.ts`
3. `src/crdt/outliner-doc.ts`
4. `src/rpc/transport.ts`
5. `src/rpc/types.ts`
6. `src/rpc/server.ts`
7. `src/rpc/methods.ts`
8. `src/persistence/file-store.ts`
9. `src/bin/serve.ts`
10. `src/view/types.ts`
11. `src/view/selection.ts`
12. `src/view/command.ts`
13. `src/view/view-store.ts`
14. `src/plugins/keymap.ts`
15. `src/plugins/input-rules.ts`
16. `src/plugins/ai-completion.ts`
17. `src/client/outline-client.ts`
18. `src/index.ts`
19. All test files
20. `npm install && npm test` — must reach 0 failures

---

## File Specifications

### `src/crdt/types.ts`

Complete file — all shared data types:

```typescript
/** TreeID string: "counter@peerID" */
export type BlockId = string;

/** A single insert span in a Quill-style rich-text delta. Insert-only; no retain/delete. */
export interface DeltaInsert {
  insert: string;
  attributes?: Record<string, unknown>;  // { bold: true, italic: true, link: "https://..." }
}

/** Ordered array of insert spans representing rich text content. */
export type Delta = DeltaInsert[];

/** Collapse delta to plain string. */
export function deltaToText(deltas: Delta): string {
  return deltas.map(d => d.insert).join("");
}

/** Wrap plain string as a single-span delta with no attributes. */
export function textToDelta(text: string): Delta {
  return text.length === 0 ? [] : [{ insert: text }];
}

/** Compare two Delta arrays structurally (order-sensitive). */
export function deltasEqual(a: Delta, b: Delta): boolean {
  if (a.length !== b.length) return false;
  return a.every((span, i) =>
    span.insert === b[i].insert &&
    JSON.stringify(span.attributes ?? {}) === JSON.stringify(b[i].attributes ?? {})
  );
}

/** utf-16 character range for mark operations. */
export interface MarkRange { start: number; end: number; }

export interface BlockSnapshot {
  id: BlockId;
  deltas: Delta;
  parentId: BlockId | null;
  children: BlockId[];      // ordered child IDs
  props: Record<string, unknown>;
}

export interface DocSnapshot { blocks: BlockSnapshot[]; }

export interface BlockChange {
  action: "create" | "delete" | "move" | "update";
  blockId: BlockId;
  parentId?: BlockId | null;
  index?: number;
}
```

---

### `src/crdt/block.ts`

Thin wrapper over a `LoroTreeNode`. Never cached; created on demand.

**Loro data layout per node:**
```
node.data (LoroMap)
  "content" → LoroText   (rich text, initialized eagerly at createBlock time)
  [other keys] → any     (user props — primitives only: string/number/boolean/null)
```

**Public API:**

```typescript
import { LoroText, type LoroMap, type LoroTreeNode } from "loro-crdt";
import { deltaToText, type BlockId, type BlockSnapshot, type Delta, type MarkRange } from "./types.js";

export class Block {
  constructor(private readonly node: LoroTreeNode) {}

  get id(): BlockId { return String(this.node.id); }
  get parentId(): BlockId | null {
    const p = this.node.parent() as LoroTreeNode | null | undefined;
    return p != null ? String(p.id) : null;
  }
  get children(): BlockId[] {
    const kids = this.node.children();
    return kids ? kids.map(c => String(c.id)) : [];
  }

  // Text
  private get textContainer(): LoroText { /* get or lazily init LoroText at "content" key */ }
  getText(): string { /* LoroText.toString() */ }
  getDeltas(): Delta {
    // Call textContainer.toDelta()
    // Filter: only items where typeof d.insert === "string"
    // Map to DeltaInsert: { insert: d.insert, ...(d.attributes && { attributes: d.attributes }) }
  }
  insertText(pos: number, content: string): void
  deleteText(pos: number, len: number): void
  replaceText(content: string): void   // delete all then insert
  replaceDeltas(deltas: Delta): void {
    // 1. delete all existing text (LoroText.delete(0, length))
    // 2. insert all span text first (concatenated)
    // 3. second pass: apply marks for spans with attributes
    //    for each span: if attributes, call LoroText.mark({start, end}, key, value) for each attr
  }

  // Marks
  mark(range: MarkRange, key: string, value: unknown): void {
    this.textContainer.mark({ start: range.start, end: range.end }, key, value);
  }
  unmark(range: MarkRange, key: string): void {
    this.textContainer.unmark({ start: range.start, end: range.end }, key);
  }

  // Props (primitives only)
  getProp(key: string): unknown
  setProp(key: string, value: unknown): void
  getProps(): Record<string, unknown>  // all keys except "content"

  // Serialization
  toSnapshot(): BlockSnapshot {
    return { id: this.id, deltas: this.getDeltas(), parentId: this.parentId, children: this.children, props: this.getProps() };
  }
}
```

---

### `src/crdt/outliner-doc.ts`

Wraps `LoroDoc` + `LoroTree` + `UndoManager`. All mutations go through this class.

**Constructor:**
```typescript
constructor(bytes?: Uint8Array) {
  this.doc = new LoroDoc();
  // Configure rich text styles BEFORE import
  this.doc.configTextStyle({
    bold:          { expand: "after" },
    italic:        { expand: "after" },
    underline:     { expand: "after" },
    strikethrough: { expand: "after" },
    code:          { expand: "none" },
    link:          { expand: "none" },
  });
  if (bytes && bytes.length > 0) this.doc.import(bytes);
  this.tree = this.doc.getTree("blocks");
  this.undoManager = new UndoManager(this.doc, { mergeInterval: 500 });
  this.unsubscribe = this.doc.subscribe(event => this.handleEvent(event));
}
```

**Public API:**

```typescript
// Readonly mode
get readonly(): boolean
setReadonly(val: boolean): void

// Block CRUD — throw if readonly
createBlock(parentId?: BlockId, index?: number): Block
  // Creates node in LoroTree, eagerly inits LoroText at "content", calls doc.commit()
deleteBlock(id: BlockId): void    // tree.delete(), doc.commit()
moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): void  // tree.move(), doc.commit()

// Query
getBlock(id: BlockId): Block | null
  // tree.has(id) → false: return null
  // tree.getNodeByID(id): if !node || node.isDeleted(): return null
  // return new Block(node)
getRootBlocks(): Block[]    // tree.getNodes().filter(n => n.parent() == null).map(n => new Block(n))
getAllBlocks(): Block[]      // DFS from roots
getBlocksByProp(key: string, value: unknown): Block[]
  // tree.getNodes().filter(n => !n.isDeleted() && n.data.get(key) === value).map(...)

// Rich text — delegates to Block methods, then doc.commit()
markBlock(id: BlockId, range: MarkRange, key: string, value: unknown): void
unmarkBlock(id: BlockId, range: MarkRange, key: string): void
replaceDeltasBlock(id: BlockId, deltas: Delta): void

// Undo/Redo
undo(): boolean
redo(): boolean
canUndo(): boolean
canRedo(): boolean

// Batch (groups into one undo step via groupStart/groupEnd)
transact(fn: () => void): void {
  this.undoManager.groupStart();
  try { fn(); this.doc.commit(); }
  finally { this.undoManager.groupEnd(); }
}

// Snapshot
export(): Uint8Array     // doc.export({ mode: "snapshot" })
import(bytes: Uint8Array): void
toJSON(): DocSnapshot    // getAllBlocks().map(b => b.toSnapshot())

// Events
onChange(listener: (changes: BlockChange[]) => void): () => void  // returns unsubscribe

// Lifecycle
destroy(): void

// Internal
private handleEvent(event): void
  // For each event in event.events where diff.type === "tree":
  //   map TreeDiffItem { action, target, parent, index } → BlockChange
  // Dispatch to changeListeners
```

---

### `src/rpc/transport.ts`

Abstract transport interface and StdioTransport implementation.

```typescript
export interface Transport {
  send(msg: unknown): void;
  start(handler: (msg: unknown) => void): void;
  stop(): void;
}

export class StdioTransport implements Transport {
  constructor(
    private readonly input: NodeJS.ReadableStream = process.stdin,
    private readonly output: NodeJS.WritableStream = process.stdout,
  ) {}
  // Newline-delimited JSON. Each message = JSON.stringify(msg) + "\n"
  // Parse incoming: buffer chunks, split on "\n", JSON.parse each line
  // All diagnostic output → process.stderr (stdout is for JSON-RPC only)
  send(msg: unknown): void
  start(handler: (msg: unknown) => void): void
  stop(): void
}

// Stub — Node 20 has no native WebSocket. Documents limitation.
export class WebSocketTransport implements Transport {
  constructor(wsOrUrl: unknown) {
    throw new Error("WebSocketTransport requires Node 22+ (native WebSocket). Use StdioTransport on Node 20.");
  }
  send(_: unknown): void {}
  start(_: (msg: unknown) => void): void {}
  stop(): void {}
}
```

---

### `src/rpc/types.ts`

JSON-RPC 2.0 base types + all method param/result types:

```typescript
// JSON-RPC 2.0 base
export interface JsonRpcRequest { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown; }
export interface JsonRpcResponse { jsonrpc: "2.0"; id: number | string; result?: unknown; error?: JsonRpcError; }
export interface JsonRpcNotification { jsonrpc: "2.0"; method: string; params?: unknown; }
export interface JsonRpcError { code: number; message: string; data?: unknown; }

export class RpcError extends Error {
  constructor(public readonly code: number, message: string, public readonly data?: unknown) { super(message); }
}

export const RPC_ERRORS = {
  PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602, INTERNAL_ERROR: -32603,
  NOT_FOUND: -32000, INVALID_OPERATION: -32001, READONLY: -32002,
} as const;

// Method params/results
export interface CreateBlockParams { parentId?: string; index?: number; }
export interface CreateBlockResult { id: string; }
export interface DeleteBlockParams { id: string; }
export interface MoveBlockParams { id: string; parentId: string | null; index?: number; }
export interface GetBlockParams { id: string; }
export interface GetChildrenParams { parentId?: string; }
export interface GetChildrenResult { children: BlockSnapshot[]; }
export interface GetRootsResult { blocks: BlockSnapshot[]; }
export interface GetByPropParams { key: string; value: unknown; }
export interface GetByPropResult { blocks: BlockSnapshot[]; }
export interface TextGetParams { id: string; }
export interface TextGetResult { content: string; }           // plain text
export interface TextGetDeltasParams { id: string; }
export interface TextGetDeltasResult { deltas: Delta; }
export interface TextInsertParams { id: string; pos: number; text: string; }
export interface TextDeleteParams { id: string; pos: number; len: number; }
export interface TextReplaceParams { id: string; content: string; }
export interface TextReplaceDeltasParams { id: string; deltas: Delta; }
export interface TextMarkParams { id: string; range: MarkRange; key: string; value: unknown; }
export interface TextUnmarkParams { id: string; range: MarkRange; key: string; }
export interface PropsGetParams { id: string; key?: string; }
export interface PropsSetParams { id: string; key: string; value: unknown; }
export interface SetReadonlyParams { readonly: boolean; }
export interface BatchOp { method: string; params: unknown; }
export interface BatchParams { ops: BatchOp[]; }
export interface BatchResult { results: unknown[]; }
export interface SaveResult { path: string; }
export interface LoadParams { path?: string; }
```

---

### `src/rpc/server.ts`

Minimal JSON-RPC 2.0 dispatcher.

```typescript
export type RpcHandler = (params: unknown) => Promise<unknown> | unknown;

export class RpcServer {
  private readonly handlers = new Map<string, RpcHandler>();

  constructor(private readonly transport: Transport) {}

  register(method: string, handler: RpcHandler): void
  getHandler(method: string): RpcHandler | undefined   // used by batch
  notify(method: string, params: unknown): void        // server → client push
  start(): void                                        // begin dispatching
  stop(): void

  // dispatch: validates JSON-RPC 2.0, routes to handler, handles errors
  // RpcError → { error: { code, message } }
  // unknown Error → { error: { code: INTERNAL_ERROR, message: err.message } }
  // missing handler → { error: { code: METHOD_NOT_FOUND } }
}
```

---

### `src/rpc/methods.ts`

Registers all RPC handlers on `RpcServer`. Takes `(server, doc, store)` where `store` is `FileStore`.

**Complete list of registered methods:**

```
ping                  () → { pong: true }
shutdown              () → {}  (calls process.exit(0) via setImmediate)

block.create          CreateBlockParams → CreateBlockResult
block.delete          DeleteBlockParams → {}
block.move            MoveBlockParams → {}
block.get             GetBlockParams → BlockSnapshot
block.getRoots        () → GetRootsResult
block.getChildren     GetChildrenParams → GetChildrenResult
block.getByProp       GetByPropParams → GetByPropResult

text.get              TextGetParams → TextGetResult          (plain string)
text.getDeltas        TextGetDeltasParams → TextGetDeltasResult
text.insert           TextInsertParams → {}
text.delete           TextDeleteParams → {}
text.replace          TextReplaceParams → {}
text.replaceDeltas    TextReplaceDeltasParams → {}
text.mark             TextMarkParams → {}
text.unmark           TextUnmarkParams → {}

props.get             PropsGetParams → value | Record<string, unknown>
props.set             PropsSetParams → {}

undo                  () → { success: boolean }
redo                  () → { success: boolean }
canUndo               () → { result: boolean }
canRedo               () → { result: boolean }

batch                 BatchParams → BatchResult

doc.save              () → SaveResult
doc.load              LoadParams → {}
doc.getSnapshot       () → DocSnapshot
doc.export            () → { data: string }   (base64 Loro binary)
doc.import            { data: string } → {}
doc.setReadonly       SetReadonlyParams → {}
```

**Readonly guard**: add helper `requireWritable(doc: OutlinerDoc)` that throws `RpcError(RPC_ERRORS.READONLY, "Document is readonly")` if `doc.readonly`. Call it at the top of: `block.create`, `block.delete`, `block.move`, `text.insert`, `text.delete`, `text.replace`, `text.replaceDeltas`, `text.mark`, `text.unmark`, `props.set`.

**Text change notifications**: after `text.mark`, `text.unmark`, `text.replaceDeltas` complete successfully, call:
```typescript
server.notify("onChange", { changes: [{ action: "update", blockId: id }] });
```

---

### `src/persistence/file-store.ts`

Atomic file persistence for Loro binary snapshots.

```typescript
export class FileStore {
  constructor(private readonly filePath: string) {}

  async save(data: Uint8Array): Promise<void> {
    // mkdir -p parent dir
    // write to filePath + ".tmp", then rename to filePath (atomic)
  }

  async load(): Promise<Uint8Array | null> {
    // return null if ENOENT, throw otherwise
  }

  async exists(): Promise<boolean>
  getPath(): string
}
```

---

### `src/bin/serve.ts`

```typescript
#!/usr/bin/env node
// Entry: npx tsx src/bin/serve.ts [filePath]
// 1. Read filePath from process.argv[2] (default: "./outline.loro")
// 2. Load FileStore, optionally import existing snapshot into OutlinerDoc
// 3. Create StdioTransport, RpcServer
// 4. registerMethods(server, doc, store)
// 5. Forward doc.onChange → server.notify("onChange", { changes })
// 6. server.start()
// 7. Log to stderr: "[block-engine] started file=..."
// All output to stdout is JSON-RPC only.
```

---

### `src/view/types.ts`

All ViewStore-layer types.

```typescript
import type { BlockChange, BlockId, Delta } from "../crdt/types.js";
import type { OutlineClient } from "../client/outline-client.js";

// BlockView — local UI representation
export interface BlockView {
  readonly id: BlockId;
  deltas: Delta;              // Current rich text (optimistic)
  confirmedDeltas: Delta;     // Last confirmed by headless
  isDirty: boolean;           // !deltasEqual(deltas, confirmedDeltas)
  parentId: BlockId | null;
  childIds: BlockId[];
  props: Record<string, unknown>;
  ext: Record<string, unknown>;  // Plugin-private; never synced to headless
}

// Selection — lives in ViewStore only, never sent to headless
export interface Cursor { blockId: BlockId; offset: number; }
export interface TextSelection { type: "text"; anchor: Cursor; focus: Cursor; }
export interface BlockSelection { type: "block"; blockIds: BlockId[]; }
export type Selection = TextSelection | BlockSelection | null;

// Store events (plugin hooks)
export type StoreEvent =
  | { type: "deltaInput";     blockId: BlockId; deltas: Delta }
  | { type: "blockCreated";   blockId: BlockId; parentId: BlockId | null }
  | { type: "blockDeleted";   blockId: BlockId }
  | { type: "blockMoved";     blockId: BlockId; newParentId: BlockId | null }
  | { type: "remoteChange";   changes: BlockChange[] }
  | { type: "selectionChange"; selection: Selection }
  | { type: "keyDown";        key: string; combo: string };

export type StoreEventType = StoreEvent["type"];

// Command system
export interface CommandContext {
  getBlock(id: BlockId): BlockView | undefined;
  getRootIds(): BlockId[];
  getSelection(): Selection;
  setSelection(sel: Selection): void;
  readonly client: OutlineClient;
}
export interface CommandDef {
  execute(ctx: CommandContext, args?: unknown): void | Promise<void>;
  can?(ctx: CommandContext, args?: unknown): boolean;
}

// Input rule
export interface InputRule {
  /** Applied to plain text of the block after each onDeltaInput. Use $ anchor. */
  pattern: RegExp;
  /** Return null/undefined to skip. First matching rule wins. */
  handler(ctx: CommandContext, match: RegExpMatchArray, blockId: BlockId): void | null | undefined;
}

// Plugin system
export interface PluginContext {
  // Read view state
  getBlock(id: BlockId): BlockView | undefined;
  getRootIds(): BlockId[];
  // Write plugin-local state (never synced)
  setExt(blockId: BlockId, key: string, value: unknown): void;
  getExt(blockId: BlockId, key: string): unknown;
  // Trigger re-render
  notify(blockId: BlockId): void;
  notifyTree(): void;
  // Events
  on<T extends StoreEventType>(
    event: T,
    handler: (e: Extract<StoreEvent, { type: T }>) => void
  ): () => void;
  // Selection
  getSelection(): Selection;
  setSelection(sel: Selection): void;
  subscribeSelection(listener: () => void): () => void;
  // Register plugin commands
  registerCommand(name: string, def: CommandDef): void;
  // Keyboard bindings (last registered wins; returns unsubscribe)
  bindKey(combo: string, handler: (ctx: CommandContext) => boolean): () => void;
  // Input rules (returns unsubscribe)
  addInputRule(rule: InputRule): () => void;
  // Store operations
  store: {
    onDeltaInput(blockId: BlockId, deltas: Delta): void;
    acceptGhostText(blockId: BlockId): void;
    rejectGhostText(blockId: BlockId): void;
    exec(name: string, args?: unknown): boolean;
    can(name: string, args?: unknown): boolean;
  };
  readonly client: OutlineClient;
}

export interface InstalledPlugin { dispose(): void; }
export interface ViewStorePlugin {
  readonly name: string;
  install(ctx: PluginContext): InstalledPlugin;
}
```

---

### `src/view/selection.ts`

Pure utilities for selection and mark queries.

```typescript
import type { Delta, BlockId } from "../crdt/types.js";
import type { Selection } from "./types.js";

/**
 * Returns the attributes active at a given character offset within a delta.
 * Offset is 0-based. Returns {} for plain text, null for out-of-range.
 * For collapsed cursor, use offset-1 (char to the left) for mark inheritance.
 */
export function getAttributesAtOffset(
  deltas: Delta,
  offset: number
): Record<string, unknown> | null {
  // Walk delta spans accumulating char position
  // Return span.attributes ?? {} for the span containing offset
  // Return null if offset > total length
}

/**
 * Returns true if the named mark is active across the entire selection range.
 * For TextSelection: all chars in [min(anchor,focus)...max(anchor,focus)] must have the mark.
 * For collapsed cursor: checks the char to the left (offset - 1).
 * Returns false for null or BlockSelection.
 */
export function isMarkActive(
  markName: string,
  selection: Selection,
  getBlockDeltas: (id: BlockId) => Delta
): boolean

/**
 * Returns the value of a mark at the anchor position (offset - 1).
 * Returns undefined for no selection, BlockSelection, or absent mark.
 */
export function getMarkValue(
  markName: string,
  selection: Selection,
  getBlockDeltas: (id: BlockId) => Delta
): unknown

/**
 * Build a normalized key combo string.
 * Mod = Ctrl on non-mac, Meta on mac.
 * Examples: "Mod-b", "Shift-Tab", "Mod-Shift-z", "Tab"
 */
export function buildCombo(
  key: string,
  modifiers: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean },
  platform?: "mac" | "other"
): string
```

---

### `src/view/command.ts`

```typescript
import type { CommandDef, CommandContext } from "./types.js";

export type { CommandDef, CommandContext };

export class CommandChain {
  private readonly ops: Array<{ name: string; args?: unknown }> = [];

  constructor(private readonly execFn: (name: string, args?: unknown) => boolean) {}

  exec(name: string, args?: unknown): this {
    this.ops.push({ name, args });
    return this;
  }

  run(): boolean {
    for (const op of this.ops) {
      if (!this.execFn(op.name, op.args)) return false;
    }
    return true;
  }
}
```

---

### `src/view/view-store.ts`

The binding layer between the headless process and the UI.

**Complete public API:**

```typescript
export class ViewStore {
  constructor(client: OutlineClient) {}

  // Plugin registration (must be called before mount())
  use(plugin: ViewStorePlugin): this   // chainable

  // Lifecycle
  async mount(): Promise<void>    // starts client, subscribes onChange, hydrates from getSnapshot()
  async unmount(): Promise<void>  // flushes all pending deltas, stops client, disposes plugins

  // Readonly mode
  get readonly(): boolean
  set readonly(val: boolean)

  // Block CRUD (optimistic — throws if readonly)
  async createBlock(parentId?: BlockId, index?: number): Promise<BlockId>
  async deleteBlock(id: BlockId): Promise<void>
  async moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): Promise<void>

  // Delta input (called by UI on every text change)
  onDeltaInput(blockId: BlockId, deltas: Delta): void
  // - Throws if readonly
  // - Updates block.deltas immediately (0ms latency)
  // - Sets isDirty = !deltasEqual(deltas, confirmedDeltas)
  // - Fires "deltaInput" plugin hook
  // - Runs input rules against deltaToText(deltas)
  // - Debounces client.replaceDeltas(blockId, deltas) after 300ms
  // - On replaceDeltas confirm: sets confirmedDeltas = deltas, isDirty = false

  async flushDeltas(blockId: BlockId): Promise<void>  // force-sync pending deltas

  // Props (optimistic)
  async setProp(blockId: BlockId, key: string, value: unknown): Promise<void>

  // Ghost text (AI completion — ext["ghostText"] is plugin-private, never touches headless)
  acceptGhostText(blockId: BlockId): void
  // Appends ext["ghostText"] as { insert: ghost } to block.deltas, calls onDeltaInput
  rejectGhostText(blockId: BlockId): void

  // Query
  getBlock(id: BlockId): BlockView | undefined
  getRootIds(): BlockId[]
  getDescendants(id: BlockId): BlockId[]  // DFS

  // Selection
  getSelection(): Selection
  setSelection(sel: Selection): void  // also fires "selectionChange" hook event
  subscribeSelection(listener: () => void): () => void

  // Mark queries (computed from selection + local block deltas)
  isMarkActive(markName: string): boolean
  getMarkValue(markName: string): unknown

  // Command system
  registerCommand(name: string, def: CommandDef): void
  exec(name: string, args?: unknown): boolean
  can(name: string, args?: unknown): boolean
  chain(): CommandChain

  // Keyboard — UI calls this from its keydown handler; returns true if handled
  handleKeyDown(
    key: string,
    modifiers: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }
  ): boolean

  // Reactive subscriptions (framework-agnostic)
  subscribeBlock(id: BlockId, listener: () => void): () => void
  subscribeTree(listener: () => void): () => void
}
```

**Key internal implementation details:**

- `blocks: Map<BlockId, BlockView>` — normalized block map
- `rootIds: BlockId[]` — ordered root IDs
- `pendingOps: Set<string>` — e.g., `"create:id"` — prevents echo from remote onChange
- `deltaTimers: Map<BlockId, Timer>` — per-block debounce timers (300ms)
- `selection: Selection = null`
- `commands: Map<string, CommandDef>`
- `keyBindings: Array<{combo: string; handler: Function}>` — last registered wins (iterate in reverse)
- `inputRules: InputRule[]` — checked after every `onDeltaInput`
- `_readonly: boolean = false`

**Remote change handling (applyRemoteChanges):**
```
"create": if not in pendingOps → add empty BlockView to blocks map and tree
"delete": if not in pendingOps → remove from blocks map and parent's childIds
"move":   if not in pendingOps → update parentId, childIds
"update": if !deltaTimers.has(blockId) → re-fetch deltas via client.getDeltas(id) → update block
          if  deltaTimers.has(blockId) → skip (local edit is authoritative)
For create/delete/move: pendingOps check uses key "action:blockId"; remove from pendingOps if found.
```

**handleKeyDown flow:**
1. `buildCombo(key, modifiers)` → combo string
2. Fire `"keyDown"` plugin hook event
3. Iterate `keyBindings` in reverse (last registered wins)
4. If handler found and returns true → return true
5. Otherwise → return false

**Input rules trigger (inside onDeltaInput):**
```typescript
const text = deltaToText(deltas);
for (const rule of this.inputRules) {
  const match = text.match(rule.pattern);
  if (match) {
    rule.handler(this.makeCommandContext(), match, blockId);
    break;
  }
}
```

---

### `src/plugins/keymap.ts`

```typescript
import type { ViewStorePlugin } from "../view/types.js";

/**
 * Binds keyboard shortcuts to command names or handler functions.
 * Example: createKeymapPlugin({ "Mod-b": "toggleBold", "Tab": "indentBlock" })
 * The command must already be registered with store.registerCommand() (by another plugin).
 */
export function createKeymapPlugin(
  keymap: Record<string, string | ((ctx: import("../view/types.js").CommandContext) => boolean)>
): ViewStorePlugin {
  return {
    name: "keymap",
    install(ctx) {
      const unsubs: Array<() => void> = [];
      for (const [combo, binding] of Object.entries(keymap)) {
        const handler = typeof binding === "string"
          ? (c: import("../view/types.js").CommandContext) => { ctx.store.exec(binding); return true; }
          : binding;
        unsubs.push(ctx.bindKey(combo, handler));
      }
      return { dispose() { unsubs.forEach(u => u()); } };
    }
  };
}
```

---

### `src/plugins/input-rules.ts`

```typescript
import type { InputRule, ViewStorePlugin } from "../view/types.js";

/**
 * Registers input rules that fire on each text change.
 * Rules are checked in order; first match wins.
 * Patterns should use $ anchor to match at end of text.
 * Example: { pattern: /^# (.+)$/, handler: (ctx, match, blockId) => ctx.store... }
 */
export function createInputRulesPlugin(rules: InputRule[]): ViewStorePlugin {
  return {
    name: "input-rules",
    install(ctx) {
      const unsubs = rules.map(rule => ctx.addInputRule(rule));
      return { dispose() { unsubs.forEach(u => u()); } };
    }
  };
}
```

---

### `src/plugins/ai-completion.ts`

Ghost-text AI inline completion. Ghost text is stored in `block.ext["ghostText"]` — a plain string. It **never** touches the headless process until `acceptGhostText()` is called.

```typescript
export const GHOST_TEXT_KEY = "ghostText";

export interface AiCompletionContext {
  blockId: string;
  text: string;        // plain text of the block (deltaToText(deltas))
  ancestors: string[]; // ancestor plain texts, root-first
}

export interface AiCompletionOptions {
  /** Provider-agnostic: wire in Claude, OpenAI, local model, etc. Return null to show nothing. */
  fetchCompletion(context: AiCompletionContext): Promise<string | null | undefined>;
  triggerMinLength?: number;  // default: 3
  debounceMs?: number;        // default: 600
}

export function createAiCompletionPlugin(opts: AiCompletionOptions): ViewStorePlugin

export function getGhostText(ext: Record<string, unknown>): string | null
```

**Plugin behavior:**
1. Subscribes to `"deltaInput"` hook
2. Cancels any pending timer for the block; clears existing ghost text
3. If `deltaToText(deltas).length < triggerMinLength`: return
4. After `debounceMs`: call `fetchCompletion({ blockId, text, ancestors })`
5. Track in-flight requests per block (drop stale responses)
6. On result: `ctx.setExt(blockId, GHOST_TEXT_KEY, suggestion); ctx.notify(blockId)`
7. On block deleted: cancel timer and clear in-flight tracking

**Accept**: `acceptGhostText(blockId)` appends `{ insert: ghost }` as a new delta span to `block.deltas` via `ctx.store.onDeltaInput()`.
**Reject**: `rejectGhostText(blockId)` sets `ext[GHOST_TEXT_KEY] = null` and calls `ctx.notify(blockId)`.

---

### `src/client/outline-client.ts`

Communicates with the headless process via JSON-RPC over IPC.

**Constructor:**
```typescript
type SpawnOptions = {
  entryPoint?: string;  // default: path to src/bin/serve.ts resolved relative to this file
  filePath?: string;    // default: "./outline.loro"
  useTsx?: boolean;     // default: true (use `npx tsx` to run TypeScript)
};
type TransportOptions = {
  transport: Transport;  // use a pre-created transport (e.g., WebSocketTransport)
};
type OutlineClientOptions = SpawnOptions | TransportOptions;

class OutlineClient {
  constructor(opts?: OutlineClientOptions)
}
```

If `opts` has `transport` key: use it. Otherwise spawn child process with `spawn("npx", ["tsx", entryPoint, filePath], { stdio: ["pipe","pipe","inherit"], shell: process.platform === "win32" })` and create a `StdioTransport` wrapping the child's stdin/stdout.

**Public API:**

```typescript
// Lifecycle
async start(): Promise<void>   // spawn, wait 150ms, call ping to verify
async stop(): Promise<void>    // send shutdown, kill after 200ms

// Events
onChange(listener: (changes: BlockChange[]) => void): () => void

// Block CRUD
async createBlock(parentId?: BlockId, index?: number): Promise<BlockId>
async deleteBlock(id: BlockId): Promise<void>
async moveBlock(id: BlockId, parentId: BlockId | null, index?: number): Promise<void>
async getBlock(id: BlockId): Promise<BlockSnapshot>
async getRootBlocks(): Promise<BlockSnapshot[]>
async getChildren(parentId?: BlockId): Promise<BlockSnapshot[]>
async getBlocksByProp(key: string, value: unknown): Promise<BlockSnapshot[]>

// Text
async getText(id: BlockId): Promise<string>          // plain text convenience
async getDeltas(id: BlockId): Promise<Delta>
async insertText(id: BlockId, pos: number, text: string): Promise<void>
async deleteText(id: BlockId, pos: number, len: number): Promise<void>
async replaceText(id: BlockId, content: string): Promise<void>
async replaceDeltas(id: BlockId, deltas: Delta): Promise<void>
async mark(id: BlockId, range: MarkRange, key: string, value: unknown): Promise<void>
async unmark(id: BlockId, range: MarkRange, key: string): Promise<void>

// Props
async getProp(id: BlockId, key: string): Promise<unknown>
async getProps(id: BlockId): Promise<Record<string, unknown>>
async setProp(id: BlockId, key: string, value: unknown): Promise<void>

// Undo/Redo
async undo(): Promise<boolean>
async redo(): Promise<boolean>

// Batch
async batch(ops: Array<{ method: string; params: unknown }>): Promise<unknown[]>

// Persistence
async save(): Promise<string>
async getSnapshot(): Promise<DocSnapshot>

// Readonly
async setReadonly(readonly: boolean): Promise<void>
```

**Internal**: Uses `nextId` counter for JSON-RPC IDs. `pending: Map<number, {resolve, reject}>`. Responses matched by ID. Notifications (no `id`) with method `"onChange"` dispatched to listeners.

---

### `src/index.ts`

Export everything the library user needs:

```typescript
// CRDT types (shared between headless and client)
export type { BlockId, BlockSnapshot, BlockChange, DocSnapshot, Delta, DeltaInsert, MarkRange } from "./crdt/types.js";
export { deltaToText, textToDelta, deltasEqual } from "./crdt/types.js";

// Headless internals (for building custom servers)
export { OutlinerDoc } from "./crdt/outliner-doc.js";
export { Block } from "./crdt/block.js";
export { FileStore } from "./persistence/file-store.js";
export { RpcServer } from "./rpc/server.js";
export { StdioTransport, WebSocketTransport } from "./rpc/transport.js";
export type { Transport } from "./rpc/transport.js";
export { registerMethods } from "./rpc/methods.js";

// Client SDK
export { OutlineClient } from "./client/outline-client.js";
export type { OutlineClientOptions } from "./client/outline-client.js";

// ViewStore
export { ViewStore } from "./view/view-store.js";
export type { BlockView, Selection, TextSelection, BlockSelection, Cursor, ViewStorePlugin, PluginContext, StoreEvent, CommandDef, CommandContext, InputRule } from "./view/types.js";
export { CommandChain } from "./view/command.js";
export { getAttributesAtOffset, isMarkActive, getMarkValue, buildCombo } from "./view/selection.js";

// Built-in plugins
export { createAiCompletionPlugin, getGhostText, GHOST_TEXT_KEY } from "./plugins/ai-completion.js";
export type { AiCompletionOptions, AiCompletionContext } from "./plugins/ai-completion.js";
export { createKeymapPlugin } from "./plugins/keymap.js";
export { createInputRulesPlugin } from "./plugins/input-rules.js";
```

---

## Test Specifications

All tests use vitest. Run: `npm test`.

### `tests/crdt/block.test.ts`

Cover: getDeltas, mark/unmark, replaceDeltas, toSnapshot.deltas, plain text ops (getText, insertText, deleteText, replaceText).

Key assertions:
- `getDeltas()` on empty block → `[]`
- `getDeltas()` after `insertText(0,"Hello World")` → `[{insert:"Hello World"}]`
- After `mark({start:0,end:5},"bold",true)` and `doc.commit()` → `getDeltas()[0]` = `{insert:"Hello",attributes:{bold:true}}`
- `replaceDeltas([{insert:"bold",attributes:{bold:true}},{insert:" plain"}])` → `getText()` = "bold plain", `getDeltas()[0].attributes.bold` = true
- `toSnapshot()` has `deltas` field (not `content`)

### `tests/crdt/outliner-doc.test.ts`

Cover: createBlock, deleteBlock, moveBlock, getBlock, getRootBlocks, getAllBlocks, getBlocksByProp, undo/redo, transact, readonly mode, export/import.

Key assertions:
- `setReadonly(true)` → `createBlock()` throws
- `setReadonly(false)` → `createBlock()` works
- `getBlocksByProp("type","heading")` returns only blocks with that prop value
- Export → import → verify tree structure intact with marks
- `transact(() => { createBlock(); createBlock(); })` → undo removes both

### `tests/rpc/transport.test.ts`

Use `PassThrough` streams from `node:stream`. Cover: send/receive round-trip, newline-delimited framing, partial chunks, blank lines ignored, stop() clears handler.

### `tests/rpc/methods.test.ts`

Unit test each handler directly: create a real `OutlinerDoc`, create `RpcServer` with mock transport, call `registerMethods`, call `server.getHandler("method")(params)`.

Cover: all new methods (text.getDeltas, text.replaceDeltas, text.mark, text.unmark, block.getByProp, doc.setReadonly). Cover readonly guard (expect RpcError on write methods when readonly).

### `tests/view/selection.test.ts`

Cover: `getAttributesAtOffset`, `isMarkActive`, `getMarkValue`, `buildCombo`.

Key: `isMarkActive("bold", {type:"text",anchor:{blockId:"x",offset:5},focus:{blockId:"x",offset:5}}, getDeltas)` where offset 4 (offset-1) is inside a bold span → returns true.

### `tests/view/command.test.ts`

Cover: `registerCommand`, `exec`, `can`, `CommandChain.exec().run()`. Use a mock ViewStore or test the command primitives directly.

### `tests/view/view-store.test.ts`

Use a mock `OutlineClient` (all methods are `vi.fn()`). Cover:

- Block CRUD with optimistic updates and pendingOps loop prevention
- `onDeltaInput`: immediate update, debounce, dirty flag, input rule trigger
- `flushDeltas`: immediate replaceDeltas call
- `setProp`: optimistic update + client.setProp call
- `readonly`: throws on createBlock/deleteBlock/moveBlock/onDeltaInput
- `setSelection/getSelection/subscribeSelection/selectionChange event`
- `isMarkActive/getMarkValue`: uses mock block deltas + selection
- `registerCommand/exec/can/chain`
- `handleKeyDown`: binding match (true), no binding (false), last-wins order
- Input rules: pattern match fires handler; no match skips
- `acceptGhostText/rejectGhostText` with Delta format
- Remote change handling including "update" action (re-fetch or skip)
- Plugin system: install, hooks, setExt, registerCommand via ctx, bindKey via ctx, addInputRule via ctx, dispose on unmount

### `tests/plugins/keymap.test.ts`

Test via a `ViewStore` with mock client. Register a keymap plugin with `"Mod-t": "test"`. Register command "test". Call `handleKeyDown("t", {ctrl:true,...})` → exec("test") called.

### `tests/plugins/input-rules.test.ts`

Register an input rule `{ pattern: /^# (.+)$/ }`. Call `onDeltaInput` with `[{insert:"# Hello"}]` → handler called with match.

### `tests/plugins/ai-completion.test.ts`

Use `vi.useFakeTimers()`. Cover: debounce, triggerMinLength, ghost text set after completion, cancel on new input, stale response dropped, accept/reject, ancestor context.

### `tests/persistence/file-store.test.ts`

Cover: save/load round-trip, load returns null for missing file, atomic write (no .tmp after success), mkdir -p for nested paths, overwrite.

### `tests/integration/e2e.test.ts`

Spawn real headless process via `OutlineClient`. Cover:

- Full CRUD cycle
- Mark and getDeltas round-trip (mark bold → restart → verify mark preserved)
- Readonly mode over IPC
- replaceDeltas with marks
- onChange notifications
- Persistence (save → stop → restart → verify state)
- batch operations
- getBlocksByProp

---

## Non-Obvious Pitfalls

1. **`configTextStyle` before `import`**: Must be in `OutlinerDoc` constructor before `doc.import(bytes)`. If not, marks from saved docs may not load correctly.

2. **Delta type narrowing**: `LoroText.toDelta()` returns Loro's union type. Always filter: `typeof d.insert === "string"`. Never cast blindly.

3. **`isDirty` comparison**: Use `deltasEqual()` from types.ts (span-by-span, JSON.stringify for attributes). Always set `confirmedDeltas` to the value that was *sent* (not re-fetched) to ensure consistent attribute key ordering.

4. **Text change notifications**: Loro's subscribe only fires for tree diffs. After `text.mark/unmark/replaceDeltas` RPC handlers, call `server.notify("onChange", ...)` directly.

5. **`CommandChain` naming**: The internal `execFn` parameter must not shadow the public `exec()` method. Use separate field name.

6. **Last key binding wins**: Iterate `keyBindings` in **reverse** in `handleKeyDown`.

7. **Ghost text accept**: Calls `onDeltaInput` (which goes through debounce + headless sync), NOT `client.replaceDeltas` directly.

8. **WebSocket transport**: Node 20 has no native WebSocket. The stub throws on construction. Document this.

9. **`mergeInterval: 0` bug in Loro**: Setting `mergeInterval: 0` makes Loro merge ALL operations into one undo group. Use `500` (or a value > the test execution time) and rely on `transact()` with `groupStart/groupEnd` for explicit batching.

10. **Soft delete check**: `getBlock()` must check `node.isDeleted()` after `tree.getNodeByID()`. Otherwise deleted blocks are returned.
