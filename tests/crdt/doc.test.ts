import { beforeEach, describe, expect, it } from "vitest";
import { BlockDoc } from "../../src/crdt/doc.js";
import type { EngineEvent } from "../../src/types.js";

let doc: BlockDoc;

beforeEach(() => {
  doc = new BlockDoc();
});

describe("BlockDoc CRUD", () => {
  it("creates root block", () => {
    const id = doc.createBlock();
    expect(doc.exists(id)).toBe(true);
    expect(doc.getRootIds()).toEqual([id]);
    expect(doc.getParentId(id)).toBe(null);
  });

  it("creates child block", () => {
    const parent = doc.createBlock();
    const child = doc.createBlock(parent);
    expect(doc.getChildIds(parent)).toEqual([child]);
    expect(doc.getParentId(child)).toBe(parent);
  });

  it("deletes block", () => {
    const id = doc.createBlock();
    doc.deleteBlock(id);
    expect(doc.exists(id)).toBe(false);
  });

  it("moves block", () => {
    const a = doc.createBlock();
    const b = doc.createBlock();
    const child = doc.createBlock(a);
    doc.moveBlock(child, b);
    expect(doc.getParentId(child)).toBe(b);
    expect(doc.getChildIds(a)).toEqual([]);
    expect(doc.getChildIds(b)).toEqual([child]);
  });
});

describe("BlockDoc text", () => {
  it("replaces deltas", () => {
    const id = doc.createBlock();
    doc.replaceDeltas(id, [{ insert: "hello" }]);
    expect(doc.getDeltas(id)).toEqual([{ insert: "hello" }]);
  });

  it("applies mark", () => {
    const id = doc.createBlock();
    doc.replaceDeltas(id, [{ insert: "hello" }]);
    doc.mark(id, { start: 0, end: 5 }, "bold", true);
    const deltas = doc.getDeltas(id);
    expect(deltas[0].attributes?.bold).toBe(true);
  });

  it("removes mark", () => {
    const id = doc.createBlock();
    doc.replaceDeltas(id, [{ insert: "hello", attributes: { bold: true } }]);
    doc.unmark(id, { start: 0, end: 5 }, "bold");
    const deltas = doc.getDeltas(id);
    expect(deltas[0].attributes?.bold).toBeFalsy();
  });
});

describe("BlockDoc props", () => {
  it("sets and gets prop", () => {
    const id = doc.createBlock();
    doc.setProp(id, "type", "heading");
    expect(doc.getProp(id, "type")).toBe("heading");
  });

  it("getProps excludes content", () => {
    const id = doc.createBlock();
    doc.setProp(id, "type", "heading");
    doc.setProp(id, "level", 1);
    const props = doc.getProps(id);
    expect(props).toEqual({ type: "heading", level: 1 });
  });
});

describe("BlockDoc queries", () => {
  it("getAllIds DFS order", () => {
    const a = doc.createBlock();
    const b = doc.createBlock();
    const a1 = doc.createBlock(a);
    const a2 = doc.createBlock(a);
    const b1 = doc.createBlock(b);
    expect(doc.getAllIds()).toEqual([a, a1, a2, b, b1]);
  });
});

describe("BlockDoc history", () => {
  it("undo / redo create", () => {
    const id = doc.createBlock();
    expect(doc.canUndo()).toBe(true);
    doc.undo();
    expect(doc.exists(id)).toBe(false);
    expect(doc.canRedo()).toBe(true);
    doc.redo();
    // Loro may regenerate the tree node with a new id on redo; check count
    expect(doc.getRootIds()).toHaveLength(1);
  });

  it("transact groups operations", () => {
    doc.transact(() => {
      doc.createBlock();
      doc.createBlock();
    });
    expect(doc.getRootIds()).toHaveLength(2);
    doc.undo();
    expect(doc.getRootIds()).toHaveLength(0);
  });
});

describe("BlockDoc events", () => {
  it("fires block:created", async () => {
    const events: EngineEvent[][] = [];
    doc.subscribe(e => events.push(e));
    const id = doc.createBlock();
    // Loro events are async via doc subscription; run a microtask
    await new Promise(r => setTimeout(r, 0));
    const flat = events.flat();
    expect(flat.some(e => e.type === "block:created" && e.blockId === id)).toBe(true);
  });

  it("fires text:changed", async () => {
    const id = doc.createBlock();
    const events: EngineEvent[][] = [];
    doc.subscribe(e => events.push(e));
    doc.replaceDeltas(id, [{ insert: "hi" }]);
    await new Promise(r => setTimeout(r, 0));
    const flat = events.flat();
    expect(flat.some(e => e.type === "text:changed" && e.blockId === id)).toBe(true);
  });

  it("fires prop:changed", async () => {
    const id = doc.createBlock();
    await new Promise(r => setTimeout(r, 0));
    const events: EngineEvent[][] = [];
    doc.subscribe(e => events.push(e));
    doc.setProp(id, "type", "heading");
    await new Promise(r => setTimeout(r, 0));
    const flat = events.flat();
    expect(flat.some(e => e.type === "prop:changed" && e.blockId === id && e.key === "type")).toBe(true);
  });
});

describe("BlockDoc persistence", () => {
  it("round-trips via export/import", () => {
    const id = doc.createBlock();
    doc.replaceDeltas(id, [{ insert: "hello" }]);
    const bytes = doc.export();

    const doc2 = new BlockDoc(bytes);
    expect(doc2.getRootIds()).toHaveLength(1);
    const newId = doc2.getRootIds()[0];
    expect(doc2.getDeltas(newId)).toEqual([{ insert: "hello" }]);
  });
});

describe("BlockDoc readonly", () => {
  it("throws on mutation", () => {
    doc.setReadonly(true);
    expect(() => doc.createBlock()).toThrow();
  });
});
