import { beforeEach, describe, expect, it } from "vitest";
import { BlockEngine } from "../../src/engine.js";
import { textToDelta } from "../../src/delta/utils.js";

let engine: BlockEngine;

beforeEach(() => {
  engine = new BlockEngine();
  engine.mount();
});

describe("BlockEngine CRUD", () => {
  it("creates root blocks", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    expect(engine.getRootIds()).toEqual([a, b]);
    expect(engine.getBlock(a)?.index).toBe(0);
    expect(engine.getBlock(b)?.index).toBe(1);
  });

  it("creates child block and tracks parent/child", () => {
    const parent = engine.createBlock();
    const child = engine.createBlock(parent);
    expect(engine.getBlock(parent)?.childIds).toEqual([child]);
    expect(engine.getBlock(parent)?.hasChildren).toBe(true);
    expect(engine.getBlock(child)?.parentId).toBe(parent);
    expect(engine.getBlock(child)?.depth).toBe(1);
  });

  it("deletes block and descendants", () => {
    const parent = engine.createBlock();
    const child = engine.createBlock(parent);
    engine.deleteBlock(parent);
    expect(engine.getBlock(parent)).toBeUndefined();
    expect(engine.getBlock(child)).toBeUndefined();
  });

  it("moves block", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    const c = engine.createBlock(a);
    engine.moveBlock(c, b);
    expect(engine.getBlock(c)?.parentId).toBe(b);
    expect(engine.getBlock(a)?.childIds).toEqual([]);
    expect(engine.getBlock(b)?.childIds).toEqual([c]);
  });
});

describe("BlockEngine tree queries", () => {
  it("getAllBlockIds DFS order", () => {
    const a = engine.createBlock();
    const a1 = engine.createBlock(a);
    const a2 = engine.createBlock(a);
    const b = engine.createBlock();
    expect(engine.getAllBlockIds()).toEqual([a, a1, a2, b]);
  });

  it("getAncestors and getDepth", () => {
    const a = engine.createBlock();
    const b = engine.createBlock(a);
    const c = engine.createBlock(b);
    expect(engine.getAncestors(c)).toEqual([a, b]);
    expect(engine.getDepth(c)).toBe(2);
  });

  it("getVisibleIds respects collapse", () => {
    const a = engine.createBlock();
    const a1 = engine.createBlock(a);
    const b = engine.createBlock();
    engine.setCollapsed(a, true);
    expect(engine.getVisibleIds()).toEqual([a, b]);
    expect(engine.getBlock(a)?.isCollapsed).toBe(true);
    expect(engine.getBlock(a1)?.isVisible).toBe(false);
  });
});

describe("BlockEngine indent/outdent/moveUp/moveDown", () => {
  it("indents under previous sibling", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    engine.indent(b);
    expect(engine.getBlock(b)?.parentId).toBe(a);
  });

  it("no-op indent first sibling", () => {
    const a = engine.createBlock();
    engine.indent(a);
    expect(engine.getBlock(a)?.parentId).toBe(null);
  });

  it("outdents to parent sibling", () => {
    const a = engine.createBlock();
    const b = engine.createBlock(a);
    engine.outdent(b);
    expect(engine.getBlock(b)?.parentId).toBe(null);
  });

  it("moves up and down among siblings", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    const c = engine.createBlock();
    engine.moveDown(a);
    expect(engine.getRootIds()).toEqual([b, a, c]);
    engine.moveUp(a);
    expect(engine.getRootIds()).toEqual([a, b, c]);
  });
});

describe("BlockEngine text and props", () => {
  it("replaceDeltas updates view", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("hello"));
    expect(engine.getBlock(id)?.deltas).toEqual([{ insert: "hello" }]);
  });

  it("setProp updates view", () => {
    const id = engine.createBlock();
    engine.setProp(id, "type", "heading");
    expect(engine.getBlock(id)?.props.type).toBe("heading");
  });

  it("setBlockType / getBlockType", () => {
    const id = engine.createBlock();
    engine.setBlockType(id, "heading");
    expect(engine.getBlockType(id)).toBe("heading");
  });
});

describe("BlockEngine subscriptions", () => {
  it("subscribeBlock fires on change", () => {
    const id = engine.createBlock();
    let hits = 0;
    engine.subscribeBlock(id, () => hits++);
    engine.replaceDeltas(id, textToDelta("abc"));
    expect(hits).toBeGreaterThan(0);
  });

  it("subscribeTree fires on create", () => {
    let hits = 0;
    engine.subscribeTree(() => hits++);
    engine.createBlock();
    expect(hits).toBeGreaterThan(0);
  });

  it("batch defers notifications", () => {
    const id = engine.createBlock();
    let hits = 0;
    engine.subscribeBlock(id, () => hits++);
    engine.batch(() => {
      engine.replaceDeltas(id, textToDelta("a"));
      engine.setProp(id, "type", "heading");
    });
    expect(hits).toBe(1);
  });
});

describe("BlockEngine history", () => {
  it("undo reverts create", () => {
    const before = engine.getRootIds().length;
    engine.createBlock();
    engine.undo();
    expect(engine.getRootIds()).toHaveLength(before);
  });
});

describe("BlockEngine readonly", () => {
  it("throws on mutation", () => {
    engine.readonly = true;
    expect(() => engine.createBlock()).toThrow();
  });
});

describe("BlockEngine search", () => {
  it("finds string matches", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("hello world"));
    const results = engine.search("world");
    expect(results).toHaveLength(1);
    expect(results[0].range).toEqual({ start: 6, end: 11 });
  });

  it("finds regex matches", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    engine.replaceDeltas(a, textToDelta("foo1"));
    engine.replaceDeltas(b, textToDelta("foo2 foo3"));
    const results = engine.search(/foo\d/);
    expect(results).toHaveLength(3);
  });
});
