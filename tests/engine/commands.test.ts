import { beforeEach, describe, expect, it } from "vitest";
import { BlockEngine } from "../../src/engine.js";
import { textToDelta } from "../../src/delta/utils.js";

let engine: BlockEngine;

beforeEach(() => {
  engine = new BlockEngine();
  engine.mount();
});

describe("built-in tree commands", () => {
  it("indent via command", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    const ok = engine.exec("indent", { blockId: b });
    expect(ok).toBe(true);
    expect(engine.getBlock(b)?.parentId).toBe(a);
  });

  it("can() returns false when no prev sibling", () => {
    const a = engine.createBlock();
    expect(engine.can("indent", { blockId: a })).toBe(false);
  });

  it("outdent moves to grandparent", () => {
    const a = engine.createBlock();
    const b = engine.createBlock(a);
    engine.exec("outdent", { blockId: b });
    expect(engine.getBlock(b)?.parentId).toBe(null);
  });

  it("moveUp / moveDown", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    engine.exec("moveDown", { blockId: a });
    expect(engine.getRootIds()).toEqual([b, a]);
    engine.exec("moveUp", { blockId: a });
    expect(engine.getRootIds()).toEqual([a, b]);
  });

  it("toggleCollapsed requires children", () => {
    const a = engine.createBlock();
    expect(engine.can("toggleCollapsed", { blockId: a })).toBe(false);
    engine.createBlock(a);
    expect(engine.can("toggleCollapsed", { blockId: a })).toBe(true);
  });
});

describe("splitBlock / mergeBlockWithPrev commands", () => {
  it("splits using selection", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("helloworld"));
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 5 },
      focus: { blockId: id, offset: 5 },
    });
    engine.exec("splitBlock");
    expect(engine.getAllBlockIds()).toHaveLength(2);
  });

  it("merges using selection", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    engine.replaceDeltas(a, textToDelta("foo"));
    engine.replaceDeltas(b, textToDelta("bar"));
    engine.setSelection({
      type: "text",
      anchor: { blockId: b, offset: 0 },
      focus: { blockId: b, offset: 0 },
    });
    engine.exec("mergeBlockWithPrev");
    expect(engine.getBlock(a)?.deltas).toEqual([{ insert: "foobar" }]);
  });
});

describe("mark commands", () => {
  it("toggleMark via command", () => {
    const id = engine.createBlock();
    engine.replaceDeltas(id, textToDelta("hi"));
    engine.setSelection({
      type: "text",
      anchor: { blockId: id, offset: 0 },
      focus: { blockId: id, offset: 2 },
    });
    engine.exec("toggleMark", { key: "bold" });
    expect(engine.isMarkActive("bold")).toBe(true);
    engine.exec("toggleMark", { key: "bold" });
    expect(engine.isMarkActive("bold")).toBe(false);
  });

  it("setBlockType applies spec defaults", () => {
    const id = engine.createBlock();
    engine.exec("setBlockType", { type: "heading", blockId: id });
    expect(engine.getBlockType(id)).toBe("heading");
    expect(engine.getBlock(id)?.props.level).toBe(1);
  });
});

describe("chain", () => {
  it("runs sequence of commands in batch", () => {
    const a = engine.createBlock();
    const b = engine.createBlock();
    let notifyCount = 0;
    engine.subscribeTree(() => notifyCount++);
    const ok = engine.chain()
      .exec("indent", { blockId: b })
      .exec("setBlockType", { type: "heading", blockId: a })
      .run();
    expect(ok).toBe(true);
    expect(engine.getBlock(b)?.parentId).toBe(a);
    expect(engine.getBlockType(a)).toBe("heading");
    expect(notifyCount).toBe(1);
  });

  it("returns false when any step fails", () => {
    const a = engine.createBlock();
    const ok = engine.chain()
      .exec("indent", { blockId: a })   // fails: first sibling
      .run();
    expect(ok).toBe(false);
  });
});

describe("plugin system", () => {
  it("installs and disposes plugin", () => {
    let disposed = false;
    let ctxReceived: unknown = null;
    engine.unmount();
    engine = new BlockEngine();
    engine.use({
      name: "test-plugin",
      install: (ctx) => {
        ctxReceived = ctx;
        return {
          dispose() { disposed = true; },
        };
      },
      getPublicApi: () => ({ foo: "bar" }),
    });
    engine.mount();
    expect(ctxReceived).toBeTruthy();
    expect(engine.getPlugin<{ foo: string }>("test-plugin")).toEqual({ foo: "bar" });
    engine.unmount();
    expect(disposed).toBe(true);
  });

  it("plugin can register commands", () => {
    engine.unmount();
    engine = new BlockEngine();
    engine.use({
      name: "custom",
      install: (ctx) => {
        ctx.engine.registerCommand("custom:createTwo", {
          execute: () => {
            ctx.engine.createBlock();
            ctx.engine.createBlock();
          },
        });
        return { dispose() { /* noop */ } };
      },
    });
    engine.mount();
    engine.exec("custom:createTwo");
    expect(engine.getRootIds()).toHaveLength(2);
  });

  it("plugins receive storage and isolation", () => {
    engine.unmount();
    engine = new BlockEngine();
    let storageA: Record<string, unknown> | null = null;
    let storageB: Record<string, unknown> | null = null;
    engine.use({
      name: "a",
      defaultStorage: () => ({ value: 1 }),
      install: (ctx) => {
        storageA = ctx.storage;
        return { dispose() { /* noop */ } };
      },
    });
    engine.use({
      name: "b",
      defaultStorage: () => ({ value: 2 }),
      install: (ctx) => {
        storageB = ctx.storage;
        return { dispose() { /* noop */ } };
      },
    });
    engine.mount();
    expect(storageA).toEqual({ value: 1 });
    expect(storageB).toEqual({ value: 2 });
    expect(storageA).not.toBe(storageB);
  });
});
