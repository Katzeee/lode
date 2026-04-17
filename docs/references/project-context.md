# Block Engine — Project Context

This document captures the key architectural decisions, design principles, and hard-won insights
from the design process. Read it fully before starting implementation.

A complete file-by-file implementation spec is in `implementation-plan.md`.
Key files in the reference codebases are mapped in `codebase-reference.md`.

---

## What We Are Building and Why

**block-engine** is a headless CRDT document engine for Tana/Notion-style outliner applications.
It has two independently usable parts:

### Part 1 — Headless Process

A Node.js server that runs as a **separate OS process**. Exposes JSON-RPC 2.0 over stdio.

Why a separate process instead of an in-process library (like tiptap or BlockSuite)?
- AI agents connect to it as a first-class client using the same JSON-RPC protocol as the UI
- CLI tools work the same way — no UI layer required
- The engine can be implemented in Rust later without changing the client API
- Multiple UI windows can connect to one engine simultaneously

### Part 2 — ViewStore

A client-side TypeScript library. Spawns the headless process, communicates via IPC, maintains optimistic local UI state, provides selection model / command system / plugin API.

---

## Architecture Diagram

```
UI (React / Solid / Vue / any framework)
  │
  │ reads BlockView, calls store methods
  ▼
ViewStore                           ← D:\codes\blockengine\src\view\view-store.ts
  │ optimistic local state          ← blocks: Map<BlockId, BlockView>
  │ selection model                 ← selection: Selection (never sent to headless)
  │ command system                  ← commands: Map<string, CommandDef>
  │ plugin host                     ← plugins: ViewStorePlugin[]
  │
  │ JSON-RPC 2.0 over stdio (IPC)
  ▼
OutlineClient                       ← D:\codes\blockengine\src\client\outline-client.ts
  │ spawns child process
  │ pending call queue: Map<id, {resolve, reject}>
  │ onChange notifications → ViewStore
  ▼
Headless Process (src/bin/serve.ts)
  │
  ▼
OutlinerDoc                         ← D:\codes\blockengine\src\crdt\outliner-doc.ts
  │ LoroDoc + LoroTree("blocks") + UndoManager
  │ all mutations call doc.commit() to trigger events
  ▼
FileStore                           ← D:\codes\blockengine\src\persistence\file-store.ts
  └── atomic write (tmp → rename) of Loro binary snapshots
```

---

## CRDT Engine: Loro vs Yjs

We use `loro-crdt` (npm), not Yjs. Key differences:

| | Yjs (used by tiptap/BlockSuite) | Loro (used by us) |
|---|---|---|
| Tree structure | None — must simulate with flat `Y.Map` + `sys:children: Y.Array` | **`LoroTree` native** — conflict-free `move()` built in |
| Tree move | delete + insert (concurrent moves → node appears in two places) | `tree.move()` is a single CRDT operation, always conflict-free |
| Text marks | `Y.Text` with attributes | `LoroText.mark()` / `unmark()` — same concept |
| Event origin | `transaction.origin === clientID` | `event.by === "local"` |
| Delta format | `Y.Text.toDelta()` | `LoroText.toDelta()` (same Quill-style output) |

**`LoroTree` eliminates the biggest complexity in BlockSuite's design** — the manual `sys:children` management and the broken Move semantics.

---

## Loro CRDT — Critical API Constraints

Non-obvious behaviors that will cause bugs if ignored:

### 1. `configTextStyle` must be called before `doc.import()`

```typescript
// OutlinerDoc constructor — ORDER MATTERS:
this.doc = new LoroDoc();
this.doc.configTextStyle({          // ← first
  bold:          { expand: "after" },
  italic:        { expand: "after" },
  underline:     { expand: "after" },
  strikethrough: { expand: "after" },
  code:          { expand: "none" },
  link:          { expand: "none" },
});
if (bytes) this.doc.import(bytes);  // ← second
```

Reversing the order causes marks from saved documents to not deserialize correctly.

### 2. `LoroText.toDelta()` returns a union type — always filter

Loro's delta items can be `{ insert, attributes? }`, `{ delete: number }`, or `{ retain: number }`.
We only want insert spans:

```typescript
const deltas = text.toDelta()
  .filter((d): d is { insert: string; attributes?: Record<string, unknown> } =>
    typeof d.insert === "string"
  );
```

### 3. `node.parent()` returns a `LoroTreeNode`, not a TreeID string

```typescript
// WRONG:
const parentId = String(node.parent());  // → "[object Object]"

// CORRECT:
const parentId = node.parent() != null ? String(node.parent()!.id) : null;
```

### 4. `tree.delete()` is a soft-delete

The node still exists in the CRDT after deletion — it is just marked as deleted.
Always check in `getBlock()`:

```typescript
const node = this.tree.getNodeByID(id);
if (!node || node.isDeleted()) return null;  // ← required
```

### 5. `mergeInterval: 0` means "always merge everything" in Loro

Counter-intuitive: `mergeInterval: 0` causes Loro to merge ALL operations into one undo group,
not zero merging. Use `mergeInterval: 500` for production. For explicit multi-op undo groups,
use `undoManager.groupStart()` / `groupEnd()` inside `transact()`.

### 6. Text change events are NOT fired by `doc.subscribe()`

`doc.subscribe()` only fires for tree structure changes (create/delete/move of nodes).
After `text.mark`, `text.unmark`, `text.replaceDeltas` RPC handlers complete, emit the
`onChange` notification directly:

```typescript
server.notify("onChange", { changes: [{ action: "update", blockId: id }] });
```

### 7. `doc.commit()` must be called after every mutation

Without `commit()`, mutations don't trigger `subscribe` callbacks and events are not delivered.

---

## Core Data Model

### Loro layout per block

```
LoroDoc
  └── LoroTree("blocks")
        └── TreeNode  id = TreeID string ("counter@peerID")
              └── node.data: LoroMap
                    ├── "content": LoroText   ← rich text content
                    └── [key]:     primitive   ← user props (string/number/boolean/null only)
```

### Rich text exchange format — Delta

All rich text crosses the IPC boundary as **Quill-style delta** (insert-only spans).
This is the output of `LoroText.toDelta()` after filtering.

```typescript
interface DeltaInsert {
  insert: string;
  attributes?: Record<string, unknown>;  // { bold: true, link: "https://..." }
}
type Delta = DeltaInsert[];
```

### BlockSnapshot (wire format between headless and client)

```typescript
interface BlockSnapshot {
  id: BlockId;           // e.g. "0@12345"
  deltas: Delta;         // rich text
  parentId: BlockId | null;
  children: BlockId[];   // ordered child IDs
  props: Record<string, unknown>;
}
```

### BlockView (ViewStore local state, never sent to headless)

```typescript
interface BlockView {
  readonly id: BlockId;
  deltas: Delta;              // what UI shows (optimistic, may be ahead of headless)
  confirmedDeltas: Delta;     // last confirmed by headless
  isDirty: boolean;           // deltas !== confirmedDeltas structurally
  parentId: BlockId | null;
  childIds: BlockId[];
  props: Record<string, unknown>;
  ext: Record<string, unknown>;  // plugin-private, NEVER synced to headless
}
```

---

## Design Principles (Non-Negotiable)

### 1. Block types are transparent to the engine

The engine has **no concept of "heading", "todo", "code block"**, etc.
There is no flavour system. Block type is a user convention stored in `props.type`.
The engine stores and retrieves arbitrary props — it never reads `type` for any purpose.

This differs from BlockSuite (which bakes `affine:heading`, `affine:paragraph`, etc. into the store)
and is a deliberate choice to keep the engine truly general-purpose.

```typescript
// Application code — engine doesn't care about "type":
await client.setProp(blockId, "type", "heading")
await client.setProp(blockId, "level", 2)

// UI renders based on the type it set itself:
switch (block.props.type) {
  case "heading": return <h2>{deltaToText(block.deltas)}</h2>
  case "todo":    return <TodoBlock block={block} />
  default:        return <p>{deltaToText(block.deltas)}</p>
}
```

### 2. Block split/merge belongs to the application, not the engine

"What happens when the user presses Enter" is **application-defined semantics**:
- Notion: Enter creates a new sibling block at the same level
- Tana: Enter creates a new child block (default to indent)
- Long-form notes: Enter inserts `\n` in the text (no new block)
- Code block: Enter inserts `\n` in the code text

The engine provides atomic primitives (`createBlock`, `deleteBlock`, `insertText`, `deleteText`).
The application or a keymap plugin composes them into "split on Enter". The engine never implements `splitBlock`.

### 3. Ghost text (AI completion) never enters the doc until accepted

Ghost text lives in `block.ext["ghostText"]` — a `string | null` value that is:
- Plugin-private (set by the AI completion plugin via `ctx.setExt`)
- Never sent to the headless process
- Never included in snapshots
- Only written to the doc when `store.acceptGhostText(blockId)` is called,
  which appends it as a plain `DeltaInsert` via `onDeltaInput()` → debounce → `client.replaceDeltas()`

### 4. Selection lives only in ViewStore

`TextSelection` (blockId + char offset) and `BlockSelection` (array of blockIds) are
maintained entirely in `ViewStore`. They are never serialized or sent to the headless process.
This allows the selection model to be responsive (zero IPC latency) without any protocol design.

### 5. The engine is the CRDT peer, not a server

Think of the headless process as a CRDT peer that also handles persistence and IPC routing.
The ViewStore is another peer (but without full CRDT state — it maintains only a view cache).
Future: multiple headless instances can sync with each other via Loro's binary update format
(`doc.export({ mode: "update", from: versionVector })` / `doc.import(bytes)`).

---

## ViewStore ↔ Headless: The Binding Pattern

This is the distributed equivalent of BlockSuite's `SyncController`.

### Loop prevention

Risk: ViewStore writes → headless fires `onChange` → ViewStore re-applies (double-apply).

Prevention: **`pendingOps: Set<string>`**

```
store.createBlock()
  1. await client.createBlock() → realId
  2. Add BlockView to blocks map (with realId)
  3. pendingOps.add("create:${realId}")

headless fires onChange [{ action:"create", blockId: realId }]
  applyRemoteChanges():
    pendingOps.has("create:${realId}") → true → delete from set, skip ✓

Remote peer creates block "5@yyy"
  applyRemoteChanges():
    pendingOps.has("create:5@yyy") → false → apply to local state ✓
```

### Two-track text

Text edits use a local buffer to achieve zero-latency UI updates:

```
User types "hello"
  onDeltaInput(id, [{insert:"hello"}])
    block.deltas = [{insert:"hello"}]   ← immediate
    block.isDirty = true
    → debounce timer starts (300ms)
    → fires "deltaInput" plugin hook (AI completion trigger)
    → checks input rules

300ms later (user stopped typing)
  client.replaceDeltas(id, [{insert:"hello"}])   ← sent to headless
  block.confirmedDeltas = [{insert:"hello"}]
  block.isDirty = false
```

Remote text update during editing:
```
deltaTimers.has(blockId) === true → skip re-fetch (local is authoritative)
deltaTimers.has(blockId) === false → re-fetch from headless and update
```

### The stash/pop equivalence

BlockSuite's `stash()` temporarily disconnects a prop from CRDT sync (for drag preview).
Our equivalent: text edits are always "stashed" (local-only) until the debounce timer fires.
For tree operations (create/move/delete), we don't stash — IPC is fast enough (~1ms local).

---

## Interface Categories

The 7 interface categories that a production document engine must provide,
derived from analysis of tiptap and BlockSuite:

| # | Category | Owner | Key API |
|---|---|---|---|
| 1 | State / CRUD | Headless + ViewStore | `createBlock`, `deleteBlock`, `moveBlock`, `setProp` |
| 2 | Rich Text / Delta | Headless + ViewStore | `mark`, `unmark`, `getDeltas`, `replaceDeltas`, `onDeltaInput` |
| 3 | Query | Headless + ViewStore | `getBlock`, `getBlocksByProp`, `getRootIds`, `getDescendants` |
| 4 | Selection Model | ViewStore only | `getSelection`, `setSelection`, `isMarkActive`, `getMarkValue` |
| 5 | Command System | ViewStore | `registerCommand`, `exec`, `can`, `chain()` |
| 6 | Extension / Plugin | ViewStore | `PluginContext` with `bindKey`, `addInputRule`, `registerCommand` |
| 7 | Lifecycle & Transport | Both | `mount`, `unmount`, `readonly`, `Transport` interface |

**Comparison with reference libraries:**

tiptap covers all 7 but its document model is linear (not a block tree).
We borrow its Extension hook system, CommandManager (`chain`/`can`), and mark query patterns.

BlockSuite covers all 7 with a block tree model. We borrow its SyncController binding pattern,
block storage layout, and selection model design.
We diverge on: CRDT engine (Loro vs Yjs), block types (transparent vs flavour system),
process architecture (separate process vs in-process library).

---

## RPC Protocol Summary

JSON-RPC 2.0 over stdio. Stdout = JSON-RPC only. Stderr = diagnostics.

**Readonly guard**: `block.create`, `block.delete`, `block.move`, all `text.*` mutations,
`props.set` must throw `RpcError(READONLY)` when `doc.readonly === true`.

**Text change notifications**: Loro's `doc.subscribe()` only fires for tree structure events.
After `text.mark`, `text.unmark`, `text.replaceDeltas` handlers succeed, manually emit:
```typescript
server.notify("onChange", { changes: [{ action: "update", blockId: id }] });
```

Complete method table is in `implementation-plan.md` § RPC Methods.

---

## What We Explicitly Do NOT Build

These are application-layer concerns. The engine provides primitives; applications compose them:

| Concern | Why not in engine | How application handles it |
|---|---|---|
| Block split / merge | Semantics differ per product | App keymap plugin composes `createBlock` + `deleteText` |
| Markdown export | App knows its block type conventions | App traverses `BlockView[]`, emits MD per `props.type` |
| HTML export | Same | Same |
| Slash commands | Pure UI concern | App listens to `"/"` input, shows palette, calls engine commands |
| Toolbar rendering | Pure UI | UI reads `store.isMarkActive("bold")` → highlight button |
| Block type schema validation | Transparent by design | App validates itself before calling engine |
| Collaborative awareness / presence | Not yet | Loro supports it; wire up later via `LoroDoc` Awareness |

---

## Key Differences from tiptap / BlockSuite

### Why we are NOT tiptap

tiptap is an excellent rich-text editor but its document model is fundamentally linear
(ProseMirror's flat node tree). It cannot natively represent a deeply-nested block tree
where every node is independently addressable by a stable ID. We need `LoroTree`-style
parent-child relationships, independent block IDs, and tree-level Move semantics.

### Why we are NOT BlockSuite

BlockSuite is architecturally the closest reference. The key divergences:

1. **CRDT**: Loro's `LoroTree` gives us native tree semantics. BlockSuite's Yjs-based
   `flat map + sys:children` approach requires manual Move = delete+insert, which is
   not conflict-free under concurrent edits.

2. **Process model**: BlockSuite is an in-process library. We run as a separate process,
   making AI agents and CLI tools first-class citizens of the architecture.

3. **Block types**: BlockSuite bakes `affine:heading`, `affine:paragraph`, etc. into the
   store layer with schema validation. We keep the engine type-agnostic. Applications
   define types in `props.type` and handle rendering themselves.

4. **ViewStore vs SyncController**: BlockSuite's `SyncController` uses a JS `Proxy` to
   create a transparent bidirectional binding between a `Y.Map` and a JS object — this
   works because both live in the same process. We can't use Proxy across process boundaries,
   so `ViewStore` makes the binding explicit: `onDeltaInput()` (UI → headless) and
   `applyRemoteChanges()` (headless → UI), with `pendingOps` for loop prevention.
