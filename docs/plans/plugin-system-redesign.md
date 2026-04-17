# Plugin System Redesign — Complete Specification

## 1. Problem Statement

The current plugin architecture has four structural flaws identified from code analysis:

### Flaw 1 — Single plugin layer (ViewStore only)

All plugins live in `ViewStore`. The headless process has no plugin system:

```
src/view/view-store.ts  ← makePluginContext(), all plugin hooks
src/crdt/outliner-doc.ts  ← no hooks, no plugin awareness
```

This means:
- Pre-mutation validation (schema enforcement, permission checks) is impossible — the write already committed before any plugin can intercept it
- Background automation (backlink indexing, full-text indexing, auto-save throttle) must run on every connected client independently — no shared server-side logic
- AI agents and CLI tools (`OutlineClient` directly) operate outside the plugin system entirely

### Flaw 2 — Headless emits one coarse event

From `src/rpc/methods.ts`, the headless notifies clients via exactly three `server.notify()` calls, all producing the same shape:

```typescript
server.notify("onChange", { changes: [{ action: "update", blockId }] })
// ↑ same for text.replaceDeltas, text.mark, text.unmark
```

From `src/crdt/outliner-doc.ts`, the `handleEvent` only captures tree diffs:

```typescript
if (e.diff?.type === "tree") {
  // action: "create" | "delete" | "move" only
}
```

Missing from every event: `isLocal` (was this from the current client?), `origin` (user/undo/peer), what specifically changed (which prop? what text delta? which mark?). Consumers must re-fetch full state on every `"update"`.

### Flaw 3 — `CommandContext` cannot compose commands

`CommandContext` (used inside `CommandDef.execute`):

```typescript
interface CommandContext {
  getBlock(id): BlockView | undefined;
  getRootIds(): BlockId[];
  getSelection(): Selection;
  setSelection(sel): void;
  readonly client: OutlineClient;   // raw IPC, bypasses ViewStore
}
```

There is no `exec`, no `can`, no `chain` — commands cannot call other commands.
Tree mutations (`createBlock`, `deleteBlock`, `moveBlock`) require `ctx.client.*` which bypasses
ViewStore's optimistic update system (`pendingOps`), causing double-apply bugs.

### Flaw 4 — `PluginContext` and `CommandContext` are two separate types for the same role

Plugins write handlers that receive `PluginContext`. Commands receive `CommandContext`.
They share ~80% of their semantics but are different types, so:
- Plugin handlers can't be reused as commands
- Command logic can't access plugin state (`setExt`, `getExt`, keyboard registration)
- There is no single "what can I do from here" mental model

---

## 2. Design Goals

1. **Two plugin layers**: headless (`EnginePlugin`) + client (`ViewPlugin`), each with appropriate power
2. **Unified context**: one `ViewContext` type replaces both `PluginContext` and `CommandContext`
3. **Granular events**: `EngineEvent` on headless (with `isLocal`, `origin`, specific field), `StoreEvent` on client
4. **Commands compose**: `ViewContext.exec/can/chain` available everywhere including inside command `execute`
5. **Tree mutations in context**: `createBlock/deleteBlock/moveBlock` go through ViewStore's optimistic path, not raw `client.*`
6. **Inter-plugin communication**: `ctx.getPlugin(name)` returns another plugin's public API
7. **Plugin storage**: each plugin has an isolated `storage` object (not just per-block `ext`)
8. **Headless commands via RPC**: commands registered in `EnginePlugin` are callable from any client via `client.execCommand(name, args)`
9. **Multi-client broadcasting**: RpcServer maintains N connections; notifies all on any mutation

---

## 3. Target Architecture

```
┌─ Headless Process ──────────────────────────────────────────────────┐
│                                                                      │
│  EnginePluginManager                                                 │
│    ├── EnginePlugin[]  (schema validator, backlink indexer, etc.)    │
│    └── pre/post mutation hooks, headless command registry            │
│                                                                      │
│  OutlinerDoc  ←────── mutation hooks fire here (before commit)       │
│    └── emits EngineEvent[]  (granular: isLocal, origin, field)       │
│                                                                      │
│  RpcServer  (multi-client: Map<clientId, Transport>)                 │
│    ├── notifyAll(event)    ← broadcast to every connected client     │
│    └── engine.exec / engine.can  ← headless commands via RPC         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
          ↕ JSON-RPC 2.0 (stdio or WebSocket per client)
┌─ Client (ViewStore) ────────────────────────────────────────────────┐
│                                                                      │
│  ViewPluginRegistry                                                  │
│    └── ViewPlugin[]  (keymap, input-rules, ai-completion, etc.)      │
│                                                                      │
│  ViewContext  (unified: replaces PluginContext + CommandContext)      │
│    ├── tree mutations → ViewStore optimistic path                    │
│    ├── exec/can/chain → command registry                             │
│    ├── getPlugin(name) → inter-plugin                                │
│    └── storage → plugin-isolated state                               │
│                                                                      │
│  StoreEvent  (granular client-side events)                           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Detailed Interface Specifications

### 4.1 `EngineEvent` — Granular headless events

Replaces the current single `BlockChange` with a discriminated union that carries precise change information.

```typescript
// src/engine/types.ts

export type EventOrigin =
  | "local"          // change from the client that sent the RPC
  | "undo"           // UndoManager undo
  | "redo"           // UndoManager redo
  | "import"         // doc.import(bytes)
  | `peer:${string}` // future: CRDT sync from remote peer

export type EngineEvent =
  | {
      type: "block:created";
      blockId: BlockId;
      parentId: BlockId | null;
      index: number;
      isLocal: boolean;
      origin: EventOrigin;
    }
  | {
      type: "block:deleted";
      blockId: BlockId;
      isLocal: boolean;
      origin: EventOrigin;
    }
  | {
      type: "block:moved";
      blockId: BlockId;
      oldParentId: BlockId | null;
      newParentId: BlockId | null;
      newIndex: number;
      isLocal: boolean;
      origin: EventOrigin;
    }
  | {
      type: "text:changed";
      blockId: BlockId;
      deltas: Delta;          // the NEW full delta (avoids re-fetch)
      isLocal: boolean;
      origin: EventOrigin;
    }
  | {
      type: "prop:changed";
      blockId: BlockId;
      key: string;
      value: unknown;
      isLocal: boolean;
      origin: EventOrigin;
    }
  | {
      type: "mark:changed";
      blockId: BlockId;
      range: MarkRange;
      markKey: string;
      markValue: unknown;
      isLocal: boolean;
      origin: EventOrigin;
    }
  | { type: "doc:saved";    path: string }
  | { type: "doc:loaded";   path: string }
  | { type: "readonly:on" }
  | { type: "readonly:off" }
  | { type: "history:push" }
  | { type: "history:undo"; canUndo: boolean; canRedo: boolean }
  | { type: "history:redo"; canUndo: boolean; canRedo: boolean };
```

**Wire format to clients**: `EngineEvent[]` replaces `BlockChange[]` in `onChange` notifications.
The `OutlineClient.onChange` callback type updates accordingly.

---

### 4.2 `EngineContext` — Headless plugin context

```typescript
// src/engine/types.ts

export interface EngineCommandDef {
  execute(ctx: EngineContext, args?: unknown): void | Promise<void>;
  can?(ctx: EngineContext, args?: unknown): boolean;
}

export interface MutationHookContext {
  blockId: BlockId;
  cancel(): void;   // call to abort the mutation (throws RpcError(REJECTED))
}

export interface EngineContext {
  // ── Data access (authoritative CRDT state) ──────────────────────────
  getBlock(id: BlockId): import("../crdt/block.js").Block | null;
  getRootBlocks(): import("../crdt/block.js").Block[];
  getAllBlocks(): import("../crdt/block.js").Block[];
  getBlocksByProp(key: string, value: unknown): import("../crdt/block.js").Block[];
  getNext(id: BlockId): import("../crdt/block.js").Block | null;
  getPrev(id: BlockId): import("../crdt/block.js").Block | null;

  // ── Mutations ────────────────────────────────────────────────────────
  createBlock(parentId?: BlockId, index?: number): import("../crdt/block.js").Block;
  deleteBlock(id: BlockId): void;
  moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): void;
  markBlock(id: BlockId, range: MarkRange, key: string, value: unknown): void;
  unmarkBlock(id: BlockId, range: MarkRange, key: string): void;
  replaceDeltasBlock(id: BlockId, deltas: Delta): void;
  setPropBlock(id: BlockId, key: string, value: unknown): void;
  transact(fn: () => void): void;

  // ── History ──────────────────────────────────────────────────────────
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;

  // ── Mutation hooks ───────────────────────────────────────────────────
  // Return false from handler OR call ctx.cancel() to abort.
  onBefore(
    type: "create" | "delete" | "move" | "text" | "prop" | "mark",
    handler: (hookCtx: MutationHookContext) => void | boolean | Promise<void | boolean>
  ): () => void;
  onAfter(
    type: EngineEvent["type"],
    handler: (event: EngineEvent) => void | Promise<void>
  ): () => void;

  // ── RPC extension ────────────────────────────────────────────────────
  // Plugin can add new RPC methods (e.g., "search.query", "backlinks.get")
  registerRpcMethod(name: string, handler: import("../rpc/server.js").RpcHandler): void;
  // Broadcast an event to ALL connected clients
  notifyAllClients(event: EngineEvent): void;

  // ── Headless commands ────────────────────────────────────────────────
  // Callable via RPC: engine.exec / engine.can from any client
  registerCommand(name: string, def: EngineCommandDef): void;

  // ── Inter-plugin ─────────────────────────────────────────────────────
  getPlugin<T = unknown>(name: string): T | undefined;

  // ── Plugin-isolated storage ──────────────────────────────────────────
  storage: Record<string, unknown>;
}

export interface EnginePlugin {
  readonly name: string;
  install(ctx: EngineContext): { dispose(): void };
}
```

---

### 4.3 `StoreEvent` — Granular client-side events

Replaces the current `StoreEvent` type. Now includes events derived from `EngineEvent` plus ViewStore-internal events.

```typescript
// src/view/types.ts

export type StoreEvent =
  // ── Mirrored from EngineEvent (with ViewStore enrichment) ──
  | { type: "block:created";   blockId: BlockId; parentId: BlockId | null; isLocal: boolean; origin: EventOrigin }
  | { type: "block:deleted";   blockId: BlockId; isLocal: boolean; origin: EventOrigin }
  | { type: "block:moved";     blockId: BlockId; newParentId: BlockId | null; isLocal: boolean; origin: EventOrigin }
  | { type: "text:changed";    blockId: BlockId; deltas: Delta; isLocal: boolean; origin: EventOrigin }
  | { type: "prop:changed";    blockId: BlockId; key: string; value: unknown; isLocal: boolean; origin: EventOrigin }
  | { type: "mark:changed";    blockId: BlockId; range: MarkRange; markKey: string; isLocal: boolean; origin: EventOrigin }
  // ── ViewStore-internal ─────────────────────────────────────
  | { type: "delta:input";     blockId: BlockId; deltas: Delta }          // user typed
  | { type: "delta:committed"; blockId: BlockId; deltas: Delta }          // after debounce flush
  | { type: "selection:change"; selection: Selection }
  | { type: "key:down";        key: string; combo: string }
  | { type: "command:executed"; name: string; args?: unknown; success: boolean }
  | { type: "readonly:change"; readonly: boolean };

export type StoreEventType = StoreEvent["type"];
```

---

### 4.4 `ViewContext` — Unified client plugin/command context

This **replaces both `PluginContext` and `CommandContext`**. Everything available in one type.

```typescript
// src/view/context.ts

export interface PasteRule {
  // Applied when text is pasted; return null to skip
  pattern: RegExp;
  handler(ctx: ViewContext, match: RegExpMatchArray, blockId: BlockId, pastedText: string): void | null;
}

export interface ViewCommandDef {
  execute(ctx: ViewContext, args?: unknown): void | Promise<void>;
  can?(ctx: ViewContext, args?: unknown): boolean;
}

export interface ViewContext {
  // ── Read local state ────────────────────────────────────────────────
  getBlock(id: BlockId): BlockView | undefined;
  getRootIds(): BlockId[];
  getAllBlockIds(): BlockId[];          // DFS order
  getNext(id: BlockId): BlockView | undefined;
  getPrev(id: BlockId): BlockView | undefined;
  getDescendants(id: BlockId): BlockId[];

  // ── Tree mutations (go through ViewStore optimistic path) ────────────
  createBlock(parentId?: BlockId, index?: number): Promise<BlockId>;
  deleteBlock(id: BlockId): Promise<void>;
  moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): Promise<void>;

  // ── Text mutations ───────────────────────────────────────────────────
  onDeltaInput(blockId: BlockId, deltas: Delta): void;
  flushDeltas(blockId: BlockId): Promise<void>;

  // ── Prop mutations ───────────────────────────────────────────────────
  setProp(blockId: BlockId, key: string, value: unknown): Promise<void>;

  // ── Ghost text ───────────────────────────────────────────────────────
  acceptGhostText(blockId: BlockId): void;
  rejectGhostText(blockId: BlockId): void;

  // ── Selection & mark queries ─────────────────────────────────────────
  getSelection(): Selection;
  setSelection(sel: Selection): void;
  subscribeSelection(listener: () => void): () => void;
  isMarkActive(markName: string): boolean;
  getMarkValue(markName: string): unknown;

  // ── Command system (commands CAN call other commands) ─────────────────
  registerCommand(name: string, def: ViewCommandDef): void;
  exec(name: string, args?: unknown): boolean;
  can(name: string, args?: unknown): boolean;
  chain(): import("./command.js").CommandChain;

  // ── Keyboard & input ─────────────────────────────────────────────────
  bindKey(combo: string, handler: (ctx: ViewContext) => boolean): () => void;
  addInputRule(rule: InputRule): () => void;
  addPasteRule(rule: PasteRule): () => void;     // NEW

  // ── Plugin-private state ─────────────────────────────────────────────
  setExt(blockId: BlockId, key: string, value: unknown): void;
  getExt(blockId: BlockId, key: string): unknown;
  // Plugin-isolated storage (not per-block — plugin-wide)
  storage: Record<string, unknown>;

  // ── Inter-plugin communication ────────────────────────────────────────
  getPlugin<T = unknown>(name: string): T | undefined;

  // ── Reactive notifications ────────────────────────────────────────────
  notify(blockId: BlockId): void;
  notifyTree(): void;

  // ── Event subscription ───────────────────────────────────────────────
  on<T extends StoreEventType>(
    event: T,
    handler: (e: Extract<StoreEvent, { type: T }>) => void
  ): () => void;

  // ── Engine access (headless commands + raw IPC) ───────────────────────
  // Call a headless-registered command (available to AI agents too)
  execEngine(name: string, args?: unknown): Promise<boolean>;
  canEngine(name: string, args?: unknown): Promise<boolean>;
  readonly client: OutlineClient;
}
```

**`ViewStorePlugin` updated:**

```typescript
export interface ViewStorePlugin {
  readonly name: string;
  readonly priority?: number;           // higher = installed first, higher key binding precedence
  defaultStorage?(): Record<string, unknown>;  // initial storage value
  install(ctx: ViewContext): { dispose(): void };
  // Optional: expose public API to other plugins via getPlugin(name)
  getPublicApi?(): unknown;
}
```

---

### 4.5 `CommandChain` updated

`CommandChain` uses `ViewContext` instead of the defunct `CommandContext`:

```typescript
// src/view/command.ts

export class CommandChain {
  private readonly ops: Array<{ name: string; args?: unknown }> = [];
  constructor(private readonly ctx: ViewContext) {}

  exec(name: string, args?: unknown): this {
    this.ops.push({ name, args });
    return this;
  }

  run(): boolean {
    for (const op of this.ops) {
      if (!this.ctx.exec(op.name, op.args)) return false;
    }
    return true;
  }
}
```

---

### 4.6 `EnginePluginManager` — Headless plugin host

```typescript
// src/engine/plugin-manager.ts

export class EnginePluginManager {
  private plugins = new Map<string, { plugin: EnginePlugin; api: unknown }>();
  private beforeHooks = new Map<string, Array<(ctx: MutationHookContext) => any>>();
  private afterHooks = new Map<string, Array<(event: EngineEvent) => any>>();
  private headlessCommands = new Map<string, EngineCommandDef>();

  constructor(
    private readonly doc: OutlinerDoc,
    private readonly server: RpcServer,
  ) {}

  use(plugin: EnginePlugin): this {
    const ctx = this.makeEngineContext(plugin.name);
    const installed = plugin.install(ctx);
    this.plugins.set(plugin.name, { plugin, api: plugin.getPublicApi?.() ?? null });
    // cleanup on dispose
    return this;
  }

  // Called by RpcServer before executing a write method
  async runBeforeHooks(type: string, blockId: BlockId): Promise<boolean> {
    const hooks = this.beforeHooks.get(type) ?? [];
    for (const hook of hooks) {
      let cancelled = false;
      const cancel = () => { cancelled = true; };
      await hook({ blockId, cancel });
      if (cancelled) return false; // mutation aborted
    }
    return true;
  }

  // Called by RpcServer after executing a write method
  async runAfterHooks(event: EngineEvent): Promise<void> {
    const hooks = this.afterHooks.get(event.type) ?? [];
    for (const hook of hooks) await hook(event);
  }

  getHeadlessCommand(name: string): EngineCommandDef | undefined {
    return this.headlessCommands.get(name);
  }

  private makeEngineContext(pluginName: string): EngineContext { /* ... */ }
}
```

---

### 4.7 `RpcServer` — Multi-client support

```typescript
// src/rpc/server.ts

export class RpcServer {
  private readonly handlers = new Map<string, RpcHandler>();
  private readonly clients = new Map<string, Transport>();  // clientId → Transport
  private clientCounter = 0;

  // Register a new connected client; returns clientId for tracking
  addClient(transport: Transport): string {
    const clientId = `client-${++this.clientCounter}`;
    this.clients.set(clientId, transport);
    transport.start(async (msg) => {
      const response = await this.dispatch(msg, clientId);
      if (response) transport.send(response);
    });
    return clientId;
  }

  removeClient(clientId: string): void {
    this.clients.get(clientId)?.stop();
    this.clients.delete(clientId);
  }

  // Broadcast to ALL connected clients
  notifyAll(method: string, params: unknown): void {
    const msg = { jsonrpc: "2.0", method, params };
    for (const transport of this.clients.values()) transport.send(msg);
  }

  // Unicast to ONE client
  notifyClient(clientId: string, method: string, params: unknown): void {
    this.clients.get(clientId)?.send({ jsonrpc: "2.0", method, params });
  }

  register(method: string, handler: RpcHandler): void { ... }
  getHandler(method: string): RpcHandler | undefined { ... }
  stop(): void { for (const t of this.clients.values()) t.stop(); }
}
```

---

### 4.8 New RPC methods for headless commands

```
engine.exec    { name: string; args?: unknown }  → { success: boolean }
engine.can     { name: string; args?: unknown }  → { result: boolean }
```

These route to `EnginePluginManager.getHeadlessCommand(name)`.

---

### 4.9 `OutlineClient` additions

```typescript
// src/client/outline-client.ts

// Call a headless-registered command (EnginePlugin commands)
async execCommand(name: string, args?: unknown): Promise<boolean>
async canCommand(name: string, args?: unknown): Promise<boolean>

// onChange callback now receives EngineEvent[] instead of BlockChange[]
onChange(listener: (events: EngineEvent[]) => void): () => void
```

---

## 5. File Changes

### Files to CREATE

```
src/engine/
  types.ts           — EngineEvent, EngineContext, EnginePlugin, MutationHookContext
  plugin-manager.ts  — EnginePluginManager class
src/view/
  context.ts         — ViewContext interface, PasteRule, ViewCommandDef, ViewStorePlugin (updated)
```

### Files to MODIFY

| File | Changes |
|---|---|
| `src/crdt/outliner-doc.ts` | `handleEvent` → emits `EngineEvent[]` instead of `BlockChange[]`; `onChange` callback type updates to `EngineEvent[]`; expose `getNext/getPrev`; integrate mutation hook callbacks |
| `src/crdt/block.ts` | No API changes; `toSnapshot()` already has deltas |
| `src/crdt/types.ts` | Add `EventOrigin` type; remove `BlockChange` (replaced by `EngineEvent`) or keep as a compatibility alias |
| `src/rpc/server.ts` | Multi-client: `constructor` no longer takes a single `Transport`; add `addClient`, `removeClient`, `notifyAll`, `notifyClient` |
| `src/rpc/methods.ts` | (1) Each write method calls `pluginManager.runBeforeHooks(type, blockId)` — returns `false` → throw `RpcError(REJECTED)`. (2) After each write, call `pluginManager.runAfterHooks(event)`. (3) Replace `server.notify("onChange", { changes })` with `server.notifyAll("onChange", { events: EngineEvent[] })`. (4) Register `engine.exec` and `engine.can`. (5) Methods that change text emit `text:changed` with full deltas (eliminating the need for client to re-fetch). (6) `requireWritable` guard stays. |
| `src/rpc/types.ts` | Add `EngineEvent` types to wire format; add `EngineExecParams`, `EngineCanParams`; update `OnChangeNotification` |
| `src/bin/serve.ts` | Create `EnginePluginManager`, pass to `registerMethods`; `addClient(new StdioTransport())` on the new multi-client `RpcServer` |
| `src/view/types.ts` | Remove `CommandContext`, `CommandDef`, `PluginContext`, `ViewStorePlugin` (moved to `context.ts`). Update `StoreEvent` to new discriminated union. Keep `BlockView`, `Selection`, `Cursor`, `TextSelection`, `BlockSelection`, `InputRule`. |
| `src/view/view-store.ts` | (1) `makeViewContext()` replaces `makePluginContext()` and `makeCommandContext()`. (2) `CommandDef.execute/can` receive `ViewContext` not `CommandContext`. (3) `createBlock/deleteBlock/moveBlock` added to ViewContext. (4) `getNext/getPrev/getAllBlockIds` added. (5) Plugin registry for `getPlugin()`. (6) `addPasteRule` support. (7) Plugin `storage` isolated per plugin. (8) Plugin `priority` ordering. (9) `applyRemoteChanges` rewritten to consume `EngineEvent[]`. (10) Fire granular `StoreEvent` variants (not just `remoteChange`). |
| `src/view/command.ts` | `CommandChain` takes `ViewContext` in constructor; remove `CommandContext` import |
| `src/view/selection.ts` | No changes |
| `src/client/outline-client.ts` | `onChange` callback type: `EngineEvent[]`. Add `execCommand`, `canCommand`. |
| `src/plugins/keymap.ts` | Handler type: `(ctx: ViewContext) => boolean` (was `CommandContext`) |
| `src/plugins/input-rules.ts` | `InputRule.handler` type: `(ctx: ViewContext, ...)` |
| `src/plugins/ai-completion.ts` | Subscribe to `"delta:input"` (was `"deltaInput"`). Handler type `ViewContext`. |
| `src/index.ts` | Export new `engine/*` modules; update `view/*` exports |

### Files to DELETE
None — all files remain, they are modified in-place.

### Internal renames

| Old | New |
|---|---|
| `StoreEvent["type"] = "deltaInput"` | `"delta:input"` |
| `StoreEvent["type"] = "blockCreated"` etc. | `"block:created"` etc. |
| `PluginContext` | `ViewContext` |
| `CommandContext` | `ViewContext` |
| `CommandDef` | `ViewCommandDef` |

---

## 6. `OutlinerDoc` mutation hook integration

The mutation hooks must fire synchronously before `doc.commit()`. The simplest approach:
wrap each mutation method with a hook runner.

```typescript
// src/crdt/outliner-doc.ts

// New type for hook callback storage
type BeforeHook = (blockId: BlockId) => Promise<boolean>;
type AfterHook  = (event: EngineEvent) => Promise<void>;

// In constructor:
private beforeHooks = new Map<string, BeforeHook[]>();
private afterHooks  = new Map<string, AfterHook[]>();

// Public hook registration (called by EnginePluginManager):
registerBeforeHook(type: string, fn: BeforeHook): () => void { ... }
registerAfterHook(type: string, fn: AfterHook):  () => void { ... }

// Example: createBlock with hooks
async createBlock(parentId?: BlockId, index?: number): Promise<Block> {
  // Run before hooks — any can cancel
  for (const hook of this.beforeHooks.get("create") ?? []) {
    const ok = await hook(/* pending blockId is unknown, pass parentId */ parentId ?? null);
    if (!ok) throw new Error("Mutation cancelled by plugin");
  }
  const node = this.tree.createNode(...);
  node.data.setContainer("content", new LoroText());
  this.doc.commit();
  // Now we know the real blockId
  const blockId = String(node.id);
  const event: EngineEvent = { type: "block:created", blockId, parentId: parentId ?? null, index: index ?? 0, isLocal: true, origin: "local" };
  for (const hook of this.afterHooks.get("block:created") ?? []) await hook(event);
  return new Block(node);
}
```

The `handleEvent` (Loro subscribe callback) continues to fire for **remote** changes (CRDT merge from peers). It now emits `EngineEvent` with `isLocal: false, origin: "peer:..."`.

---

## 7. `applyRemoteChanges` rewrite in ViewStore

The current method receives `BlockChange[]`. After redesign it receives `EngineEvent[]`:

```typescript
private async applyRemoteChanges(events: EngineEvent[]): Promise<void> {
  for (const event of events) {
    // Skip echoes from our own operations
    const opKey = `${event.type}:${(event as any).blockId}`;
    if (this.pendingOps.has(opKey)) {
      this.pendingOps.delete(opKey);
      this.fireEvent(this.engineEventToStoreEvent(event, true));
      continue;
    }

    switch (event.type) {
      case "block:created": { /* fetch snapshot, populate blocks map */ break; }
      case "block:deleted": { /* remove from blocks map */ break; }
      case "block:moved":   { /* update parentId and childIds */ break; }
      case "text:changed":  {
        // Event now carries the full deltas — no re-fetch needed
        const block = this.blocks.get(event.blockId);
        if (block && !this.deltaTimers.has(event.blockId)) {
          block.deltas = event.deltas;
          block.confirmedDeltas = event.deltas;
          block.isDirty = false;
          this.notifyBlockListeners(event.blockId);
        }
        break;
      }
      case "prop:changed": {
        const block = this.blocks.get(event.blockId);
        if (block) {
          block.props[event.key] = event.value;
          this.notifyBlockListeners(event.blockId);
        }
        break;
      }
      case "mark:changed": {
        // Re-fetch deltas to get updated marks (marks change the delta structure)
        const block = this.blocks.get(event.blockId);
        if (block && !this.deltaTimers.has(event.blockId)) {
          const deltas = await this.client.getDeltas(event.blockId);
          block.deltas = deltas; block.confirmedDeltas = deltas;
          this.notifyBlockListeners(event.blockId);
        }
        break;
      }
    }
    this.fireEvent(this.engineEventToStoreEvent(event, false));
  }
  this.notifyTreeListeners();
}
```

---

## 8. Plugin Registry for `getPlugin(name)`

```typescript
// src/view/plugin-registry.ts

export class ViewPluginRegistry {
  private readonly apis = new Map<string, unknown>();

  register(name: string, publicApi: unknown): void {
    this.apis.set(name, publicApi);
  }

  get<T = unknown>(name: string): T | undefined {
    return this.apis.get(name) as T | undefined;
  }
}
```

In `ViewStore.mount()`, after all plugins are installed, register their public APIs:

```typescript
for (const plugin of sortedPlugins) {
  const storage = plugin.defaultStorage?.() ?? {};
  const ctx = this.makeViewContext(plugin.name, storage);
  const installed = plugin.install(ctx);
  this.installedPlugins.push(installed);
  if (plugin.getPublicApi) {
    this.pluginRegistry.register(plugin.name, plugin.getPublicApi());
  }
}
```

---

## 9. `methods.ts` mutation hook integration

Every write RPC handler gets wrapped:

```typescript
// src/rpc/methods.ts

function registerMethods(server: RpcServer, doc: OutlinerDoc, store: FileStore, plugins: EnginePluginManager) {

  server.register("block.create", async (p) => {
    requireWritable(doc);
    const params = p as CreateBlockParams;

    // Pre-mutation hook — plugins can cancel
    const allowed = await plugins.runBeforeHooks("create", params.parentId ?? "");
    if (!allowed) throw new RpcError(RPC_ERRORS.REJECTED, "Blocked by plugin");

    const block = await doc.createBlock(params.parentId, params.index);

    // Build EngineEvent
    const event: EngineEvent = {
      type: "block:created",
      blockId: block.id,
      parentId: params.parentId ?? null,
      index: params.index ?? 0,
      isLocal: true,
      origin: "local",
    };

    // After hooks
    await plugins.runAfterHooks(event);

    // Broadcast to ALL clients
    server.notifyAll("onChange", { events: [event] });

    return { id: block.id };
  });

  // text.replaceDeltas — now broadcasts full deltas in event (no re-fetch needed)
  server.register("text.replaceDeltas", async (p) => {
    requireWritable(doc);
    const params = p as TextReplaceDeltasParams;
    const block = requireBlock(doc, params.id);
    const allowed = await plugins.runBeforeHooks("text", params.id);
    if (!allowed) throw new RpcError(RPC_ERRORS.REJECTED, "Blocked by plugin");
    block.replaceDeltas(params.deltas);
    doc.doc.commit();
    const event: EngineEvent = {
      type: "text:changed",
      blockId: params.id,
      deltas: params.deltas,   // ← full deltas in event
      isLocal: true,
      origin: "local",
    };
    await plugins.runAfterHooks(event);
    server.notifyAll("onChange", { events: [event] });
    return {};
  });

  // Headless command dispatch
  server.register("engine.exec", async (p) => {
    const { name, args } = p as { name: string; args?: unknown };
    const cmd = plugins.getHeadlessCommand(name);
    if (!cmd) throw new RpcError(RPC_ERRORS.METHOD_NOT_FOUND, `Unknown engine command: ${name}`);
    if (cmd.can && !cmd.can(plugins.makeEngineContext("rpc"), args)) return { success: false };
    await cmd.execute(plugins.makeEngineContext("rpc"), args);
    return { success: true };
  });

  server.register("engine.can", async (p) => {
    const { name, args } = p as { name: string; args?: unknown };
    const cmd = plugins.getHeadlessCommand(name);
    if (!cmd || !cmd.can) return { result: !!cmd };
    return { result: cmd.can(plugins.makeEngineContext("rpc"), args) };
  });
}
```

---

## 10. Example: Using the New System

### EnginePlugin: Schema Validator

```typescript
// Prevents certain block types from being children of others
const schemaValidatorPlugin: EnginePlugin = {
  name: "schema-validator",
  install(ctx) {
    ctx.onBefore("create", async ({ blockId: parentId, cancel }) => {
      // Example: heading cannot be a child of a code block
      if (parentId) {
        const parent = ctx.getBlock(parentId);
        if (parent?.getProp("type") === "code") cancel();
      }
    });
    return { dispose() {} };
  }
};
```

### EnginePlugin: Headless Command (callable from AI/CLI)

```typescript
const outlinerCommandsPlugin: EnginePlugin = {
  name: "outliner-commands",
  install(ctx) {
    ctx.registerCommand("indentBlock", {
      can(ctx, { blockId }) {
        return ctx.getPrev(blockId) !== null;
      },
      execute(ctx, { blockId }) {
        const prev = ctx.getPrev(blockId)!;
        ctx.moveBlock(blockId, prev.id, prev.children.length);
      }
    });

    ctx.registerCommand("unindentBlock", {
      can(ctx, { blockId }) {
        return ctx.getBlock(blockId)?.parentId !== null;
      },
      execute(ctx, { blockId }) {
        const block = ctx.getBlock(blockId)!;
        const parent = ctx.getBlock(block.parentId!)!;
        const grandparentId = parent.parentId ?? null;
        ctx.moveBlock(blockId, grandparentId, /* after parent */ undefined);
      }
    });

    return { dispose() {} };
  }
};
```

AI agent calling it:
```typescript
const client = new OutlineClient({ filePath: "notes.loro" });
await client.start();
await client.execCommand("indentBlock", { blockId: "0@123" });
```

### ViewPlugin: Command composing another command

```typescript
const formattingPlugin: ViewStorePlugin = {
  name: "formatting",
  install(ctx) {
    ctx.registerCommand("toggleBold", {
      can: (ctx) => ctx.getSelection()?.type === "text",
      execute: (ctx) => {
        const sel = ctx.getSelection() as TextSelection;
        if (ctx.isMarkActive("bold")) {
          // call engine command
          ctx.client.unmark(sel.anchor.blockId, { start: sel.anchor.offset, end: sel.focus.offset }, "bold");
        } else {
          ctx.client.mark(sel.anchor.blockId, { start: sel.anchor.offset, end: sel.focus.offset }, "bold", true);
        }
      }
    });

    ctx.registerCommand("boldAndItalic", {
      execute: (ctx) => {
        // Commands CAN call other commands now
        ctx.exec("toggleBold");
        ctx.exec("toggleItalic");
      }
    });

    return { dispose() {} };
  }
};
```

---

## 11. Implementation Order

Implement in this sequence. Each step produces a compiling, testable state.

1. **`src/engine/types.ts`** — `EngineEvent`, `EngineContext`, `EnginePlugin`, `MutationHookContext`, `EventOrigin`
2. **`src/crdt/types.ts`** — add `EventOrigin`; keep `BlockChange` as type alias for compatibility during migration
3. **`src/crdt/outliner-doc.ts`** — update `handleEvent` to emit `EngineEvent[]`; add `registerBeforeHook/registerAfterHook`; add `getNext/getPrev`; update `onChange` callback type
4. **`src/engine/plugin-manager.ts`** — `EnginePluginManager` with `use`, `runBeforeHooks`, `runAfterHooks`, `getHeadlessCommand`, `makeEngineContext`
5. **`src/rpc/server.ts`** — multi-client: `addClient`, `removeClient`, `notifyAll`, `notifyClient`
6. **`src/rpc/types.ts`** — add engine command types; update `OnChangeNotification` to carry `EngineEvent[]`
7. **`src/rpc/methods.ts`** — wrap all write handlers with before/after hooks; broadcast `EngineEvent[]`; register `engine.exec`, `engine.can`; text.replaceDeltas/mark/unmark carry full deltas in event
8. **`src/bin/serve.ts`** — create `EnginePluginManager`; pass to `registerMethods`; use `server.addClient(new StdioTransport())`
9. **`src/client/outline-client.ts`** — update `onChange` to `EngineEvent[]`; add `execCommand/canCommand`
10. **`src/view/context.ts`** — full `ViewContext` interface, `ViewCommandDef`, `PasteRule`, updated `ViewStorePlugin`
11. **`src/view/plugin-registry.ts`** — `ViewPluginRegistry`
12. **`src/view/command.ts`** — `CommandChain` uses `ViewContext`
13. **`src/view/types.ts`** — new `StoreEvent` discriminated union; remove `CommandContext`/`PluginContext`/`CommandDef`
14. **`src/view/view-store.ts`** — `makeViewContext` (unified); plugin registry; `addPasteRule`; `getNext/getPrev/getAllBlockIds`; `applyRemoteChanges` consumes `EngineEvent[]`; fire granular `StoreEvent` variants
15. **`src/plugins/keymap.ts`** — handler type: `(ctx: ViewContext) => boolean`
16. **`src/plugins/input-rules.ts`** — handler type: `(ctx: ViewContext, ...)`
17. **`src/plugins/ai-completion.ts`** — subscribe to `"delta:input"`; handler takes `ViewContext`
18. **`src/index.ts`** — add `engine/*` exports; update `view/*` exports
19. **Update all tests** — mock `EngineEvent[]` instead of `BlockChange[]`; update plugin test helpers to use `ViewContext`
20. **`npm test`** — target: 0 failures

---

## 12. Test Strategy

### Unit tests — new files

**`tests/engine/plugin-manager.test.ts`**
- `onBefore` hook cancels mutation (returns false)
- `onAfter` hook fires with correct `EngineEvent`
- `registerCommand` + `engine.exec` / `engine.can` via `getHeadlessCommand`
- `getPlugin` returns another plugin's public API
- Plugin `dispose` is called on `pluginManager.dispose()`

**`tests/rpc/multi-client.test.ts`**
- `addClient` → two PassThrough transports both receive `notifyAll`
- `removeClient` → removed client no longer receives notifications
- `notifyClient` sends to only one client

**`tests/view/context.test.ts`**
- `createBlock` inside a command goes through ViewStore optimistic path (pendingOps set)
- `exec` inside command `execute` calls another command
- `getNext / getPrev` returns correct adjacent block
- `getPlugin` returns plugin public API
- `addPasteRule` fires handler on paste match

### Updated existing tests

- `tests/crdt/outliner-doc.test.ts` — `onChange` callback receives `EngineEvent[]`; test `getNext/getPrev`
- `tests/rpc/methods.test.ts` — `onChange` notification carries `EngineEvent[]`; test `engine.exec/can`; test before-hook cancellation
- `tests/view/view-store.test.ts` — mock `OutlineClient.onChange` sends `EngineEvent[]`; `StoreEvent` variants match new type names; test `createBlock` from within command ctx
- `tests/plugins/*.test.ts` — update handler types to `ViewContext`

---

## 13. Comparison: Before vs After

| Dimension | Before | After |
|---|---|---|
| Plugin layers | 1 (ViewStore only) | 2 (Engine + View) |
| Pre-mutation hooks | ❌ | ✅ `onBefore` with cancel |
| Post-mutation hooks | ❌ | ✅ `onAfter` with EngineEvent |
| AI/CLI commands | ❌ raw RPC only | ✅ `execCommand(name, args)` |
| Multi-client broadcast | ❌ single Transport | ✅ `notifyAll` to N clients |
| Event granularity | 1 coarse type | 9 specific types with isLocal/origin |
| text:changed re-fetch | ✅ required | ❌ eliminated (deltas in event) |
| Command composability | ❌ no exec in ctx | ✅ `ctx.exec/can/chain` |
| Tree mutations in ctx | ❌ (raw client) | ✅ (optimistic path) |
| Inter-plugin comms | ❌ | ✅ `getPlugin(name)` |
| Plugin storage | per-block ext only | ✅ plugin-wide storage + per-block ext |
| Paste rules | ❌ | ✅ `addPasteRule` |
| Plugin priority | ❌ | ✅ `priority` field |
| Unified context type | ❌ 2 types | ✅ `ViewContext` everywhere |
