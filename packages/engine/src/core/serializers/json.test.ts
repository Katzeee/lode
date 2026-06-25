import { beforeEach, describe, expect, it } from "vitest";
import { textToDelta } from "../delta/utils.js";
import { Engine } from "../engine.js";
import { fromJSON, toJSON } from "./json.js";

let engine: Engine;

beforeEach(() => {
  engine = new Engine();
});

describe("toJSON / fromJSON", () => {
  it("exports entities and occurrences separately", () => {
    const root = engine.createNode();
    engine.replaceDeltas(root.occurrenceId, textToDelta("root"));
    const child = engine.createNode(root.occurrenceId, undefined, { type: "heading" });
    engine.setOccurrenceProp(child.occurrenceId, "collapsed", true);
    engine.setEntityMeta(child.occurrenceId, "systemKind", "schema");
    engine.setOccurrenceMeta(child.occurrenceId, "managedKind", "fieldSlot");

    const snap = toJSON(engine);

    expect(snap.version).toBe(4);
    expect(snap.entities.map((entity) => entity.nodeId).sort()).toEqual(
      [root.nodeId, child.nodeId].sort(),
    );
    expect(snap.entities.find((entity) => entity.nodeId === child.nodeId)?.props).toEqual({
      type: "heading",
    });
    expect(snap.entities.find((entity) => entity.nodeId === child.nodeId)?.meta).toEqual({
      systemKind: "schema",
    });
    expect(
      snap.occurrences.find((occurrence) => occurrence.occurrenceId === child.occurrenceId)
        ?.occurrenceProps,
    ).toEqual({ collapsed: true });
    expect(
      snap.occurrences.find((occurrence) => occurrence.occurrenceId === child.occurrenceId)
        ?.occurrenceMeta,
    ).toEqual({ managedKind: "fieldSlot" });
    expect(snap.rootOccurrenceIds).toEqual([root.occurrenceId]);
  });

  it("round-trips shared entities with multiple occurrences", () => {
    const source = engine.createNode();
    const holder = engine.createNode();
    engine.replaceDeltas(source.occurrenceId, textToDelta("shared"));
    engine.createOccurrence(source.nodeId, holder.occurrenceId);

    const snap = toJSON(engine);
    const engine2 = new Engine();
    fromJSON(engine2, snap);

    const roots = engine2.getRootOccurrences();
    const importedHolder = roots.find((node) => node.deltas.length === 0);
    if (!importedHolder) {
      throw new Error("Imported holder not found");
    }
    const importedRef = engine2.getOccurrenceChildren(importedHolder.occurrenceId)[0];
    if (!importedRef) {
      throw new Error("Imported ref not found");
    }
    const importedSource = roots.find((node) => node.deltas[0]?.insert === "shared");
    if (!importedSource) {
      throw new Error("Imported source not found");
    }

    expect(importedRef.nodeId).toBe(importedSource.nodeId);
    expect(importedRef.occurrenceId).not.toBe(importedSource.occurrenceId);
    engine2.dispose();
  });

  it("serializes reference occurrence children as physical children only", () => {
    const source = engine.createNode();
    const child = engine.createNode(source.occurrenceId);
    const holder = engine.createNode();
    const ref = engine.createOccurrence(source.nodeId, holder.occurrenceId);

    const snap = toJSON(engine);
    const sourceOccurrence = snap.occurrences.find(
      (occurrence) => occurrence.occurrenceId === source.occurrenceId,
    );
    const refOccurrence = snap.occurrences.find(
      (occurrence) => occurrence.occurrenceId === ref.occurrenceId,
    );

    expect(sourceOccurrence?.physicalChildOccurrenceIds).toEqual([child.occurrenceId]);
    expect(refOccurrence?.physicalChildOccurrenceIds).toEqual([]);
  });
});
