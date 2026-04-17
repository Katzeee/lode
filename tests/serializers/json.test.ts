import { beforeEach, describe, expect, it } from "vitest";
import { BlockEngine } from "../../src/engine.js";
import { textToDelta } from "../../src/delta/utils.js";

let engine: BlockEngine;

beforeEach(() => {
  engine = new BlockEngine();
  engine.mount();
});

describe("toJSON / fromJSON", () => {
  it("round-trips document", () => {
    const a = engine.createBlock();
    engine.replaceDeltas(a, textToDelta("root"));
    const b = engine.createBlock(a);
    engine.replaceDeltas(b, textToDelta("child"));
    engine.setBlockType(b, "heading");
    engine.setProp(b, "level", 2);

    const snap = engine.toJSON();
    expect(snap.version).toBe(2);
    expect(snap.blocks).toHaveLength(1);
    expect(snap.blocks[0].deltas).toEqual([{ insert: "root" }]);
    expect(snap.blocks[0].children).toHaveLength(1);
    expect(snap.blocks[0].children[0].props.type).toBe("heading");

    const engine2 = new BlockEngine();
    engine2.mount();
    engine2.fromJSON(snap);
    const all = engine2.getAllBlockIds();
    expect(all).toHaveLength(2);
    expect(engine2.getBlock(all[0])?.deltas).toEqual([{ insert: "root" }]);
    expect(engine2.getBlock(all[1])?.props.type).toBe("heading");
  });

  it("subtree export/import", () => {
    const a = engine.createBlock();
    const b = engine.createBlock(a);
    const c = engine.createBlock();
    engine.replaceDeltas(a, textToDelta("A"));
    engine.replaceDeltas(b, textToDelta("B"));
    engine.replaceDeltas(c, textToDelta("C"));
    const snap = engine.toJSON(a);
    expect(snap.blocks).toHaveLength(1);
    expect(snap.blocks[0].children).toHaveLength(1);
  });
});
