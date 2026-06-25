import { describe, expect, it } from "vitest";
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { Engine } from "./engine.js";
import { textToDelta } from "./delta/utils.js";

describe("Engine entity and occurrence semantics", () => {
  it("creates nodes and exposes root occurrences", () => {
    const engine = new Engine();
    const first = engine.createNode();
    const second = engine.createNode();

    expect(engine.getRootOccurrences().map((node) => node.occurrenceId)).toEqual([
      first.occurrenceId,
      second.occurrenceId,
    ]);
  });

  it("edits text through a reference occurrence", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const parent = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, parent.occurrenceId);

    engine.replaceDeltas(ref.occurrenceId, textToDelta("shared"));

    expect(engine.getOccurrence(source.occurrenceId)?.deltas).toEqual([{ insert: "shared" }]);
    expect(engine.getOccurrence(ref.occurrenceId)?.deltas).toEqual([{ insert: "shared" }]);
  });

  it("creates physical children under the requested parent occurrence", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const parent = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, parent.occurrenceId);
    const child = engine.createNode(ref.occurrenceId);

    expect(
      engine.getOccurrenceChildren(source.occurrenceId).map((node) => node.occurrenceId),
    ).toEqual([]);
    expect(engine.getOccurrenceChildren(ref.occurrenceId).map((node) => node.occurrenceId)).toEqual(
      [child.occurrenceId],
    );
  });

  it("creates reference children under the requested parent occurrence", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const holder = engine.createNode();
    const refParent = engine.createOccurrence(source.nodeId, holder.occurrenceId);
    const target = engine.createNode();

    const childRef = engine.createOccurrence(target.nodeId, refParent.occurrenceId);

    expect(engine.getOccurrence(childRef.occurrenceId)?.parentOccurrenceId).toBe(
      refParent.occurrenceId,
    );
    expect(
      engine.getOccurrenceChildren(source.occurrenceId).map((node) => node.occurrenceId),
    ).toEqual([]);
    expect(
      engine.getOccurrenceChildren(refParent.occurrenceId).map((node) => node.occurrenceId),
    ).toEqual([childRef.occurrenceId]);
  });

  it("keeps public props shared, occurrence props local, and meta hidden from node views", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const holder = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, holder.occurrenceId);

    engine.setProp(ref.occurrenceId, "status", "todo");
    engine.setOccurrenceProp(ref.occurrenceId, "collapsed", true);
    engine.setEntityMeta(ref.occurrenceId, "systemKind", "schema");
    engine.setOccurrenceMeta(ref.occurrenceId, "managedKind", "fieldSlot");

    expect(engine.getOccurrence(source.occurrenceId)?.props).toEqual({ status: "todo" });
    expect(engine.getOccurrence(ref.occurrenceId)?.props).toEqual({ status: "todo" });
    expect(engine.getOccurrence(source.occurrenceId)?.occurrenceProps).toEqual({});
    expect(engine.getOccurrence(ref.occurrenceId)?.occurrenceProps).toEqual({ collapsed: true });
    expect(engine.getEntityMeta(ref.occurrenceId, "systemKind")).toBe("schema");
    expect(engine.getOccurrenceMeta(ref.occurrenceId, "managedKind")).toBe("fieldSlot");
  });

  it("removes a non-canonical occurrence without deleting the entity", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const parent = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, parent.occurrenceId);

    engine.removeOccurrence(ref.occurrenceId);

    expect(engine.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(engine.getOccurrence(source.occurrenceId)?.nodeId).toBe(source.nodeId);
  });

  it("rejects removing an occurrence while it has physical children", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const parent = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, parent.occurrenceId);
    const child = engine.createNode(ref.occurrenceId);

    expect(() => engine.removeOccurrence(ref.occurrenceId)).toThrow(
      /Cannot remove occurrence with children/,
    );
    expect(engine.getOccurrence(ref.occurrenceId)?.nodeId).toBe(source.nodeId);
    expect(engine.getOccurrence(child.occurrenceId)?.nodeId).toBe(child.nodeId);
  });

  it("rejects removing a canonical occurrence", () => {
    const engine = new Engine();
    const source = engine.createNode();

    expect(() => engine.removeOccurrence(source.occurrenceId)).toThrow(
      /Cannot remove canonical occurrence/,
    );
  });

  it("sets canonical occurrence without moving physical children", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const holder = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, holder.occurrenceId);
    const child = engine.createNode(source.occurrenceId);

    engine.setCanonicalOccurrence(source.nodeId, ref.occurrenceId);

    expect(engine.getOccurrence(source.occurrenceId)?.canonicalOccurrenceId).toBe(ref.occurrenceId);
    expect(
      engine.getOccurrenceChildren(source.occurrenceId).map((node) => node.occurrenceId),
    ).toEqual([child.occurrenceId]);
    expect(engine.getOccurrenceChildren(ref.occurrenceId)).toEqual([]);
  });

  it("deletes a node entity and all of its occurrences", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const holder = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, holder.occurrenceId);

    engine.deleteNode(source.nodeId);

    expect(engine.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(engine.getOccurrence(ref.occurrenceId)).toBeUndefined();
  });

  it("rejects deleting a node while any occurrence has physical children", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const child = engine.createNode(source.occurrenceId);

    expect(() => engine.deleteNode(source.nodeId)).toThrow(/Cannot delete node with children/);
    expect(engine.getOccurrence(source.occurrenceId)?.nodeId).toBe(source.nodeId);
    expect(engine.getOccurrence(child.occurrenceId)?.nodeId).toBe(child.nodeId);
  });

  it("emits payloads for text and canonical changes via slots", () => {
    const engine = new Engine();
    const source = engine.createNode();
    const holder = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, holder.occurrenceId);
    const received: unknown[] = [];
    engine.slots.nodeUpdated.subscribe((payload) => received.push(payload));

    engine.replaceDeltas(ref.occurrenceId, [{ insert: "updated" }]);
    engine.setCanonicalOccurrence(source.nodeId, ref.occurrenceId);

    expect(received).toEqual(
      expect.arrayContaining([
        { type: "entityUpdated", nodeId: source.nodeId, field: "text" },
        { type: "canonicalChanged", nodeId: source.nodeId, occurrenceId: ref.occurrenceId },
      ]),
    );
  });

  it("emits node payloads on slots.nodeUpdated when a node is created", () => {
    const engine = new Engine();
    const received: unknown[] = [];
    engine.slots.nodeUpdated.subscribe((payload) => received.push(payload));

    const node = engine.createNode();

    expect(received).toContainEqual({
      type: "entityAdded",
      nodeId: node.nodeId,
      occurrenceId: node.occurrenceId,
    });
  });

  it("dispose completes the slots subject", () => {
    const engine = new Engine();
    let completed = false;
    engine.slots.nodeUpdated.subscribe({
      complete: () => {
        completed = true;
      },
    });

    engine.dispose();

    expect(completed).toBe(true);
  });

  it("exports snapshots and incremental updates with explicit APIs", () => {
    const source = new Engine();
    const root = source.createNode();
    const version = source.getVersion();

    source.replaceDeltas(root.occurrenceId, [{ insert: "persisted" }]);
    const update = source.exportUpdateFrom(version);

    const target = new Engine({ initialBytes: source.exportSnapshot() });

    expect(update.length).toBeGreaterThan(0);
    expect(target.mustGetOccurrence(root.occurrenceId).deltas).toEqual([{ insert: "persisted" }]);
  });

  it("rejects imported occurrences that reference missing entities", () => {
    const doc = new LoroDoc();
    const occurrence = doc.getTree("occurrences").createNode();
    occurrence.data.set("nodeId", "missing-node");
    occurrence.data.setContainer("props", new LoroMap());
    occurrence.data.setContainer("meta", new LoroMap());
    doc.commit();

    expect(() => new Engine({ initialBytes: doc.export({ mode: "snapshot" }) })).toThrow(
      /Occurrence references missing entity/,
    );
  });

  it("rejects imported entities whose canonical occurrence is missing", () => {
    const doc = new LoroDoc();
    const occurrence = doc.getTree("occurrences").createNode();
    occurrence.data.set("nodeId", "node-1");
    occurrence.data.setContainer("props", new LoroMap());
    occurrence.data.setContainer("meta", new LoroMap());
    const entity = doc.getMap("entities").setContainer("node-1", new LoroMap());
    entity.set("canonicalOccurrenceId", "missing-occurrence");
    entity.setContainer("content", new LoroText());
    entity.setContainer("props", new LoroMap());
    entity.setContainer("meta", new LoroMap());
    doc.commit();

    expect(() => new Engine({ initialBytes: doc.export({ mode: "snapshot" }) })).toThrow(
      /Canonical occurrence not found/,
    );
  });
});
