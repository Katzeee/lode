import { describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { textToDelta } from "./delta.js";

describe("Engine entity and occurrence semantics", () => {
  it("creates nodes and exposes root occurrences", async () => {
    const engine = new Engine();
    const first = await engine.createNode();
    const second = await engine.createNode();

    expect((await engine.getRootOccurrences()).map((node) => node.occurrenceId)).toEqual([
      first.occurrenceId,
      second.occurrenceId,
    ]);
  });

  it("edits text through a reference occurrence", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const parent = await engine.createNode();
    const ref = await engine.createOccurrence(source.nodeId, parent.occurrenceId);

    await engine.replaceDeltas(ref.occurrenceId, textToDelta("shared"));

    expect((await engine.getOccurrence(source.occurrenceId))?.deltas).toEqual([
      { insert: "shared" },
    ]);
    expect((await engine.getOccurrence(ref.occurrenceId))?.deltas).toEqual([{ insert: "shared" }]);
  });

  it("creates physical children under the requested parent occurrence", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const parent = await engine.createNode();
    const ref = await engine.createOccurrence(source.nodeId, parent.occurrenceId);
    const child = await engine.createNode(ref.occurrenceId);

    expect(
      (await engine.getOccurrenceChildren(source.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([]);
    expect(
      (await engine.getOccurrenceChildren(ref.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([child.occurrenceId]);
  });

  it("creates reference children under the requested parent occurrence", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const holder = await engine.createNode();
    const refParent = await engine.createOccurrence(source.nodeId, holder.occurrenceId);
    const target = await engine.createNode();

    const childRef = await engine.createOccurrence(target.nodeId, refParent.occurrenceId);

    expect((await engine.getOccurrence(childRef.occurrenceId))?.parentOccurrenceId).toBe(
      refParent.occurrenceId,
    );
    expect(
      (await engine.getOccurrenceChildren(source.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([]);
    expect(
      (await engine.getOccurrenceChildren(refParent.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([childRef.occurrenceId]);
  });

  it("keeps public props shared, occurrence props local, and meta hidden from node views", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const holder = await engine.createNode();
    const ref = await engine.createOccurrence(source.nodeId, holder.occurrenceId);

    await engine.setProp(ref.occurrenceId, "status", "todo");
    await engine.setOccurrenceProp(ref.occurrenceId, "collapsed", true);
    await engine.setEntityMeta(ref.occurrenceId, "systemKind", "schema");
    await engine.setOccurrenceMeta(ref.occurrenceId, "managedKind", "fieldSlot");

    expect((await engine.getOccurrence(source.occurrenceId))?.props).toEqual({ status: "todo" });
    expect((await engine.getOccurrence(ref.occurrenceId))?.props).toEqual({ status: "todo" });
    expect((await engine.getOccurrence(source.occurrenceId))?.occurrenceProps).toEqual({});
    expect((await engine.getOccurrence(ref.occurrenceId))?.occurrenceProps).toEqual({
      collapsed: true,
    });
    expect(await engine.getEntityMeta(ref.occurrenceId, "systemKind")).toBe("schema");
    expect(engine.getOccurrenceMeta(ref.occurrenceId, "managedKind")).toBe("fieldSlot");
  });

  it("removes a non-canonical occurrence without deleting the entity", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const parent = await engine.createNode();
    const ref = await engine.createOccurrence(source.nodeId, parent.occurrenceId);

    await engine.removeOccurrence(ref.occurrenceId);

    expect(await engine.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect((await engine.getOccurrence(source.occurrenceId))?.nodeId).toBe(source.nodeId);
  });

  it("rejects removing an occurrence while it has physical children", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const parent = await engine.createNode();
    const ref = await engine.createOccurrence(source.nodeId, parent.occurrenceId);
    const child = await engine.createNode(ref.occurrenceId);

    await expect(engine.removeOccurrence(ref.occurrenceId)).rejects.toThrow(
      /Cannot remove occurrence with children/,
    );
    expect((await engine.getOccurrence(ref.occurrenceId))?.nodeId).toBe(source.nodeId);
    expect((await engine.getOccurrence(child.occurrenceId))?.nodeId).toBe(child.nodeId);
  });

  it("rejects removing a canonical occurrence", async () => {
    const engine = new Engine();
    const source = await engine.createNode();

    await expect(engine.removeOccurrence(source.occurrenceId)).rejects.toThrow(
      /Cannot remove canonical occurrence/,
    );
  });

  it("sets canonical occurrence without moving physical children", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const holder = await engine.createNode();
    const ref = await engine.createOccurrence(source.nodeId, holder.occurrenceId);
    const child = await engine.createNode(source.occurrenceId);

    await engine.setCanonicalOccurrence(source.nodeId, ref.occurrenceId);

    expect((await engine.getOccurrence(source.occurrenceId))?.canonicalOccurrenceId).toBe(
      ref.occurrenceId,
    );
    expect(
      (await engine.getOccurrenceChildren(source.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([child.occurrenceId]);
    expect(await engine.getOccurrenceChildren(ref.occurrenceId)).toEqual([]);
  });

  it("deletes a node entity and all of its occurrences", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const holder = await engine.createNode();
    const ref = await engine.createOccurrence(source.nodeId, holder.occurrenceId);

    await engine.deleteNode(source.nodeId);

    expect(await engine.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await engine.getOccurrence(ref.occurrenceId)).toBeUndefined();
  });

  it("rejects deleting a node while any occurrence has physical children", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const child = await engine.createNode(source.occurrenceId);

    await expect(engine.deleteNode(source.nodeId)).rejects.toThrow(
      /Cannot delete node with children/,
    );
    expect((await engine.getOccurrence(source.occurrenceId))?.nodeId).toBe(source.nodeId);
    expect((await engine.getOccurrence(child.occurrenceId))?.nodeId).toBe(child.nodeId);
  });

  it("returns text and canonical effects from captureEffects", async () => {
    const engine = new Engine();
    const source = await engine.createNode();
    const holder = await engine.createNode();
    const ref = await engine.createOccurrence(source.nodeId, holder.occurrenceId);

    const { effects } = await engine.captureEffects(async () => {
      await engine.replaceDeltas(ref.occurrenceId, [{ insert: "updated" }]);
      await engine.setCanonicalOccurrence(source.nodeId, ref.occurrenceId);
    });

    expect(effects).toEqual(
      expect.arrayContaining([
        { type: "entityUpdated", nodeId: source.nodeId, field: "text" },
        { type: "canonicalChanged", nodeId: source.nodeId, occurrenceId: ref.occurrenceId },
      ]),
    );
  });

  it("returns node-added effects when a node is created", async () => {
    const engine = new Engine();

    const { result: node, effects } = await engine.captureEffects(() => engine.createNode());

    expect(effects).toContainEqual({
      type: "entityAdded",
      nodeId: node.nodeId,
      occurrenceId: node.occurrenceId,
    });
  });
});
