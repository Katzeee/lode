# BlockStore: Data-Layer Refactor (formerly ViewStore)

## The Problem

The current `ViewStore` (to be renamed `BlockStore`) has identity confusion. It mixes two incompatible roles:

1. **State management** (belongs here): block cache, selection, command registry, optimistic updates, debounce, reactive subscriptions
2. **UI behaviour** (does not belong here): keyboard event routing, input/paste rules, ghost text UX, rendering notifications

The result is a library that can only be wired to one kind of client — a browser-based keyboard-driven editor. A TUI client using Ink, a programmatic AI agent, or a voice-controlled interface would have to fight against assumptions baked into its design.

## The Vision

`BlockStore` is a **headless reactive state container**. It:

- Holds the local view of headless CRDT state (block cache, selection)
- Manages optimistic updates and debounced text sync
- Provides a reactive subscription API (`subscribeBlock`, `subscribeTree`, `subscribeSelection`)
- Provides a command registry (`exec`, `can`, `chain`)
- Hosts data-only plugins

`BlockStore` does **not**:

- Handle any keyboard events — that is the UI layer's job
- Define what happens when the user presses a key — that is the application's job
- Provide input rules triggered by typing — those depend on knowing what "typing" means (there is no typing in a CLI)
- Provide ghost text / AI completion UX — purely application state
- Tell the UI when to re-render via imperative `notify` calls — subscriptions do that automatically

Users wire their own UI:

```
React / Solid / Vue / Ink / Terminal / Voice / Headless Agent
        │
        │  reads BlockView, Selection (pure data)
        │  calls store.exec() / store.createBlock() etc.
        │  subscribeBlock / subscribeTree / subscribeSelection → re-render
        │  onKeyDown → store.exec('indent') [user's own wiring]
        │  onInput → store.onDeltaInput(id, deltas) [user's own wiring]
        ▼
    BlockStore  (pure state)
        │
    OutlineClient  (IPC)
        │
    Headless Process  (CRDT + persistence)
```

---

## Part 1 — Exact Deletions

### 1.1 Delete `src/plugins/keymap.ts` (entire file)

Keyboard binding is a UI concern. Users wire `onKeyDown → store.exec(name)` themselves.

### 1.2 Delete `src/plugins/input-rules.ts` (entire file)

Input rules depend on "typing" which is a UI concept. Users who want input rules implement them in their text editor layer (`onInput` → inspect text → call store operations).

### 1.3 Delete `src/plugins/ai-completion.ts` (entire file)

Ghost text is application-level ephemeral UI state. It is not block state. The engine has no business managing it. Users maintain ghost text in their component state:

```typescript
// User's React component — this is the right place for this:
const [ghost, setGhost] = useState<string | null>(null);
// On text change: debounce → call fetchCompletion → setGhost
// On Tab: store.onDeltaInput(id, [...deltas, { insert: ghost }]); setGhost(null)
```

### 1.4 Remove from `BlockContext` (`src/view/context.ts`)

```typescript
// DELETE these methods:
bindKey(combo: string, handler: (ctx: BlockContext) => boolean): () => void;
addInputRule(rule: InputRule): () => void;
addPasteRule(rule: PasteRule): () => void;
notify(blockId: BlockId): void;
notifyTree(): void;
acceptGhostText(blockId: BlockId): void;
rejectGhostText(blockId: BlockId): void;

// DELETE these types:
export interface PasteRule { ... }   // no paste rules in engine
```

`InputRule` type also deleted (was exported from `types.ts`).

### 1.5 Remove from `BlockStore` (`src/view/block-store.ts`)

```typescript
// DELETE these private fields:
private keyBindings: Array<...> = [];
private inputRules: InputRule[] = [];
private pasteRules: PasteRule[] = [];

// DELETE these public methods:
handleKeyDown(key: string, modifiers: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }): boolean;
acceptGhostText(blockId: BlockId): void;
rejectGhostText(blockId: BlockId): void;

// DELETE from makeBlockContext():
bindKey: ...,
addInputRule: ...,
addPasteRule: ...,
notify: ...,         // replaced by auto-notify on setExt
notifyTree: ...,     // not needed; tree mutations auto-notify
acceptGhostText: ...,
rejectGhostText: ...,
```

### 1.6 Remove from `StoreEvent` (`src/view/types.ts`)

```typescript
// DELETE:
| { type: "key:down"; key: string; combo: string }
```

`key:down` is a DOM event, not a state event. It has no place in a data-layer event bus.

### 1.7 Remove from `src/index.ts`

```typescript
// DELETE these exports:
export { createAiCompletionPlugin, getGhostText, GHOST_TEXT_KEY } from "./plugins/ai-completion.js";
export type { AiCompletionOptions, AiCompletionContext } from "./plugins/ai-completion.js";
export { createKeymapPlugin } from "./plugins/keymap.js";
export { createInputRulesPlugin } from "./plugins/input-rules.js";
export type { InputRule } from "./view/types.js";    // was re-exported, now gone
export type { PasteRule } from "./view/context.js";  // deleted
```

Also remove from `view/types.ts` re-export:

```typescript
// DELETE from types.ts:
export type { ... PasteRule ... } from "./context.js";
```

Also remove `buildCombo` from index.ts exports — it was an implementation detail for `handleKeyDown`, which is deleted. The function itself can stay in `selection.ts` for users who want it, but it does not need to be a public API.

Actually, keep `buildCombo` exported — users who wire their own keyboard handling may find it useful.

---

## Part 2 — Changes to Existing Code

### 2.1 `src/view/block-store.ts`: auto-notify on `setExt`

Currently, plugins that call `ctx.setExt(blockId, key, val)` must follow with `ctx.notify(blockId)` to trigger subscribers. Since we are removing `ctx.notify`, `setExt` must auto-notify.

Change the internal `setExt` implementation in `makeBlockContext`:

```typescript
// BEFORE:
setExt: (blockId, key, value) => {
  const block = this.blocks.get(blockId);
  if (block) block.ext[key] = value;
},

// AFTER:
setExt: (blockId, key, value) => {
  const block = this.blocks.get(blockId);
  if (block) {
    block.ext[key] = value;
    this.notifyBlockListeners(blockId);  // ← auto-notify
  }
},
```

Tree mutations (`createBlock`, `deleteBlock`, `moveBlock`) already call `notifyTreeListeners` internally, so no change needed there.

### 2.2 `src/view/block-store.ts`: add `subscribeBlock` and `subscribeTree` to `BlockContext`

Plugins currently have no way to set up reactive subscriptions inside `makeBlockContext`. They can use `ctx.on(event, handler)` to react to events, but they cannot set up block-specific subscriptions that fire synchronously when any part of a block's view changes.

Add to `BlockContext`:

```typescript
subscribeBlock(id: BlockId, listener: () => void): () => void;
subscribeTree(listener: () => void): () => void;
```

Add to `makeBlockContext`:

```typescript
subscribeBlock: (id, listener) => this.subscribeBlock(id, listener),
subscribeTree: (listener) => this.subscribeTree(listener),
```

This is the replacement for `ctx.notify` — instead of plugins pushing "re-render now", they set up a pull-based subscription.

### 2.3 `src/view/block-store.ts`: remove input rule triggering from `onDeltaInput`

Remove this block from `onDeltaInput`:

```typescript
// DELETE:
// Run input rules
const text = deltaToText(deltas);
const ctx = this.makeBlockContext("__internal__");
for (const rule of this.inputRules) {
  const match = text.match(rule.pattern);
  if (match) {
    rule.handler(ctx, match, blockId);
    break;
  }
}
```

### 2.4 `src/view/block-store.ts`: remove `handleKeyDown` entirely

The entire method and its supporting data structures (`keyBindings` array) are removed.

### 2.5 `src/view/block-store.ts`: `makeBlockContext` is private

`makeBlockContext` is currently `public`. It should be private — it is an implementation detail used internally to supply `BlockContext` to plugins and commands. Users do not need to call it.

```typescript
// CHANGE:
public makeBlockContext(pluginName: string, storage?: Record<string, unknown>): BlockContext

// TO:
private makeBlockContext(pluginName: string, storage?: Record<string, unknown>): BlockContext
```

---

## Part 3 — New Complete API Specifications

### 3.1 `src/view/context.ts` — BlockContext (cleaned)

```typescript
import type { BlockId, Delta } from "../crdt/types.js";
import type { OutlineClient } from "../client/outline-client.js";
import type { BlockView, Selection, StoreEvent, StoreEventType } from "./types.js";
import type { CommandChain } from "./command.js";

export interface BlockCommandDef {
  execute(ctx: BlockContext, args?: unknown): void | Promise<void>;
  can?(ctx: BlockContext, args?: unknown): boolean;
}

export interface BlockContext {
  // ── Read local state ──────────────────────────────────────────────────
  getBlock(id: BlockId): BlockView | undefined;
  getRootIds(): BlockId[];
  getAllBlockIds(): BlockId[];   // DFS order
  getNext(id: BlockId): BlockView | undefined;
  getPrev(id: BlockId): BlockView | undefined;
  getDescendants(id: BlockId): BlockId[];

  // ── Tree mutations (through BlockStore optimistic path) ─────────────────
  createBlock(parentId?: BlockId, index?: number): Promise<BlockId>;
  deleteBlock(id: BlockId): Promise<void>;
  moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): Promise<void>;

  // ── Text mutations ────────────────────────────────────────────────────
  // Call this whenever block text changes (from any source: keyboard, paste, programmatic).
  // Updates local state immediately; syncs to headless after 300ms debounce.
  onDeltaInput(blockId: BlockId, deltas: Delta): void;
  flushDeltas(blockId: BlockId): Promise<void>;

  // ── Prop mutations ────────────────────────────────────────────────────
  setProp(blockId: BlockId, key: string, value: unknown): Promise<void>;

  // ── Selection & mark queries ──────────────────────────────────────────
  getSelection(): Selection;
  setSelection(sel: Selection): void;
  subscribeSelection(listener: () => void): () => void;
  isMarkActive(markName: string): boolean;
  getMarkValue(markName: string): unknown;

  // ── Command system ────────────────────────────────────────────────────
  registerCommand(name: string, def: BlockCommandDef): void;
  exec(name: string, args?: unknown): boolean;
  can(name: string, args?: unknown): boolean;
  chain(): CommandChain;

  // ── Plugin-private state ──────────────────────────────────────────────
  // setExt auto-notifies subscribeBlock listeners — no manual notify needed.
  setExt(blockId: BlockId, key: string, value: unknown): void;
  getExt(blockId: BlockId, key: string): unknown;
  // Isolated storage for plugin-wide (not per-block) data.
  storage: Record<string, unknown>;

  // ── Inter-plugin communication ─────────────────────────────────────────
  getPlugin<T = unknown>(name: string): T | undefined;

  // ── Reactive subscriptions ─────────────────────────────────────────────
  // Use these instead of notify() / notifyTree().
  subscribeBlock(id: BlockId, listener: () => void): () => void;
  subscribeTree(listener: () => void): () => void;

  // ── Data event subscription ───────────────────────────────────────────
  on<T extends StoreEventType>(
    event: T,
    handler: (e: Extract<StoreEvent, { type: T }>) => void
  ): () => void;

  // ── Headless command bridge ───────────────────────────────────────────
  execEngine(name: string, args?: unknown): Promise<boolean>;
  canEngine(name: string, args?: unknown): Promise<boolean>;

  // ── Direct IPC access (advanced) ──────────────────────────────────────
  readonly client: OutlineClient;
}

export interface InstalledPlugin {
  dispose(): void;
}

export interface BlockStorePlugin {
  readonly name: string;
  readonly priority?: number;
  defaultStorage?(): Record<string, unknown>;
  install(ctx: BlockContext): InstalledPlugin;
  getPublicApi?(): unknown;
}
```

### 3.2 `src/view/types.ts` — BlockView and StoreEvent (cleaned)

```typescript
import type { BlockId, Delta, MarkRange } from "../crdt/types.js";
import type { EventOrigin } from "../engine/types.js";

export interface BlockView {
  readonly id: BlockId;
  deltas: Delta;              // what the UI shows (optimistic)
  confirmedDeltas: Delta;     // last value confirmed by headless
  isDirty: boolean;           // deltas !== confirmedDeltas
  parentId: BlockId | null;
  childIds: BlockId[];
  props: Record<string, unknown>;
  ext: Record<string, unknown>;  // plugin-private data (never synced to headless)
}

export interface Cursor { blockId: BlockId; offset: number; }
export interface TextSelection { type: "text"; anchor: Cursor; focus: Cursor; }
export interface BlockSelection { type: "block"; blockIds: BlockId[]; }
export type Selection = TextSelection | BlockSelection | null;

export type StoreEvent =
  // ── From headless (mirrors EngineEvent) ──────────────────────────────
  | { type: "block:created";   blockId: BlockId; parentId: BlockId | null; isLocal: boolean; origin: EventOrigin }
  | { type: "block:deleted";   blockId: BlockId; isLocal: boolean; origin: EventOrigin }
  | { type: "block:moved";     blockId: BlockId; newParentId: BlockId | null; isLocal: boolean; origin: EventOrigin }
  | { type: "text:changed";    blockId: BlockId; deltas: Delta; isLocal: boolean; origin: EventOrigin }
  | { type: "prop:changed";    blockId: BlockId; key: string; value: unknown; isLocal: boolean; origin: EventOrigin }
  | { type: "mark:changed";    blockId: BlockId; range: MarkRange; markKey: string; isLocal: boolean; origin: EventOrigin }
  // ── BlockStore-internal ──────────────────────────────────────────────
  | { type: "delta:input";     blockId: BlockId; deltas: Delta }
  | { type: "delta:committed"; blockId: BlockId; deltas: Delta }
  | { type: "selection:change"; selection: Selection }
  | { type: "command:executed"; name: string; args?: unknown; success: boolean }
  | { type: "readonly:change"; readonly: boolean };

export type StoreEventType = StoreEvent["type"];

// Re-exports from context.ts
export type { BlockContext, BlockCommandDef, BlockStorePlugin, InstalledPlugin } from "./context.js";
```

Note: `InputRule`, `PasteRule` are gone. `key:down` event is gone.

### 3.3 `src/view/block-store.ts` — BlockStore public API (cleaned)

```typescript
export class BlockStore {
  constructor(client: OutlineClient) {}

  // ── Plugin registration (before mount) ───────────────────────────────
  use(plugin: BlockStorePlugin): this;

  // ── Lifecycle ─────────────────────────────────────────────────────────
  async mount(): Promise<void>;
  async unmount(): Promise<void>;

  // ── Readonly ──────────────────────────────────────────────────────────
  get readonly(): boolean;
  set readonly(val: boolean);

  // ── Block CRUD (optimistic) ───────────────────────────────────────────
  async createBlock(parentId?: BlockId, index?: number): Promise<BlockId>;
  async deleteBlock(id: BlockId): Promise<void>;
  async moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): Promise<void>;

  // ── Text ──────────────────────────────────────────────────────────────
  // Call whenever block content changes — from any input source.
  onDeltaInput(blockId: BlockId, deltas: Delta): void;
  async flushDeltas(blockId: BlockId): Promise<void>;

  // ── Props ─────────────────────────────────────────────────────────────
  async setProp(blockId: BlockId, key: string, value: unknown): Promise<void>;

  // ── Query ─────────────────────────────────────────────────────────────
  getBlock(id: BlockId): BlockView | undefined;
  getRootIds(): BlockId[];
  getAllBlockIds(): BlockId[];
  getNext(id: BlockId): BlockView | undefined;
  getPrev(id: BlockId): BlockView | undefined;
  getDescendants(id: BlockId): BlockId[];

  // ── Selection ─────────────────────────────────────────────────────────
  getSelection(): Selection;
  setSelection(sel: Selection): void;
  subscribeSelection(listener: () => void): () => void;
  isMarkActive(markName: string): boolean;
  getMarkValue(markName: string): unknown;

  // ── Commands ──────────────────────────────────────────────────────────
  registerCommand(name: string, def: BlockCommandDef): void;
  exec(name: string, args?: unknown): boolean;
  can(name: string, args?: unknown): boolean;
  chain(): CommandChain;

  // ── Reactive subscriptions ─────────────────────────────────────────────
  subscribeBlock(id: BlockId, listener: () => void): () => void;
  subscribeTree(listener: () => void): () => void;
}
```

**Removed from public API**: `handleKeyDown`, `acceptGhostText`, `rejectGhostText`, `makeBlockContext`.

---

## Part 4 — File-by-File Changes

### Files to DELETE entirely

```
src/plugins/keymap.ts
src/plugins/input-rules.ts
src/plugins/ai-completion.ts
```

### Files to MODIFY

**`src/view/context.ts`** — Complete rewrite per spec in Part 3.1. Rename `ViewContext` → `BlockContext`, `ViewCommandDef` → `BlockCommandDef`, `ViewStorePlugin` → `BlockStorePlugin`.
- Remove: `PasteRule`, `bindKey`, `addInputRule`, `addPasteRule`, `notify`, `notifyTree`, `acceptGhostText`, `rejectGhostText`
- Add: `subscribeBlock`, `subscribeTree`

**`src/view/types.ts`** — Update per spec in Part 3.2.
- Remove: `InputRule` interface, `PasteRule` re-export, `key:down` from `StoreEvent`
- Remove from re-exports: `PasteRule`, `InputRule`
- Update re-exports: `ViewContext` → `BlockContext`, `ViewCommandDef` → `BlockCommandDef`, `ViewStorePlugin` → `BlockStorePlugin`

**`src/view/block-store.ts`** (renamed from `view-store.ts`) — Modify per Part 2. Rename class `ViewStore` → `BlockStore`, method `makeViewContext` → `makeBlockContext`.
- Remove private fields: `keyBindings`, `inputRules`, `pasteRules`
- Remove public methods: `handleKeyDown`, `acceptGhostText`, `rejectGhostText`
- Remove from `onDeltaInput`: the input rule loop block
- Remove from `makeBlockContext`: `bindKey`, `addInputRule`, `addPasteRule`, `notify`, `notifyTree`, `acceptGhostText`, `rejectGhostText`
- Add to `makeBlockContext`: `subscribeBlock`, `subscribeTree`
- Change `setExt` in `makeBlockContext` to auto-notify after mutation
- Change `makeBlockContext` from `public` to `private`

**`src/view/plugin-registry.ts`** — Rename `ViewPluginRegistry` → `BlockPluginRegistry`.

**`src/index.ts`** — Update exports:
- Remove all plugin exports (`createAiCompletionPlugin`, `getGhostText`, `GHOST_TEXT_KEY`, `AiCompletionOptions`, `AiCompletionContext`, `createKeymapPlugin`, `createInputRulesPlugin`)
- Remove `InputRule` from view type exports
- Remove `PasteRule` from view type exports
- Update renamed symbols: `ViewStore` → `BlockStore`, `ViewContext` → `BlockContext`, `ViewCommandDef` → `BlockCommandDef`, `ViewStorePlugin` → `BlockStorePlugin`, `ViewPluginRegistry` → `BlockPluginRegistry`
- Keep `buildCombo` export (useful for users wiring their own keyboard handlers)

### Files unchanged

```
src/engine/types.ts
src/engine/plugin-manager.ts
src/crdt/types.ts
src/crdt/block.ts
src/crdt/outliner-doc.ts
src/rpc/transport.ts
src/rpc/types.ts
src/rpc/server.ts
src/rpc/methods.ts
src/persistence/file-store.ts
src/bin/serve.ts
src/view/selection.ts
src/view/command.ts
src/view/plugin-registry.ts
src/client/outline-client.ts
```

---

## Part 5 — Implementation Order

1. Delete `src/plugins/keymap.ts`
2. Delete `src/plugins/input-rules.ts`
3. Delete `src/plugins/ai-completion.ts`
4. Rewrite `src/view/context.ts` per Part 3.1
5. Rewrite `src/view/types.ts` per Part 3.2
6. Modify `src/view/block-store.ts` per Part 2 and 3.3
7. Update `src/index.ts`
8. Update all tests (see Part 6)
9. Run `npm test` — target: 0 failures

---

## Part 6 — Test Changes

### Delete test files

```
tests/plugins/keymap.test.ts
tests/plugins/input-rules.test.ts
tests/plugins/ai-completion.test.ts
```

### Modify `tests/view/view-store.test.ts`

Remove test groups:
- `"handleKeyDown"` — entire group (method deleted)
- `"input rules"` — entire group (feature deleted)
- `"ghost text (Delta-based)"` — entire group (`acceptGhostText`/`rejectGhostText` deleted)

Update mock client: remove any references to plugin methods that no longer exist.

Add test group: `"setExt auto-notifies subscribeBlock"`:
```typescript
it("setExt triggers subscribeBlock listener", async () => {
  const id = await store.createBlock();
  const listener = vi.fn();
  store.subscribeBlock(id, listener);

  // Simulate a plugin setting ext
  // Need to access ctx through a plugin
  let capturedCtx!: BlockContext;
  store.use({
    name: "test-ext",
    install(ctx) { capturedCtx = ctx; return { dispose() {} }; }
  });
  await store.mount(); // plugin is installed during mount

  capturedCtx.setExt(id, "flag", true);
  expect(listener).toHaveBeenCalled();
  expect(store.getBlock(id)?.ext["flag"]).toBe(true);
});
```

Add test: `"subscribeBlock and subscribeTree available in BlockContext"`:
```typescript
it("subscribeBlock is accessible from BlockContext", async () => {
  let ctxSub: (() => void) | undefined;
  store.use({
    name: "sub-test",
    install(ctx) {
      // Plugin can subscribe to individual blocks
      ctxSub = ctx.subscribeBlock("some-id", () => {});
      return { dispose() { ctxSub?.(); } };
    }
  });
  await store.mount();
  expect(ctxSub).toBeDefined();
});
```

Remove test: `"plugin context includes notify and notifyTree"` (if exists).

### Modify `tests/view/view-store.test.ts` — StoreEvent references

Remove any test that checks for `type: "key:down"` events.
Remove any test that checks `"delta:committed"` if removed (keep if retained).

### Verify remaining tests still pass

The following groups should pass without changes:
- `"Block CRUD"` group
- `"onDeltaInput"` group (minus input rule sub-tests)
- `"flushDeltas"` group
- `"setProp"` group
- `"readonly mode"` group
- `"selection"` group
- `"isMarkActive / getMarkValue"` group
- `"command system"` group
- `"plugin system"` group (minus bindKey/inputRule sub-tests)
- `"remote changes"` group

---

## Part 7 — How Users Wire Their UI

This section is documentation context. The refactor removes features users might rely on. Here is how each removed feature is replaced by user code.

### Keyboard shortcuts

**Before (engine provided):**
```typescript
store.use(createKeymapPlugin({ "Mod-b": "toggleBold", "Tab": "indent" }));
```

**After (user wires from their framework):**
```typescript
// React example:
<div onKeyDown={(e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    store.exec("indent", { blockId: focusedBlockId });
    return;
  }
  const combo = buildCombo(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
  if (combo === "Mod-b") store.exec("toggleBold");
}} />

// Ink (TUI) example:
useInput((input, key) => {
  if (key.tab) store.exec("indent", { blockId: focusedId });
});
```

### Input rules (e.g. `# ` → heading)

**Before (engine provided):**
```typescript
store.use(createInputRulesPlugin([
  { pattern: /^# (.+)$/, handler: (ctx, match, blockId) => ctx.setProp(blockId, "type", "heading") }
]));
```

**After (user handles in their text input logic):**
```typescript
function handleTextChange(blockId: string, newText: string, newDeltas: Delta[]) {
  store.onDeltaInput(blockId, newDeltas);
  // Input rule check — user owns this logic
  const text = deltaToText(newDeltas);
  if (/^# (.+)$/.test(text)) {
    store.setProp(blockId, "type", "heading");
    store.onDeltaInput(blockId, [{ insert: text.slice(2) }]); // strip the "# "
  }
}
```

### AI ghost text

**Before (engine provided):**
```typescript
store.use(createAiCompletionPlugin({ fetchCompletion }));
// UI reads block.ext["ghostText"]
// Tab → store.acceptGhostText(blockId)
```

**After (user manages in component state):**
```typescript
// React example — ghost text is component state, not store state:
function BlockEditor({ blockId }: { blockId: string }) {
  const block = useBlock(blockId);                    // your React adapter
  const [ghost, setGhost] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  function handleInput(newDeltas: Delta[]) {
    store.onDeltaInput(blockId, newDeltas);
    setGhost(null);
    clearTimeout(timerRef.current);
    const text = deltaToText(newDeltas);
    if (text.length >= 3) {
      timerRef.current = setTimeout(async () => {
        const suggestion = await fetchCompletion(text);
        if (suggestion) setGhost(suggestion);
      }, 600);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Tab" && ghost) {
      e.preventDefault();
      store.onDeltaInput(blockId, [...(block?.deltas ?? []), { insert: ghost }]);
      setGhost(null);
    } else if (e.key === "Escape") {
      setGhost(null);
    }
  }

  return (
    <div onKeyDown={handleKeyDown}>
      <RichTextEditor deltas={block?.deltas ?? []} onChange={handleInput} />
      {ghost && <span style={{ opacity: 0.4 }}>{ghost}</span>}
    </div>
  );
}
```

### React adapter pattern

The engine provides `subscribeBlock` and `subscribeTree`. Users build their framework hooks:

```typescript
// Optional @block-engine/react package (not part of the engine):
function useBlock(store: BlockStore, id: string): BlockView | undefined {
  return useSyncExternalStore(
    (cb) => store.subscribeBlock(id, cb),
    () => store.getBlock(id),
  );
}

function useRootIds(store: BlockStore): string[] {
  return useSyncExternalStore(
    (cb) => store.subscribeTree(cb),
    () => store.getRootIds(),
  );
}

function useSelection(store: BlockStore): Selection {
  return useSyncExternalStore(
    (cb) => store.subscribeSelection(cb),
    () => store.getSelection(),
  );
}
```

For Solid:
```typescript
function createBlockSignal(store: BlockStore, id: string) {
  const [block, setBlock] = createSignal(store.getBlock(id));
  store.subscribeBlock(id, () => setBlock(store.getBlock(id)));
  return block;
}
```

For Ink (TUI):
```typescript
function useBlock(store: BlockStore, id: string) {
  const [block, setBlock] = useState(store.getBlock(id));
  useEffect(() => store.subscribeBlock(id, () => setBlock(store.getBlock(id))), [id]);
  return block;
}
```

---

## Part 8 — What Remains Available for Data Plugins

After the refactor, `BlockStorePlugin` is for **data automation** — things that watch and transform the document's state without any UI concerns. Legitimate uses:

**Backlink indexer**: watches `text:changed` events, parses `[[blockId]]` references, stores index in plugin storage.

```typescript
const backlinkPlugin: BlockStorePlugin = {
  name: "backlinks",
  defaultStorage: () => ({ index: new Map<string, Set<string>>() }),
  install(ctx) {
    const index = ctx.storage.index as Map<string, Set<string>>;
    const unsub = ctx.on("text:changed", ({ blockId, deltas }) => {
      const text = deltaToText(deltas);
      const refs = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
      index.set(blockId, new Set(refs));
    });
    return { dispose: unsub };
  },
  getPublicApi() {
    return { getBacklinks: (id: string) => /* ... */ [] };
  }
};
```

**Auto-save on change**: watches for changes and triggers periodic save.

```typescript
const autoSavePlugin: BlockStorePlugin = {
  name: "auto-save",
  install(ctx) {
    let timer: ReturnType<typeof setTimeout>;
    const save = () => { clearTimeout(timer); timer = setTimeout(() => ctx.client.save(), 2000); };
    const unsubs = [
      ctx.on("text:changed", save),
      ctx.on("block:created", save),
      ctx.on("block:deleted", save),
      ctx.on("prop:changed", save),
    ];
    return { dispose() { unsubs.forEach(u => u()); clearTimeout(timer); } };
  }
};
```

These plugins use only data operations: `ctx.on`, `ctx.storage`, `ctx.client`, `ctx.getBlock`. No keyboard, no rendering, no UI.

---

## Part 9 — Updated `src/index.ts`

```typescript
// CRDT types
export type { BlockId, BlockSnapshot, BlockChange, DocSnapshot, Delta, DeltaInsert, MarkRange } from "./crdt/types.js";
export { deltaToText, textToDelta, deltasEqual } from "./crdt/types.js";

// Headless internals
export { OutlinerDoc } from "./crdt/outliner-doc.js";
export { Block } from "./crdt/block.js";
export { FileStore } from "./persistence/file-store.js";
export { RpcServer } from "./rpc/server.js";
export { StdioTransport, WebSocketTransport } from "./rpc/transport.js";
export type { Transport } from "./rpc/transport.js";
export { registerMethods } from "./rpc/methods.js";

// Engine plugin system
export { EnginePluginManager } from "./engine/plugin-manager.js";
export type {
  EngineEvent, EngineContext, EnginePlugin,
  EngineCommandDef, MutationHookContext, EventOrigin,
} from "./engine/types.js";

// Client SDK
export { OutlineClient } from "./client/outline-client.js";
export type { OutlineClientOptions } from "./client/outline-client.js";

// BlockStore — data state layer
export { BlockStore } from "./view/block-store.js";
export type {
  BlockView,
  Selection, TextSelection, BlockSelection, Cursor,
  StoreEvent, StoreEventType,
} from "./view/types.js";
export type {
  BlockContext, BlockCommandDef, BlockStorePlugin, InstalledPlugin,
} from "./view/context.js";
export { CommandChain } from "./view/command.js";
export { BlockPluginRegistry } from "./view/plugin-registry.js";

// Selection utilities (useful for users wiring their own keyboard/UI)
export { getAttributesAtOffset, isMarkActive, getMarkValue, buildCombo } from "./view/selection.js";
```

---

## Part 10 — Rename ViewStore → BlockStore

The name `ViewStore` carries the wrong connotation — "View" implies rendering/UI responsibility, which contradicts the data-layer vision. `BlockStore` is accurate: it is a store of block state.

### Symbols to rename

| Old name | New name | File |
|---|---|---|
| `ViewStore` | `BlockStore` | `src/view/block-store.ts` |
| `ViewStorePlugin` | `BlockStorePlugin` | `src/view/context.ts` |
| `ViewContext` | `BlockContext` | `src/view/context.ts` |
| `ViewCommandDef` | `BlockCommandDef` | `src/view/context.ts` |
| `ViewPluginRegistry` | `BlockPluginRegistry` | `src/view/plugin-registry.ts` |
| `InstalledPlugin` | `InstalledPlugin` | unchanged |

### File to rename

```
src/view/view-store.ts  →  src/view/block-store.ts
```

The `view/` directory name is acceptable as a container for the client-side data layer; no need to rename the directory itself.

### Update all imports

Every file that imports from `"./view-store.js"` or `"../view/view-store.js"` must update to `"./block-store.js"` / `"../view/block-store.js"`.

Files affected:
- `src/index.ts`
- `src/view/context.ts` (if it imports ViewStore)
- `tests/view/view-store.test.ts` → rename file to `tests/view/block-store.test.ts`

### Update test file name

```
tests/view/view-store.test.ts  →  tests/view/block-store.test.ts
```

### Update `src/index.ts` exports

```typescript
// BEFORE:
export { ViewStore } from "./view/view-store.js";
export type { ViewContext, ViewCommandDef, ViewStorePlugin, InstalledPlugin } from "./view/context.js";
export { ViewPluginRegistry } from "./view/plugin-registry.js";

// AFTER:
export { BlockStore } from "./view/block-store.js";
export type { BlockContext, BlockCommandDef, BlockStorePlugin, InstalledPlugin } from "./view/context.js";
export { BlockPluginRegistry } from "./view/plugin-registry.js";
```

### Implementation order within Part 5

Insert as step 0 (before any other changes to reduce merge conflicts):

```
0a. Rename file: src/view/view-store.ts → src/view/block-store.ts
0b. Rename file: tests/view/view-store.test.ts → tests/view/block-store.test.ts
0c. Rename symbols across all files (use global find-replace):
    ViewStore       → BlockStore
    ViewStorePlugin → BlockStorePlugin
    ViewContext     → BlockContext
    ViewCommandDef  → BlockCommandDef
    ViewPluginRegistry → BlockPluginRegistry
    view-store      → block-store  (in import paths only)
```

Doing the rename first keeps subsequent diffs clean.

---

## Summary Table

| Item | Action | Reason |
|---|---|---|
| `src/plugins/keymap.ts` | **DELETE** | UI concern |
| `src/plugins/input-rules.ts` | **DELETE** | UI concern |
| `src/plugins/ai-completion.ts` | **DELETE** | Application concern |
| `BlockContext.bindKey` | **REMOVE** | UI concern |
| `BlockContext.addInputRule` | **REMOVE** | UI concern |
| `BlockContext.addPasteRule` | **REMOVE** | UI concern |
| `BlockContext.notify` | **REMOVE** | Rendering directive; auto-notify on setExt |
| `BlockContext.notifyTree` | **REMOVE** | Rendering directive; tree mutations auto-notify |
| `BlockContext.acceptGhostText` | **REMOVE** | Application UX |
| `BlockContext.rejectGhostText` | **REMOVE** | Application UX |
| `PasteRule` type | **REMOVE** | UI concern |
| `InputRule` type | **REMOVE** | UI concern |
| `StoreEvent["key:down"]` | **REMOVE** | DOM event, not state |
| `BlockStore.handleKeyDown` | **REMOVE** | UI concern |
| `BlockStore.acceptGhostText` | **REMOVE** | Application UX |
| `BlockStore.rejectGhostText` | **REMOVE** | Application UX |
| `BlockStore.makeBlockContext` | **MAKE PRIVATE** | Implementation detail |
| `BlockContext.subscribeBlock` | **ADD** | Replaces ctx.notify |
| `BlockContext.subscribeTree` | **ADD** | Replaces ctx.notifyTree |
| `setExt` auto-notify | **ADD** | Triggers subscribeBlock on ext change |
| All deleted plugin exports | **REMOVE** from index.ts | |
| `ViewStore` | **RENAME → `BlockStore`** | "View" implies rendering concern |
| `ViewStorePlugin` | **RENAME → `BlockStorePlugin`** | Consistency with BlockStore |
| `ViewContext` | **RENAME → `BlockContext`** | Consistency with BlockStore |
| `ViewCommandDef` | **RENAME → `BlockCommandDef`** | Consistency with BlockStore |
| `ViewPluginRegistry` | **RENAME → `BlockPluginRegistry`** | Consistency with BlockStore |
| `src/view/view-store.ts` | **RENAME → `block-store.ts`** | Matches class name |
| `tests/view/view-store.test.ts` | **RENAME → `block-store.test.ts`** | Matches source file |
