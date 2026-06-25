import { describe, expect, it } from "vitest";
import { Engine } from "../core/engine.js";
import {
  cloneOccurrence,
  createPlainNode,
  createReference,
  getSemanticChildren,
  hardDeleteNode,
  promoteCanonicalOccurrence,
  removeOccurrenceOrHardDelete,
} from "./node.js";

describe("domain node semantics", () => {
  it("creates plain and reference children through the canonical child owner", () => {
    const doc = new Engine();
    const source = createPlainNode(doc);
    const holder = createPlainNode(doc);
    const refParent = createReference(doc, source.nodeId, holder.occurrenceId);
    const target = createPlainNode(doc);

    const plainChild = createPlainNode(doc, refParent.occurrenceId);
    const refChild = createReference(doc, target.nodeId, refParent.occurrenceId);

    expect(doc.getOccurrence(plainChild.occurrenceId)?.parentOccurrenceId).toBe(
      source.occurrenceId,
    );
    expect(doc.getOccurrence(refChild.occurrenceId)?.parentOccurrenceId).toBe(source.occurrenceId);
    expect(getSemanticChildren(doc, source.occurrenceId).map((node) => node.occurrenceId)).toEqual([
      plainChild.occurrenceId,
      refChild.occurrenceId,
    ]);
    expect(
      getSemanticChildren(doc, refParent.occurrenceId).map((node) => node.occurrenceId),
    ).toEqual([plainChild.occurrenceId, refChild.occurrenceId]);
  });

  it("promotes canonical occurrence and moves semantic children to the new owner", () => {
    const doc = new Engine();
    const source = createPlainNode(doc);
    const holder = createPlainNode(doc);
    const ref = createReference(doc, source.nodeId, holder.occurrenceId);
    const child = createPlainNode(doc, source.occurrenceId);

    promoteCanonicalOccurrence(doc, source.nodeId, ref.occurrenceId);

    expect(doc.getOccurrence(source.occurrenceId)?.canonicalOccurrenceId).toBe(ref.occurrenceId);
    expect(doc.getOccurrenceChildren(source.occurrenceId)).toEqual([]);
    expect(doc.getOccurrenceChildren(ref.occurrenceId).map((node) => node.occurrenceId)).toEqual([
      child.occurrenceId,
    ]);
    expect(getSemanticChildren(doc, source.occurrenceId).map((node) => node.occurrenceId)).toEqual([
      child.occurrenceId,
    ]);
  });

  it("clones an occurrence into an independent semantic subtree", () => {
    const doc = new Engine();
    const source = createPlainNode(doc);
    const holder = createPlainNode(doc);
    const ref = createReference(doc, source.nodeId, holder.occurrenceId);
    const child = createPlainNode(doc, source.occurrenceId);
    doc.replaceDeltas(source.occurrenceId, [{ insert: "source" }]);
    doc.replaceDeltas(child.occurrenceId, [{ insert: "child" }]);

    const clone = cloneOccurrence(doc, ref.occurrenceId, holder.occurrenceId);
    doc.replaceDeltas(clone.occurrenceId, [{ insert: "clone" }]);

    expect(clone.nodeId).not.toBe(source.nodeId);
    expect(doc.getOccurrence(source.occurrenceId)?.deltas).toEqual([{ insert: "source" }]);
    expect(doc.getOccurrence(clone.occurrenceId)?.deltas).toEqual([{ insert: "clone" }]);
    expect(getSemanticChildren(doc, clone.occurrenceId).map((node) => node.deltas)).toEqual([
      [{ insert: "child" }],
    ]);
  });

  it("removes a non-canonical occurrence without deleting the entity", () => {
    const doc = new Engine();
    const source = createPlainNode(doc);
    const holder = createPlainNode(doc);
    const ref = createReference(doc, source.nodeId, holder.occurrenceId);

    removeOccurrenceOrHardDelete(doc, ref.occurrenceId);

    expect(doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(doc.getOccurrence(source.occurrenceId)?.nodeId).toBe(source.nodeId);
  });

  it("removes physical children before removing a non-canonical occurrence", () => {
    const doc = new Engine();
    const source = createPlainNode(doc);
    const holder = createPlainNode(doc);
    const ref = createReference(doc, source.nodeId, holder.occurrenceId);
    const refChild = doc.createNode(ref.occurrenceId);

    removeOccurrenceOrHardDelete(doc, ref.occurrenceId);

    expect(doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(doc.getOccurrence(refChild.occurrenceId)).toBeUndefined();
    expect(() => doc.getCanonicalOccurrenceId(refChild.nodeId)).toThrow(/Node entity not found/);
    expect(doc.getOccurrence(source.occurrenceId)?.nodeId).toBe(source.nodeId);
  });

  it("hard deletes semantic child subtrees recursively", () => {
    const doc = new Engine();
    const source = createPlainNode(doc);
    const child = createPlainNode(doc, source.occurrenceId);
    const grandchild = createPlainNode(doc, child.occurrenceId);
    const holder = createPlainNode(doc);
    const childRef = createReference(doc, child.nodeId, holder.occurrenceId);

    hardDeleteNode(doc, source.nodeId);

    expect(doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(doc.getOccurrence(child.occurrenceId)).toBeUndefined();
    expect(doc.getOccurrence(grandchild.occurrenceId)).toBeUndefined();
    expect(doc.getOccurrence(childRef.occurrenceId)).toBeUndefined();
  });

  it("hard deletes physical children under every occurrence before deleting the entity", () => {
    const doc = new Engine();
    const source = createPlainNode(doc);
    const holder = createPlainNode(doc);
    const ref = createReference(doc, source.nodeId, holder.occurrenceId);
    const refChild = doc.createNode(ref.occurrenceId);

    hardDeleteNode(doc, source.nodeId);

    expect(doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(doc.getOccurrence(refChild.occurrenceId)).toBeUndefined();
    expect(() => doc.getCanonicalOccurrenceId(refChild.nodeId)).toThrow(/Node entity not found/);
  });

  it("hard deletes a node when removing its canonical occurrence", () => {
    const doc = new Engine();
    const source = createPlainNode(doc);
    const child = createPlainNode(doc, source.occurrenceId);

    removeOccurrenceOrHardDelete(doc, source.occurrenceId);

    expect(doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(doc.getOccurrence(child.occurrenceId)).toBeUndefined();
  });
});
