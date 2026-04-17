import { registerBuiltins } from "./commands/index.js";
import { BlockDoc } from "./crdt/doc.js";
import {
  applyAttributes,
  deltaToText,
  deltasEqual,
  getDeltaLength,
  mergeDelta,
  sliceDelta,
  splitDeltaAt,
  toggleAttribute,
} from "./delta/utils.js";
import type { CommandDef, EngineContext, InstalledPlugin, Plugin } from "./plugins/index.js";
import { fromJSON as _fromJSON, toJSON as _toJSON } from "./serializers/json.js";
import { fromMarkdown as _fromMarkdown, toMarkdown as _toMarkdown } from "./serializers/markdown.js";
import { builtinSpecs, type BlockSpec } from "./specs/index.js";
import type {
  BlockId,
  BlockView,
  Delta,
  DocSnapshot,
  EngineEvent,
  EngineEventType,
  EventOrigin,
  MarkRange,
  SearchResult,
  Selection,
  TextSelection,
} from "./types.js";

const COLLAPSED_PROP = "_collapsed";

export interface BlockEngineOptions {
  initialBytes?: Uint8Array;
  readonly?: boolean;
  historyMergeInterval?: number;
}

export class BlockEngine {
  private doc: BlockDoc;
  private views = new Map<BlockId, BlockView>();
  private extMap = new Map<BlockId, Record<string, unknown>>();
  private allIdsCache: BlockId[] | null = null;
  private rootIdsCache: BlockId[] | null = null;
  private selection: Selection = null;

  private plugins: Plugin[] = [];
  private installed: { plugin: Plugin; installed: InstalledPlugin }[] = [];
  private pluginApis = new Map<string, unknown>();
  private commands = new Map<string, CommandDef>();
  private specs = new Map<string, BlockSpec>();

  private blockListeners = new Map<BlockId, Set<() => void>>();
  private treeListeners = new Set<() => void>();
  private selectionListeners = new Set<() => void>();
  private eventListeners = new Map<string, Set<(e: EngineEvent) => void>>();

  private batchDepth = 0;
  private pendingBlockNotifies = new Set<BlockId>();
  private pendingTreeNotify = false;
  private pendingSelectionNotify = false;
  private pendingEvents: EngineEvent[] = [];

  private currentOrigin: EventOrigin = "user";
  private mounted = false;

  constructor(options: BlockEngineOptions = {}) {
    this.doc = new BlockDoc(options.initialBytes, {
      historyMergeInterval: options.historyMergeInterval,
    });
    if (options.readonly) this.doc.setReadonly(true);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  use(plugin: Plugin): this {
    if (this.mounted) throw new Error("Cannot add plugins after mount()");
    this.plugins.push(plugin);
    return this;
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    // Register built-in specs
    for (const spec of builtinSpecs) this.registerSpec(spec);
    // Register built-in commands
    registerBuiltins(this);
    this.rebuildAll();
    const sorted = [...this.plugins].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
    );
    for (const plugin of sorted) {
      const storage = plugin.defaultStorage?.() ?? {};
      const ctx = this.makeContext(storage);
      const installed = plugin.install(ctx);
      this.installed.push({ plugin, installed });
      if (plugin.getPublicApi) this.pluginApis.set(plugin.name, plugin.getPublicApi());
    }
  }

  unmount(): void {
    for (const { installed } of this.installed) installed.dispose();
    this.installed = [];
    this.pluginApis.clear();
    this.blockListeners.clear();
    this.treeListeners.clear();
    this.selectionListeners.clear();
    this.eventListeners.clear();
    this.doc.dispose();
    this.mounted = false;
  }

  // ── Readonly ──────────────────────────────────────────────────────────────

  get readonly(): boolean {
    return this.doc.readonly;
  }

  set readonly(val: boolean) {
    const prev = this.doc.readonly;
    this.doc.setReadonly(val);
    if (prev !== val) this.emit({ type: "readonly:changed", readonly: val });
  }

  // ── Block CRUD ────────────────────────────────────────────────────────────

  createBlock(parentId?: BlockId, index?: number): BlockId {
    const id = this.doc.createBlock(parentId, index);
    this.invalidate([id]);
    if (parentId != null) this.invalidate([parentId]);
    this.allIdsCache = null;
    this.rootIdsCache = null;
    this.notifyTree();
    this.emit({
      type: "block:created",
      blockId: id,
      parentId: parentId ?? null,
      index: this.views.get(id)?.index ?? 0,
      origin: this.currentOrigin,
    });
    return id;
  }

  deleteBlock(id: BlockId): void {
    const parentId = this.doc.getParentId(id);
    // Collect descendants so we can remove extMap entries
    const descendants = this.collectDescendants(id);
    this.doc.deleteBlock(id);
    for (const d of descendants) {
      this.views.delete(d);
      this.extMap.delete(d);
      this.blockListeners.delete(d);
    }
    this.views.delete(id);
    this.extMap.delete(id);
    this.blockListeners.delete(id);
    if (parentId != null) this.invalidate([parentId]);
    this.allIdsCache = null;
    this.rootIdsCache = null;
    this.notifyTree();
    this.emit({ type: "block:deleted", blockId: id, origin: this.currentOrigin });
  }

  moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): void {
    const oldParentId = this.doc.getParentId(id);
    this.doc.moveBlock(id, newParentId, index);
    this.invalidate([id]);
    if (oldParentId != null) this.invalidate([oldParentId]);
    if (newParentId != null) this.invalidate([newParentId]);
    // Depth/isVisible of all descendants may change
    for (const d of this.collectDescendants(id)) this.invalidate([d]);
    this.allIdsCache = null;
    this.rootIdsCache = null;
    this.notifyTree();
    this.emit({
      type: "block:moved",
      blockId: id,
      newParentId,
      newIndex: this.views.get(id)?.index ?? 0,
      origin: this.currentOrigin,
    });
  }

  // ── Outliner-specific ─────────────────────────────────────────────────────

  indent(id: BlockId): void {
    const parentId = this.doc.getParentId(id);
    const siblings = parentId != null ? this.doc.getChildIds(parentId) : this.doc.getRootIds();
    const idx = siblings.indexOf(id);
    if (idx <= 0) return;
    const newParent = siblings[idx - 1];
    const newIndex = this.doc.getChildIds(newParent).length;
    this.moveBlock(id, newParent, newIndex);
  }

  outdent(id: BlockId): void {
    const parentId = this.doc.getParentId(id);
    if (parentId == null) return;
    const grandparentId = this.doc.getParentId(parentId);
    const parentSiblings = grandparentId != null
      ? this.doc.getChildIds(grandparentId)
      : this.doc.getRootIds();
    const parentIdx = parentSiblings.indexOf(parentId);
    this.moveBlock(id, grandparentId, parentIdx + 1);
  }

  moveUp(id: BlockId): void {
    const parentId = this.doc.getParentId(id);
    const siblings = parentId != null ? this.doc.getChildIds(parentId) : this.doc.getRootIds();
    const idx = siblings.indexOf(id);
    if (idx <= 0) return;
    this.moveBlock(id, parentId, idx - 1);
  }

  moveDown(id: BlockId): void {
    const parentId = this.doc.getParentId(id);
    const siblings = parentId != null ? this.doc.getChildIds(parentId) : this.doc.getRootIds();
    const idx = siblings.indexOf(id);
    if (idx < 0 || idx >= siblings.length - 1) return;
    this.moveBlock(id, parentId, idx + 1);
  }

  // ── Split / Merge ─────────────────────────────────────────────────────────

  splitBlock(id: BlockId, offset: number): BlockId {
    let newId = "";
    this.batch(() => {
      const view = this.getBlock(id);
      if (!view) throw new Error(`Block not found: ${id}`);
      const [before, after] = splitDeltaAt(view.deltas, offset);
      const hasChildren = view.childIds.length > 0;
      const len = getDeltaLength(view.deltas);
      const placeAsFirstChild = hasChildren && offset >= len;
      if (placeAsFirstChild) {
        newId = this.doc.createBlock(id, 0);
        this.invalidate([newId, id]);
      } else {
        const parentId = view.parentId;
        const siblings = parentId != null ? this.doc.getChildIds(parentId) : this.doc.getRootIds();
        const idx = siblings.indexOf(id);
        newId = this.doc.createBlock(parentId ?? undefined, idx + 1);
        this.invalidate([newId]);
        if (parentId != null) this.invalidate([parentId]);
      }
      this.allIdsCache = null;
      this.rootIdsCache = null;
      if (!deltasEqual(before, view.deltas)) {
        this.doc.replaceDeltas(id, before);
        this.invalidate([id]);
        this.emit({ type: "text:changed", blockId: id, deltas: before, origin: this.currentOrigin });
      }
      if (after.length > 0) {
        this.doc.replaceDeltas(newId, after);
        this.invalidate([newId]);
        this.emit({ type: "text:changed", blockId: newId, deltas: after, origin: this.currentOrigin });
      }
      this.notifyTree();
      this.emit({
        type: "block:created",
        blockId: newId,
        parentId: placeAsFirstChild ? id : view.parentId,
        index: this.views.get(newId)?.index ?? 0,
        origin: this.currentOrigin,
      });
      this.setSelection({
        type: "text",
        anchor: { blockId: newId, offset: 0 },
        focus: { blockId: newId, offset: 0 },
      });
    });
    return newId;
  }

  mergeBlockWithPrev(id: BlockId): void {
    this.batch(() => {
      const view = this.getBlock(id);
      if (!view) return;
      const prev = this.getPrev(id);
      if (!prev) return;
      // Cannot merge into an ancestor of id (e.g., its parent when id is first child with content)
      // We skip if prev is an ancestor - instead, merging with parent means appending this block's deltas to parent and promoting children.
      const isAncestor = (anc: BlockId, descId: BlockId): boolean => {
        let cur: BlockId | null = this.doc.getParentId(descId);
        while (cur != null) {
          if (cur === anc) return true;
          cur = this.doc.getParentId(cur);
        }
        return false;
      };
      // If prev is a direct ancestor, still merge by appending
      const prevDeltas = prev.deltas;
      const junction = getDeltaLength(prevDeltas);
      const merged = mergeDelta(prevDeltas, view.deltas);
      const children = [...view.childIds];
      // Re-parent children of `id` to `prev` (appended)
      for (const child of children) {
        this.doc.moveBlock(child, prev.id, undefined);
        this.invalidate([child]);
      }
      // Write merged deltas to prev
      this.doc.replaceDeltas(prev.id, merged);
      this.invalidate([prev.id]);
      this.emit({ type: "text:changed", blockId: prev.id, deltas: merged, origin: this.currentOrigin });
      // Delete `id`
      this.doc.deleteBlock(id);
      this.views.delete(id);
      this.extMap.delete(id);
      this.blockListeners.delete(id);
      if (view.parentId != null) this.invalidate([view.parentId]);
      this.allIdsCache = null;
      this.rootIdsCache = null;
      this.notifyTree();
      this.emit({ type: "block:deleted", blockId: id, origin: this.currentOrigin });
      this.setSelection({
        type: "text",
        anchor: { blockId: prev.id, offset: junction },
        focus: { blockId: prev.id, offset: junction },
      });
      void isAncestor; // suppress unused
    });
  }

  // ── Collapse ──────────────────────────────────────────────────────────────

  setCollapsed(id: BlockId, collapsed: boolean): void {
    this.doc.setProp(id, COLLAPSED_PROP, collapsed);
    this.invalidate([id]);
    // Descendants' isVisible changed
    for (const d of this.collectDescendants(id)) this.invalidate([d]);
    this.notifyTree();
    this.emit({ type: "collapsed:changed", blockId: id, isCollapsed: collapsed });
  }

  toggleCollapsed(id: BlockId): void {
    this.setCollapsed(id, !this.isCollapsed(id));
  }

  isCollapsed(id: BlockId): boolean {
    return this.doc.getProp(id, COLLAPSED_PROP) === true;
  }

  // ── Text and marks ────────────────────────────────────────────────────────

  replaceDeltas(id: BlockId, deltas: Delta): void {
    this.doc.replaceDeltas(id, deltas);
    this.invalidate([id]);
    this.emit({ type: "text:changed", blockId: id, deltas, origin: this.currentOrigin });
  }

  mark(id: BlockId, range: MarkRange, key: string, value: unknown): void {
    this.doc.mark(id, range, key, value);
    this.invalidate([id]);
    this.emit({
      type: "mark:changed",
      blockId: id,
      range,
      markKey: key,
      value,
      origin: this.currentOrigin,
    });
  }

  unmark(id: BlockId, range: MarkRange, key: string): void {
    this.doc.unmark(id, range, key);
    this.invalidate([id]);
    this.emit({
      type: "mark:changed",
      blockId: id,
      range,
      markKey: key,
      value: null,
      origin: this.currentOrigin,
    });
  }

  setMark(key: string, value: unknown): void {
    this.applySelectionMark((deltas, start, end) => applyAttributes(deltas, start, end, { [key]: value }));
  }

  unsetMark(key: string): void {
    this.applySelectionMark((deltas, start, end) => applyAttributes(deltas, start, end, { [key]: null }));
  }

  toggleMark(key: string, value: unknown = true): void {
    const sel = this.selection;
    if (!sel || sel.type !== "text") return;
    // Collect full concatenated active check across the selection
    this.batch(() => {
      const active = this.isMarkActive(key);
      this.applySelectionMark((deltas, start, end) =>
        active ? applyAttributes(deltas, start, end, { [key]: null }) : applyAttributes(deltas, start, end, { [key]: value }),
      );
    });
  }

  private applySelectionMark(transform: (deltas: Delta, start: number, end: number) => Delta): void {
    const sel = this.selection;
    if (!sel) return;
    this.batch(() => {
      if (sel.type === "text") {
        const [startCursor, endCursor] = this.normalizeCursors(sel);
        if (startCursor.blockId === endCursor.blockId) {
          const view = this.getBlock(startCursor.blockId);
          if (!view) return;
          const newDeltas = transform(view.deltas, startCursor.offset, endCursor.offset);
          this.replaceDeltas(startCursor.blockId, newDeltas);
        } else {
          const order = this.getAllBlockIds();
          const startIdx = order.indexOf(startCursor.blockId);
          const endIdx = order.indexOf(endCursor.blockId);
          if (startIdx < 0 || endIdx < 0) return;
          for (let i = startIdx; i <= endIdx; i++) {
            const bid = order[i];
            const view = this.getBlock(bid);
            if (!view) continue;
            const len = getDeltaLength(view.deltas);
            let s = 0;
            let e = len;
            if (bid === startCursor.blockId) s = startCursor.offset;
            if (bid === endCursor.blockId) e = endCursor.offset;
            if (e <= s) continue;
            this.replaceDeltas(bid, transform(view.deltas, s, e));
          }
        }
      } else if (sel.type === "block") {
        for (const bid of sel.blockIds) {
          const view = this.getBlock(bid);
          if (!view) continue;
          const len = getDeltaLength(view.deltas);
          if (len === 0) continue;
          this.replaceDeltas(bid, transform(view.deltas, 0, len));
        }
      }
    });
  }

  // ── Props / type ──────────────────────────────────────────────────────────

  setProp(id: BlockId, key: string, value: unknown): void {
    this.doc.setProp(id, key, value);
    this.invalidate([id]);
    this.emit({ type: "prop:changed", blockId: id, key, value, origin: this.currentOrigin });
  }

  getProp(id: BlockId, key: string): unknown {
    return this.doc.getProp(id, key);
  }

  setBlockType(id: BlockId, type: string): void {
    this.setProp(id, "type", type);
  }

  getBlockType(id: BlockId): string | undefined {
    const t = this.doc.getProp(id, "type");
    return typeof t === "string" ? t : undefined;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getBlock(id: BlockId): BlockView | undefined {
    return this.views.get(id);
  }

  getRootIds(): BlockId[] {
    if (this.rootIdsCache == null) this.rootIdsCache = this.doc.getRootIds();
    return [...this.rootIdsCache];
  }

  getAllBlockIds(): BlockId[] {
    if (this.allIdsCache == null) {
      const result: BlockId[] = [];
      const dfs = (id: BlockId): void => {
        result.push(id);
        const view = this.views.get(id);
        if (view) for (const cid of view.childIds) dfs(cid);
      };
      for (const rid of this.getRootIds()) dfs(rid);
      this.allIdsCache = result;
    }
    return [...this.allIdsCache];
  }

  getVisibleIds(): BlockId[] {
    const result: BlockId[] = [];
    const dfs = (id: BlockId): void => {
      const view = this.views.get(id);
      if (!view) return;
      result.push(id);
      if (!view.isCollapsed) {
        for (const cid of view.childIds) dfs(cid);
      }
    };
    for (const rid of this.getRootIds()) dfs(rid);
    return result;
  }

  getNext(id: BlockId): BlockView | undefined {
    const all = this.getAllBlockIds();
    const idx = all.indexOf(id);
    if (idx < 0 || idx >= all.length - 1) return undefined;
    return this.views.get(all[idx + 1]);
  }

  getPrev(id: BlockId): BlockView | undefined {
    const all = this.getAllBlockIds();
    const idx = all.indexOf(id);
    if (idx <= 0) return undefined;
    return this.views.get(all[idx - 1]);
  }

  getNextSibling(id: BlockId): BlockView | undefined {
    const view = this.views.get(id);
    if (!view) return undefined;
    const siblings = view.parentId != null
      ? this.views.get(view.parentId)?.childIds ?? []
      : this.getRootIds();
    const idx = siblings.indexOf(id);
    if (idx < 0 || idx >= siblings.length - 1) return undefined;
    return this.views.get(siblings[idx + 1]);
  }

  getPrevSibling(id: BlockId): BlockView | undefined {
    const view = this.views.get(id);
    if (!view) return undefined;
    const siblings = view.parentId != null
      ? this.views.get(view.parentId)?.childIds ?? []
      : this.getRootIds();
    const idx = siblings.indexOf(id);
    if (idx <= 0) return undefined;
    return this.views.get(siblings[idx - 1]);
  }

  getParent(id: BlockId): BlockView | undefined {
    const view = this.views.get(id);
    if (!view || view.parentId == null) return undefined;
    return this.views.get(view.parentId);
  }

  getChildren(id: BlockId): BlockView[] {
    const view = this.views.get(id);
    if (!view) return [];
    const result: BlockView[] = [];
    for (const cid of view.childIds) {
      const child = this.views.get(cid);
      if (child) result.push(child);
    }
    return result;
  }

  getDescendants(id: BlockId): BlockId[] {
    return this.collectDescendants(id);
  }

  getAncestors(id: BlockId): BlockId[] {
    const result: BlockId[] = [];
    let cur = this.views.get(id);
    while (cur && cur.parentId != null) {
      result.unshift(cur.parentId);
      cur = this.views.get(cur.parentId);
    }
    return result;
  }

  getDepth(id: BlockId): number {
    return this.views.get(id)?.depth ?? 0;
  }

  getSiblings(id: BlockId): BlockId[] {
    const view = this.views.get(id);
    if (!view) return [];
    return view.parentId != null
      ? [...(this.views.get(view.parentId)?.childIds ?? [])]
      : this.getRootIds();
  }

  search(query: string | RegExp, scope?: BlockId): SearchResult[] {
    const results: SearchResult[] = [];
    const ids = scope != null ? [scope, ...this.collectDescendants(scope)] : this.getAllBlockIds();
    const isRegex = query instanceof RegExp;
    const regex = isRegex
      ? new RegExp(query.source, query.flags.includes("g") ? query.flags : `${query.flags}g`)
      : null;
    for (const id of ids) {
      const view = this.views.get(id);
      if (!view) continue;
      const text = deltaToText(view.deltas);
      if (regex) {
        regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(text)) != null) {
          results.push({
            blockId: id,
            range: { start: m.index, end: m.index + m[0].length },
            text: m[0],
          });
          if (m.index === regex.lastIndex) regex.lastIndex++;
        }
      } else {
        const needle = query as string;
        if (needle.length === 0) continue;
        let idx = text.indexOf(needle);
        while (idx >= 0) {
          results.push({
            blockId: id,
            range: { start: idx, end: idx + needle.length },
            text: needle,
          });
          idx = text.indexOf(needle, idx + needle.length);
        }
      }
    }
    return results;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  getSelection(): Selection {
    return this.selection;
  }

  setSelection(sel: Selection): void {
    this.selection = sel;
    this.notifySelection();
    this.emit({ type: "selection:changed", selection: sel });
  }

  isCollapsedCursor(): boolean {
    const sel = this.selection;
    return !!sel
      && sel.type === "text"
      && sel.anchor.blockId === sel.focus.blockId
      && sel.anchor.offset === sel.focus.offset;
  }

  getSelectionRange(blockId: BlockId): MarkRange | null {
    const sel = this.selection;
    if (!sel || sel.type !== "text") return null;
    const order = this.getAllBlockIds();
    const [startCursor, endCursor] = this.normalizeCursors(sel);
    const startIdx = order.indexOf(startCursor.blockId);
    const endIdx = order.indexOf(endCursor.blockId);
    const selfIdx = order.indexOf(blockId);
    if (startIdx < 0 || endIdx < 0 || selfIdx < 0) return null;
    if (selfIdx < startIdx || selfIdx > endIdx) return null;
    const view = this.views.get(blockId);
    if (!view) return null;
    const len = getDeltaLength(view.deltas);
    if (startCursor.blockId === blockId && endCursor.blockId === blockId) {
      const s = Math.min(startCursor.offset, endCursor.offset);
      const e = Math.max(startCursor.offset, endCursor.offset);
      return { start: s, end: e };
    }
    if (startCursor.blockId === blockId) return { start: startCursor.offset, end: len };
    if (endCursor.blockId === blockId) return { start: 0, end: endCursor.offset };
    return { start: 0, end: len };
  }

  collapseToStart(): void {
    const sel = this.selection;
    if (!sel || sel.type !== "text") return;
    const [s] = this.normalizeCursors(sel);
    this.setSelection({ type: "text", anchor: s, focus: s });
  }

  collapseToEnd(): void {
    const sel = this.selection;
    if (!sel || sel.type !== "text") return;
    const [, e] = this.normalizeCursors(sel);
    this.setSelection({ type: "text", anchor: e, focus: e });
  }

  selectBlock(id: BlockId): void {
    const view = this.views.get(id);
    if (!view) return;
    const len = getDeltaLength(view.deltas);
    this.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 0 },
      focus: { blockId: id, offset: len },
    });
  }

  selectAll(): void {
    this.setSelection({ type: "block", blockIds: this.getRootIds() });
  }

  isMarkActive(key: string): boolean {
    const sel = this.selection;
    if (!sel) return false;
    if (sel.type === "text") {
      const [s, e] = this.normalizeCursors(sel);
      if (s.blockId === e.blockId && s.offset === e.offset) {
        // Collapsed cursor: check char to the left
        if (s.offset === 0) return false;
        const view = this.views.get(s.blockId);
        if (!view) return false;
        const v = this.getAttrAt(view.deltas, s.offset - 1, key);
        return v != null && v !== false;
      }
      const order = this.getAllBlockIds();
      const startIdx = order.indexOf(s.blockId);
      const endIdx = order.indexOf(e.blockId);
      if (startIdx < 0 || endIdx < 0) return false;
      for (let i = startIdx; i <= endIdx; i++) {
        const bid = order[i];
        const view = this.views.get(bid);
        if (!view) return false;
        const len = getDeltaLength(view.deltas);
        let ss = 0;
        let ee = len;
        if (bid === s.blockId) ss = s.offset;
        if (bid === e.blockId) ee = e.offset;
        if (ee <= ss) continue;
        if (!this.isAttrActive(view.deltas, ss, ee, key)) return false;
      }
      return true;
    }
    if (sel.type === "block") {
      for (const bid of sel.blockIds) {
        const view = this.views.get(bid);
        if (!view) return false;
        const len = getDeltaLength(view.deltas);
        if (len === 0) return false;
        if (!this.isAttrActive(view.deltas, 0, len, key)) return false;
      }
      return true;
    }
    return false;
  }

  getMarkValue(key: string): unknown {
    const sel = this.selection;
    if (!sel || sel.type !== "text") return null;
    const view = this.views.get(sel.anchor.blockId);
    if (!view) return null;
    const offset = sel.anchor.offset > 0 ? sel.anchor.offset - 1 : 0;
    return this.getAttrAt(view.deltas, offset, key);
  }

  // ── History ───────────────────────────────────────────────────────────────

  undo(): boolean {
    const prevOrigin = this.currentOrigin;
    this.currentOrigin = "undo";
    try {
      const ok = this.doc.undo();
      if (ok) {
        this.rebuildAll();
        this.notifyTree();
      }
      this.emit({ type: "history:undo", success: ok });
      return ok;
    } finally {
      this.currentOrigin = prevOrigin;
    }
  }

  redo(): boolean {
    const prevOrigin = this.currentOrigin;
    this.currentOrigin = "redo";
    try {
      const ok = this.doc.redo();
      if (ok) {
        this.rebuildAll();
        this.notifyTree();
      }
      this.emit({ type: "history:redo", success: ok });
      return ok;
    } finally {
      this.currentOrigin = prevOrigin;
    }
  }

  canUndo(): boolean {
    return this.doc.canUndo();
  }

  canRedo(): boolean {
    return this.doc.canRedo();
  }

  batch(fn: () => void): void {
    if (this.batchDepth === 0) {
      this.doc.transact(() => {
        this.batchDepth++;
        try {
          fn();
        } finally {
          this.batchDepth--;
          this.flushPending();
        }
      });
    } else {
      this.batchDepth++;
      try {
        fn();
      } finally {
        this.batchDepth--;
      }
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  registerCommand(name: string, def: CommandDef): void {
    this.commands.set(name, def);
  }

  exec(name: string, args?: unknown): boolean {
    const def = this.commands.get(name);
    if (!def) return false;
    const ctx = this.makeContext({});
    if (def.can && !def.can(ctx, args)) {
      this.emit({ type: "command:executed", name, args, success: false });
      return false;
    }
    this.batch(() => def.execute(ctx, args));
    this.emit({ type: "command:executed", name, args, success: true });
    return true;
  }

  can(name: string, args?: unknown): boolean {
    const def = this.commands.get(name);
    if (!def) return false;
    if (!def.can) return true;
    return def.can(this.makeContext({}), args);
  }

  chain(): CommandChain {
    return new CommandChain(this);
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  subscribeBlock(id: BlockId, listener: () => void): () => void {
    let set = this.blockListeners.get(id);
    if (!set) {
      set = new Set();
      this.blockListeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.blockListeners.delete(id);
    };
  }

  subscribeTree(listener: () => void): () => void {
    this.treeListeners.add(listener);
    return () => this.treeListeners.delete(listener);
  }

  subscribeSelection(listener: () => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  on<T extends EngineEventType>(
    event: T,
    handler: (e: Extract<EngineEvent, { type: T }>) => void,
  ): () => void {
    let set = this.eventListeners.get(event);
    if (!set) {
      set = new Set();
      this.eventListeners.set(event, set);
    }
    set.add(handler as (e: EngineEvent) => void);
    return () => {
      set!.delete(handler as (e: EngineEvent) => void);
      if (set!.size === 0) this.eventListeners.delete(event);
    };
  }

  // ── Plugin access ─────────────────────────────────────────────────────────

  getPlugin<T = unknown>(name: string): T | undefined {
    return this.pluginApis.get(name) as T | undefined;
  }

  // ── Spec registry ─────────────────────────────────────────────────────────

  registerSpec(spec: BlockSpec): void {
    this.specs.set(spec.type, spec);
    if (spec.commands) {
      for (const [name, def] of Object.entries(spec.commands)) {
        this.registerCommand(name, def);
      }
    }
  }

  getSpec(type: string): BlockSpec | undefined {
    return this.specs.get(type);
  }

  getRegisteredTypes(): string[] {
    return [...this.specs.keys()];
  }

  // ── Ext (plugin-private) ──────────────────────────────────────────────────

  setExt(id: BlockId, key: string, value: unknown): void {
    let ext = this.extMap.get(id);
    if (!ext) {
      ext = {};
      this.extMap.set(id, ext);
    }
    ext[key] = value;
    this.invalidate([id]);
  }

  getExt(id: BlockId, key: string): unknown {
    return this.extMap.get(id)?.[key];
  }

  // ── Serialization (binary) ────────────────────────────────────────────────

  export(): Uint8Array {
    return this.doc.export();
  }

  import(bytes: Uint8Array): void {
    this.doc.import(bytes);
    this.rebuildAll();
    this.notifyTree();
  }

  // ── Serialization (placeholders; real impls added in serializers phase) ───

  toMarkdown(rootId?: BlockId): string {
    return _toMarkdown(this, rootId);
  }

  fromMarkdown(text: string, parentId?: BlockId): BlockId[] {
    return _fromMarkdown(this, text, parentId);
  }

  toJSON(rootId?: BlockId): DocSnapshot {
    return _toJSON(this, rootId);
  }

  fromJSON(snapshot: DocSnapshot, parentId?: BlockId): BlockId[] {
    return _fromJSON(this, snapshot, parentId);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private makeContext(storage: Record<string, unknown>): EngineContext {
    return {
      engine: this,
      storage,
      getPlugin: <T = unknown>(name: string) => this.pluginApis.get(name) as T | undefined,
      on: (event, handler) => this.on(event, handler),
    };
  }

  private invalidate(ids: BlockId[]): void {
    for (const id of ids) {
      if (this.doc.exists(id)) {
        this.views.set(id, this.buildView(id));
        this.pendingBlockNotifies.add(id);
      }
    }
    if (this.batchDepth === 0) this.flushPending();
  }

  private rebuildAll(): void {
    const oldIds = new Set(this.views.keys());
    this.views.clear();
    this.allIdsCache = null;
    this.rootIdsCache = null;
    for (const id of this.doc.getAllIds()) {
      this.views.set(id, this.buildView(id));
    }
    // Notify for any changed ids
    for (const id of this.views.keys()) this.pendingBlockNotifies.add(id);
    for (const id of oldIds) {
      if (!this.views.has(id)) {
        this.pendingBlockNotifies.add(id);
        this.extMap.delete(id);
      }
    }
    this.pendingTreeNotify = true;
    if (this.batchDepth === 0) this.flushPending();
  }

  private buildView(id: BlockId): BlockView {
    const parentId = this.doc.getParentId(id);
    const childIds = this.doc.getChildIds(id);
    const index = this.doc.getIndex(id);
    const depth = this.computeDepth(id);
    const isCollapsed = this.doc.getProp(id, COLLAPSED_PROP) === true;
    const isVisible = this.computeIsVisible(id);
    const deltas = this.doc.getDeltas(id);
    const props = this.doc.getProps(id);
    const ext = this.extMap.get(id) ?? {};
    return {
      id,
      deltas,
      parentId,
      childIds,
      index,
      depth,
      hasChildren: childIds.length > 0,
      isCollapsed,
      isVisible,
      props,
      ext,
    };
  }

  private computeDepth(id: BlockId): number {
    let d = 0;
    let cur = this.doc.getParentId(id);
    while (cur != null) {
      d++;
      cur = this.doc.getParentId(cur);
    }
    return d;
  }

  private computeIsVisible(id: BlockId): boolean {
    let cur = this.doc.getParentId(id);
    while (cur != null) {
      if (this.doc.getProp(cur, COLLAPSED_PROP) === true) return false;
      cur = this.doc.getParentId(cur);
    }
    return true;
  }

  private collectDescendants(id: BlockId): BlockId[] {
    const result: BlockId[] = [];
    const dfs = (bid: BlockId): void => {
      for (const cid of this.doc.getChildIds(bid)) {
        result.push(cid);
        dfs(cid);
      }
    };
    dfs(id);
    return result;
  }

  private normalizeCursors(sel: TextSelection): [TextSelection["anchor"], TextSelection["focus"]] {
    const order = this.getAllBlockIds();
    const ai = order.indexOf(sel.anchor.blockId);
    const fi = order.indexOf(sel.focus.blockId);
    if (ai === fi) {
      if (sel.anchor.offset <= sel.focus.offset) return [sel.anchor, sel.focus];
      return [sel.focus, sel.anchor];
    }
    return ai < fi ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
  }

  private getAttrAt(deltas: Delta, offset: number, key: string): unknown {
    let pos = 0;
    for (const span of deltas) {
      const end = pos + span.insert.length;
      if (offset >= pos && offset < end) return span.attributes?.[key] ?? null;
      pos = end;
    }
    return null;
  }

  private isAttrActive(deltas: Delta, start: number, end: number, key: string): boolean {
    if (end <= start) return false;
    let pos = 0;
    let covered = 0;
    for (const span of deltas) {
      const spanEnd = pos + span.insert.length;
      if (spanEnd <= start) { pos = spanEnd; continue; }
      if (pos >= end) break;
      const v = span.attributes?.[key];
      if (v == null || v === false) return false;
      covered += Math.min(spanEnd, end) - Math.max(pos, start);
      pos = spanEnd;
    }
    return covered === end - start;
  }

  private notifyTree(): void {
    this.pendingTreeNotify = true;
    if (this.batchDepth === 0) this.flushPending();
  }

  private notifySelection(): void {
    this.pendingSelectionNotify = true;
    if (this.batchDepth === 0) this.flushPending();
  }

  private emit(event: EngineEvent): void {
    this.pendingEvents.push(event);
    if (this.batchDepth === 0) this.flushPending();
  }

  private flushPending(): void {
    const blockIds = [...this.pendingBlockNotifies];
    this.pendingBlockNotifies.clear();
    const tree = this.pendingTreeNotify;
    this.pendingTreeNotify = false;
    const selection = this.pendingSelectionNotify;
    this.pendingSelectionNotify = false;
    const events = [...this.pendingEvents];
    this.pendingEvents.length = 0;

    for (const id of blockIds) {
      const set = this.blockListeners.get(id);
      if (set) for (const l of [...set]) l();
    }
    if (tree) {
      for (const l of [...this.treeListeners]) l();
    }
    if (selection) {
      for (const l of [...this.selectionListeners]) l();
    }
    for (const ev of events) {
      const set = this.eventListeners.get(ev.type);
      if (set) for (const l of [...set]) l(ev);
    }
  }
}

export class CommandChain {
  private readonly steps: Array<{ name: string; args?: unknown }> = [];
  constructor(private readonly engine: BlockEngine) {}

  exec(name: string, args?: unknown): this {
    this.steps.push({ name, args });
    return this;
  }

  run(): boolean {
    let allOk = true;
    this.engine.batch(() => {
      for (const step of this.steps) {
        if (!this.engine.exec(step.name, step.args)) allOk = false;
      }
    });
    return allOk;
  }
}

// Suppress unused-imports for modules imported for side-effect in text/mark ops
void sliceDelta;
void toggleAttribute;
