import {
  LoroDoc,
  LoroMap,
  LoroText,
  LoroTree,
  UndoManager,
  type ContainerID,
  type LoroEventBatch,
  type LoroTreeNode,
  type TreeID,
} from "loro-crdt";
import type { BlockId, Delta, DeltaInsert, EngineEvent, EventOrigin, MarkRange } from "../types.js";

export interface BlockDocOptions {
  historyMergeInterval?: number;
}

export class BlockDoc {
  readonly doc: LoroDoc;
  private tree: LoroTree;
  private undoManager: UndoManager;
  private _readonly = false;
  private listeners: Array<(events: EngineEvent[]) => void> = [];
  private unsubscribe: () => void;
  private inTransaction = false;
  // O(1) reverse-lookup: ContainerID string → BlockId
  private containerToBlock = new Map<string, BlockId>();

  constructor(bytes?: Uint8Array, options: BlockDocOptions = {}) {
    this.doc = new LoroDoc();
    this.doc.configTextStyle({
      bold: { expand: "after" },
      italic: { expand: "after" },
      underline: { expand: "after" },
      strikethrough: { expand: "after" },
      code: { expand: "none" },
      link: { expand: "none" },
    });
    if (bytes && bytes.length > 0) this.doc.import(bytes);
    this.tree = this.doc.getTree("blocks");
    this.rebuildContainerMap();
    this.undoManager = new UndoManager(this.doc, {
      mergeInterval: options.historyMergeInterval ?? 500,
    });
    this.unsubscribe = this.doc.subscribe((ev: LoroEventBatch) => this.handleEvent(ev));
  }

  // ── Readonly ─────────────────────────────────────────────────────────────

  get readonly(): boolean {
    return this._readonly;
  }

  setReadonly(val: boolean): void {
    this._readonly = val;
  }

  private requireWritable(): void {
    if (this._readonly) throw new Error("Document is readonly");
  }

  // ── Block CRUD ────────────────────────────────────────────────────────────

  createBlock(parentId?: BlockId, index?: number): BlockId {
    this.requireWritable();
    let node: LoroTreeNode;
    if (parentId != null) {
      const parent = this.tree.getNodeByID(parentId as TreeID);
      if (!parent || parent.isDeleted()) throw new Error(`Parent block not found: ${parentId}`);
      node = this.tree.createNode(parent.id, index);
    } else {
      node = this.tree.createNode(undefined, index);
    }
    const text = node.data.setContainer("content", new LoroText()) as LoroText;
    const id = String(node.id);
    this.containerToBlock.set(String(node.data.id), id);
    this.containerToBlock.set(String(text.id), id);
    if (!this.inTransaction) this.doc.commit();
    return id;
  }

  deleteBlock(id: BlockId): void {
    this.requireWritable();
    // Clean up reverse-lookup entries for this block's containers
    for (const [k, v] of this.containerToBlock) {
      if (v === id) this.containerToBlock.delete(k);
    }
    this.tree.delete(id as TreeID);
    if (!this.inTransaction) this.doc.commit();
  }

  moveBlock(id: BlockId, newParentId: BlockId | null, index?: number): void {
    this.requireWritable();
    const parentTreeId = newParentId != null ? (newParentId as TreeID) : undefined;
    this.tree.move(id as TreeID, parentTreeId, index);
    if (!this.inTransaction) this.doc.commit();
  }

  // ── Text ───────────────────────────────────────────────────────────────────

  private textOf(id: BlockId): LoroText {
    const node = this.tree.getNodeByID(id as TreeID);
    if (!node || node.isDeleted()) throw new Error(`Block not found: ${id}`);
    let text = node.data.get("content");
    if (!(text instanceof LoroText)) {
      text = node.data.setContainer("content", new LoroText()) as LoroText;
    }
    return text as LoroText;
  }

  getDeltas(id: BlockId): Delta {
    const raw = this.textOf(id).toDelta() as Array<Record<string, unknown>>;
    return raw
      .filter((d): d is { insert: string; attributes?: Record<string, unknown> } =>
        typeof d.insert === "string",
      )
      .map(d => {
        const out: DeltaInsert = { insert: d.insert };
        if (d.attributes && Object.keys(d.attributes).length > 0) out.attributes = d.attributes;
        return out;
      });
  }

  replaceDeltas(id: BlockId, deltas: Delta): void {
    this.requireWritable();
    const t = this.textOf(id);
    const len = t.length;
    if (len > 0) t.delete(0, len);
    const fullText = deltas.map(d => d.insert).join("");
    if (fullText.length > 0) t.insert(0, fullText);
    let pos = 0;
    for (const span of deltas) {
      const end = pos + span.insert.length;
      if (span.attributes) {
        for (const [key, value] of Object.entries(span.attributes)) {
          t.mark({ start: pos, end }, key, value as never);
        }
      }
      pos = end;
    }
    if (!this.inTransaction) this.doc.commit();
  }

  mark(id: BlockId, range: MarkRange, key: string, value: unknown): void {
    this.requireWritable();
    this.textOf(id).mark({ start: range.start, end: range.end }, key, value as never);
    if (!this.inTransaction) this.doc.commit();
  }

  unmark(id: BlockId, range: MarkRange, key: string): void {
    this.requireWritable();
    this.textOf(id).unmark({ start: range.start, end: range.end }, key);
    if (!this.inTransaction) this.doc.commit();
  }

  // ── Props ──────────────────────────────────────────────────────────────────

  private dataOf(id: BlockId): LoroMap {
    const node = this.tree.getNodeByID(id as TreeID);
    if (!node || node.isDeleted()) throw new Error(`Block not found: ${id}`);
    return node.data;
  }

  getProp(id: BlockId, key: string): unknown {
    return this.dataOf(id).get(key);
  }

  setProp(id: BlockId, key: string, value: unknown): void {
    this.requireWritable();
    this.dataOf(id).set(key, value as never);
    if (!this.inTransaction) this.doc.commit();
  }

  getProps(id: BlockId): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const data = this.dataOf(id);
    for (const [key, value] of data.entries()) {
      if (key === "content") continue;
      out[key] = value;
    }
    return out;
  }

  // ── Tree queries ───────────────────────────────────────────────────────────

  getRootIds(): BlockId[] {
    return this.tree.roots().map(n => String(n.id));
  }

  getIndex(id: BlockId): number {
    const node = this.tree.getNodeByID(id as TreeID);
    if (!node || node.isDeleted()) return 0;
    return node.index() ?? 0;
  }

  getParentId(id: BlockId): BlockId | null {
    const node = this.tree.getNodeByID(id as TreeID);
    if (!node || node.isDeleted()) return null;
    const parent = node.parent();
    return parent ? String(parent.id) : null;
  }

  getChildIds(id: BlockId): BlockId[] {
    const node = this.tree.getNodeByID(id as TreeID);
    if (!node || node.isDeleted()) return [];
    const kids = node.children();
    return kids ? kids.map(c => String(c.id)) : [];
  }

  getAllIds(): BlockId[] {
    const result: BlockId[] = [];
    const dfs = (id: BlockId): void => {
      result.push(id);
      for (const cid of this.getChildIds(id)) dfs(cid);
    };
    for (const rid of this.getRootIds()) dfs(rid);
    return result;
  }

  exists(id: BlockId): boolean {
    if (!this.tree.has(id as TreeID)) return false;
    const node = this.tree.getNodeByID(id as TreeID);
    return !!node && !node.isDeleted();
  }

  // ── History ───────────────────────────────────────────────────────────────

  transact(fn: () => void): void {
    this.undoManager.groupStart();
    this.inTransaction = true;
    try {
      fn();
      this.doc.commit();
    } finally {
      this.inTransaction = false;
      this.undoManager.groupEnd();
    }
  }

  undo(): boolean {
    return this.undoManager.undo();
  }

  redo(): boolean {
    return this.undoManager.redo();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  export(): Uint8Array {
    return this.doc.export({ mode: "snapshot" });
  }

  import(bytes: Uint8Array): void {
    this.doc.import(bytes);
    this.rebuildContainerMap();
  }

  // ── Events ────────────────────────────────────────────────────────────────

  subscribe(listener: (events: EngineEvent[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    this.listeners.length = 0;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private handleEvent(batch: LoroEventBatch): void {
    if (!batch.events || batch.events.length === 0) return;
    const origin = this.mapOrigin(batch);
    const out: EngineEvent[] = [];
    for (const ev of batch.events) {
      const diff = ev.diff;
      if (diff.type === "tree") {
        for (const item of diff.diff) {
          const blockId = String(item.target);
          if (item.action === "create") {
            out.push({
              type: "block:created",
              blockId,
              parentId: item.parent != null ? String(item.parent) : null,
              index: item.index,
              origin,
            });
          } else if (item.action === "delete") {
            out.push({ type: "block:deleted", blockId, origin });
          } else if (item.action === "move") {
            out.push({
              type: "block:moved",
              blockId,
              newParentId: item.parent != null ? String(item.parent) : null,
              newIndex: item.index,
              origin,
            });
          }
        }
      } else if (diff.type === "text") {
        const blockId = this.blockIdForContainer(ev.target);
        if (blockId) {
          out.push({ type: "text:changed", blockId, deltas: this.safeGetDeltas(blockId), origin });
        }
      } else if (diff.type === "map") {
        const blockId = this.blockIdForContainer(ev.target);
        if (blockId) {
          for (const [key, value] of Object.entries(diff.updated)) {
            if (key === "content") continue;
            out.push({ type: "prop:changed", blockId, key, value, origin });
          }
        }
      }
    }
    if (out.length > 0) {
      for (const listener of [...this.listeners]) listener(out);
    }
  }

  private mapOrigin(batch: LoroEventBatch): EventOrigin {
    if (batch.by === "import") return "import";
    const origin = batch.origin ?? "";
    if (origin === "undo") return "undo";
    if (origin === "redo") return "redo";
    if (origin.startsWith("peer:")) return origin as EventOrigin;
    return "user";
  }

  private rebuildContainerMap(): void {
    this.containerToBlock.clear();
    for (const node of this.tree.getNodes({ withDeleted: false })) {
      const id = String(node.id);
      this.containerToBlock.set(String(node.data.id), id);
      const content = node.data.get("content");
      if (content instanceof LoroText) {
        this.containerToBlock.set(String(content.id), id);
      }
    }
  }

  private blockIdForContainer(target: ContainerID | undefined): BlockId | null {
    if (!target) return null;
    return this.containerToBlock.get(String(target)) ?? null;
  }

  private safeGetDeltas(id: BlockId): Delta {
    try {
      return this.getDeltas(id);
    } catch {
      return [];
    }
  }
}
