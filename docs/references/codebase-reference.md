# Reference Codebase Quick Map

Two open-source frameworks are used as **design references only** — do not copy their code.
Read their source when you need to understand a pattern more deeply before implementing your own version.

---

## Tiptap — `D:\codes\tiptap`

A headless rich-text editor built on ProseMirror.
Its document model is **linear** (one flat ProseMirror document), not a block tree.
Primary reference for: **Extension API design, Command system, Input/Paste rules, mark queries**.

| File | Purpose |
|---|---|
| `packages/core/src/Editor.ts` | Main `Editor` class — lifecycle, state, view, event emitter, `getJSON()` / `getHTML()` / `isActive()` / `getAttributes()` |
| `packages/core/src/Extension.ts` | `Extension` base class — defines all plugin hooks: `addCommands`, `addKeyboardShortcuts`, `addInputRules`, `addPasteRules`, `addProseMirrorPlugins`, lifecycle callbacks (`onCreate`, `onUpdate`, `onDestroy`, etc.) |
| `packages/core/src/Node.ts` | `Node` extension — defines node schema spec: `content`, `marks`, `attrs`, `parseHTML`, `renderHTML`, `addNodeView` |
| `packages/core/src/Mark.ts` | `Mark` extension — defines inline mark schema: `inclusive`, `excludes`, `spanning`, `parseHTML`, `renderHTML` |
| `packages/core/src/CommandManager.ts` | Command system — implements `editor.commands.*` (direct execute), `editor.chain()` (batch, shared transaction), `editor.can()` (dry-run, no dispatch) |
| `packages/core/src/ExtensionManager.ts` | Extension registry — resolves, orders, and coordinates all extensions; builds final ProseMirror schema |
| `packages/core/src/helpers/getSchemaByResolvedExtensions.ts` | Compiles all Node/Mark extension definitions into a ProseMirror `Schema` object |
| `packages/core/src/InputRule.ts` | `InputRule` base — fires a handler when typed text matches a regex pattern (e.g. `# ` → heading) |
| `packages/core/src/PasteRule.ts` | `PasteRule` base — fires a handler when pasted text matches a pattern |
| `packages/extension-collaboration/src/collaboration.ts` | Collaboration extension entry — attaches `ySyncPlugin` + `yUndoPlugin` to a `Y.Doc` |
| `packages/extension-collaboration-caret/src/collaboration-caret.ts` | Remote cursor extension — renders other users' cursors via Yjs Awareness |
| `packages/starter-kit/src/starter-kit.ts` | `StarterKit` — bundles the most common extensions for quick setup |
| `@tiptap/y-tiptap` *(external npm package, not in this repo)* | **`ySyncPlugin`** — the bidirectional binding between ProseMirror state and `Y.XmlFragment`; the canonical CRDT ↔ editor binding reference |

### Key patterns to study in tiptap

- **Extension hook system** (`Extension.ts` + `ExtensionManager.ts`): how `addCommands`, `addKeyboardShortcuts`, `addInputRules` are defined per-extension and then merged by the manager. This is the template for our plugin `PluginContext` API.
- **Command chain** (`CommandManager.ts`): how `chain()` accumulates commands and dispatches a single transaction; how `can()` runs a dry-run with `shouldDispatch = false`. Template for our `CommandChain` class.
- **`isActive()` / `getAttributes()`** (`Editor.ts`): how the editor queries active marks/nodes at the current selection. Template for our `isMarkActive()` / `getMarkValue()`.
- **ySyncPlugin**: bidirectional CRDT ↔ editor sync — loop prevention via `isChangeOrigin`, mapping table between Yjs nodes and PM nodes, relative position conversion.

---

## BlockSuite — `D:\codes\blocksuite`

A block-tree editor framework built on Yjs.
Its document model is **hierarchical** (block tree), making it architecturally closer to what we're building.
Primary reference for: **CRDT ↔ model binding (SyncController), block tree storage, selection model, command system**.

| File | Purpose |
|---|---|
| `packages/framework/store/src/model/store/store.ts` | `Store` — main API surface: `addBlock`, `deleteBlock`, `moveBlocks`, `undo`/`redo`, `transact`, event `slots` |
| `packages/framework/store/src/model/store/crud.ts` | `DocCRUD` — low-level block tree CRUD directly on `Y.Map`; `getParent` (recursive DFS), `moveBlocks` (delete+insert) |
| `packages/framework/store/src/model/block/block-model.ts` | `BlockModel` — reactive block object; Preact Signals for `children`, `childMap`; RxJS Subjects for `propsUpdated`, `created`, `deleted` |
| `packages/framework/store/src/model/block/sync-controller.ts` | **`SyncController`** ← **most important file to study**: JS `Proxy` intercepts `model.props.x = v` → `yBlock.set('prop:x', native2Y(v))`; `yBlock.observe()` → updates Signal; `_byPassProxy` flag prevents infinite loops; `stash`/`pop` for draft mode |
| `packages/framework/store/src/model/block/flat-sync-controller.ts` | `FlatSyncController` — optimized SyncController that stores nested props as dotted-path keys (e.g. `prop:meta.createdAt`) instead of nested `Y.Map` |
| `packages/framework/store/src/reactive/native-y.ts` | `native2Y` / `y2Native` — bidirectional conversion between native JS values and Yjs types (`Y.Map`, `Y.Array`, `Y.Text`) |
| `packages/framework/store/src/schema/schema.ts` | `Schema` class — block flavour registry; validates parent-child relationship constraints |
| `packages/framework/store/src/model/block/zod.ts` | `defineBlockSchema` — Zod-based declarative block schema definition helper |
| `packages/framework/store/src/extension/selection/selection-extension.ts` | Selection extension — manages `TextSelection` / `BlockSelection`; syncs remote selections via Awareness |
| `packages/framework/std/src/command/manager.ts` | `CommandManager` — context-passing chain: `chain().pipe(cmd, input).run()` → `[success, ctx]` |
| `packages/framework/std/src/event/dispatcher.ts` | `UIEventDispatcher` — routes all UI events (mouse, keyboard, drag, clipboard, touch); `bindHotkey` for keyboard shortcuts |
| `packages/framework/store/src/adapter/base.ts` | `BaseAdapter` — base class for content transformers (snapshot ↔ external formats) |
| `packages/affine/shared/src/adapters/markdown/block-adapter.ts` | Markdown adapter — converts block tree ↔ Markdown via remark/rehype pipeline |
| `packages/framework/store/src/extension/workspace/workspace.ts` | `Workspace` — top-level multi-document container (equivalent of `DocCollection`) |

### Key patterns to study in BlockSuite

- **`SyncController`** (`sync-controller.ts`): The single most important reference. Study `_byPassProxy` (loop prevention), `_mutex` (prevent signal re-entry), `_stashed`/`pop` (draft mode for drag preview / IME), the `observe` handler structure. Our `ViewStore` is the distributed-process equivalent of this class.
- **`native2Y` / `y2Native`** (`native-y.ts`): The type conversion layer. Our Delta format conversion (LoroText ↔ `DeltaInsert[]`) serves the same role.
- **Block storage layout** (`crud.ts`): BlockSuite stores all blocks flat in a `Y.Map<string, YBlock>` with `sys:children: Y.Array<string>` for tree ordering. This is because Yjs has no native tree type. **We use Loro's `LoroTree` instead** — this eliminates the need for `sys:children` entirely and gives us a conflict-free native `move()` operation.
- **Command chain** (`std/src/command/manager.ts`): Context flows through a pipeline of commands via `(ctx, next)` — calling `next()` signals success and passes data downstream. Template for our `CommandChain`.
- **Selection extension** (`selection-extension.ts`): How `TextSelection` and `BlockSelection` are managed as separate types, and how remote selections are synchronized via Awareness. Template for our `ViewStore` selection API.
