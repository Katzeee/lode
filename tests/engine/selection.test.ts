import { beforeEach, describe, expect, it } from "vitest";
import { BlockEngine } from "../../src/engine.js";
import { textToDelta } from "../../src/delta/utils.js";

let engine: BlockEngine;

beforeEach(() => {
  engine = new BlockEngine();
  engine.mount();
});

describe("selection queries", () => {
  it("getSelectionRange for single block", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("hello"));
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 1 },
      focus: { blockId: id, offset: 4 },
    });
    expect(engine.getSelectionRange(id)).toEqual({ start: 1, end: 4 });
  });

  it("getSelectionRange multi-block", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    const c = engine.createBlock();
    engine.replaceDeltas(a, textToDelta("aaa"));
    engine.replaceDeltas(b, textToDelta("bbb"));
    engine.replaceDeltas(c, textToDelta("ccc"));
    engine.setSelection({
      type: "text",
      anchor: { blockId: a, offset: 1 },
      focus: { blockId: c, offset: 2 },
    });
    expect(engine.getSelectionRange(a)).toEqual({ start: 1, end: 3 });
    expect(engine.getSelectionRange(b)).toEqual({ start: 0, end: 3 });
    expect(engine.getSelectionRange(c)).toEqual({ start: 0, end: 2 });
  });

  it("collapseToStart / collapseToEnd", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("hello"));
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 1 },
      focus: { blockId: id, offset: 4 },
    });
    engine.collapseToStart();
    const s1 = engine.getSelection();
    expect(s1?.type).toBe("text");
    if (s1?.type === "text") {
      expect(s1.anchor.offset).toBe(1);
      expect(s1.focus.offset).toBe(1);
    }
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 1 },
      focus: { blockId: id, offset: 4 },
    });
    engine.collapseToEnd();
    const s2 = engine.getSelection();
    if (s2?.type === "text") {
      expect(s2.anchor.offset).toBe(4);
    }
  });

  it("selectBlock selects full text", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("hi"));
    engine.selectBlock(id);
    const sel = engine.getSelection();
    expect(sel?.type).toBe("text");
    if (sel?.type === "text") {
      expect(sel.anchor.offset).toBe(0);
      expect(sel.focus.offset).toBe(2);
    }
  });
});

describe("mark operations (selection-aware)", () => {
  it("toggleMark applies then removes", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("hello"));
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 0 },
      focus: { blockId: id, offset: 5 },
    });
    engine.toggleMark("bold");
    expect(engine.getBlock(id)?.deltas[0].attributes?.bold).toBe(true);
    expect(engine.isMarkActive("bold")).toBe(true);
    engine.toggleMark("bold");
    expect(engine.getBlock(id)?.deltas[0].attributes?.bold).toBeFalsy();
    expect(engine.isMarkActive("bold")).toBe(false);
  });

  it("toggleMark on partial range applies full", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, [
      { insert: "he", attributes: { bold: true } },
      { insert: "llo" },
    ]);
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 0 },
      focus: { blockId: id, offset: 5 },
    });
    engine.toggleMark("bold");
    const deltas = engine.getBlock(id)?.deltas ?? [];
    expect(deltas.length).toBe(1);
    expect(deltas[0].attributes?.bold).toBe(true);
  });

  it("isMarkActive on collapsed cursor reads left char", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, [
      { insert: "a", attributes: { bold: true } },
      { insert: "b" },
    ]);
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 1 },
      focus: { blockId: id, offset: 1 },
    });
    expect(engine.isMarkActive("bold")).toBe(true);
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 2 },
      focus: { blockId: id, offset: 2 },
    });
    expect(engine.isMarkActive("bold")).toBe(false);
  });
});

describe("splitBlock", () => {
  it("splits at middle", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("helloworld"));
    const newId = engine.splitBlock(id, 5);
    expect(engine.getBlock(id)?.deltas).toEqual([{ insert: "hello" }]);
    expect(engine.getBlock(newId)?.deltas).toEqual([{ insert: "world" }]);
    expect(engine.getRootIds()).toEqual([id, newId]);
    // Selection points to new block
    const sel = engine.getSelection();
    if (sel?.type === "text") {
      expect(sel.anchor.blockId).toBe(newId);
      expect(sel.anchor.offset).toBe(0);
    }
  });

  it("splits at end with children creates first child", () => {
    const parent = engine.createBlock();
    const child = engine.createBlock(parent);
    engine.replaceDeltas(parent, textToDelta("parent"));
    engine.replaceDeltas(child, textToDelta("c1"));
    const newId = engine.splitBlock(parent, 6);
    expect(engine.getBlock(newId)?.parentId).toBe(parent);
    expect(engine.getBlock(parent)?.childIds).toEqual([newId, child]);
  });

  it("preserves marks across split", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, [
      { insert: "hello", attributes: { bold: true } },
      { insert: "world" },
    ]);
    const newId = engine.splitBlock(id, 3);
    expect(engine.getBlock(id)?.deltas).toEqual([{ insert: "hel", attributes: { bold: true } }]);
    expect(engine.getBlock(newId)?.deltas[0].attributes?.bold).toBe(true);
  });
});

describe("mergeBlockWithPrev", () => {
  it("merges text from prev sibling", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    engine.replaceDeltas(a, textToDelta("hello"));
    engine.replaceDeltas(b, textToDelta(" world"));
    engine.mergeBlockWithPrev(b);
    expect(engine.getBlock(a)?.deltas).toEqual([{ insert: "hello world" }]);
    expect(engine.getBlock(b)).toBeUndefined();
    const sel = engine.getSelection();
    if (sel?.type === "text") {
      expect(sel.anchor.blockId).toBe(a);
      expect(sel.anchor.offset).toBe(5);
    }
  });

  it("re-parents children when merging", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    const b1 = engine.createBlock(b);
    engine.replaceDeltas(a, textToDelta("aaa"));
    engine.replaceDeltas(b, textToDelta("bbb"));
    engine.mergeBlockWithPrev(b);
    expect(engine.getBlock(a)?.childIds).toContain(b1);
    expect(engine.getBlock(b1)?.parentId).toBe(a);
  });
});
