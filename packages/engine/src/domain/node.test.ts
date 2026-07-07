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
  it("creates plain and reference children through the canonical child owner", async () => {
    const doc = new Engine();
    const source = await createPlainNode(doc);
    const holder = await createPlainNode(doc);
    const refParent = await createReference(doc, source.nodeId, holder.occurrenceId);
    const target = await createPlainNode(doc);

    const plainChild = await createPlainNode(doc, refParent.occurrenceId);
    const refChild = await createReference(doc, target.nodeId, refParent.occurrenceId);

    expect((await doc.getOccurrence(plainChild.occurrenceId))?.parentOccurrenceId).toBe(
      source.occurrenceId,
    );
    expect((await doc.getOccurrence(refChild.occurrenceId))?.parentOccurrenceId).toBe(
      source.occurrenceId,
    );
    expect(
      (await getSemanticChildren(doc, source.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([plainChild.occurrenceId, refChild.occurrenceId]);
    expect(
      (await getSemanticChildren(doc, refParent.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([plainChild.occurrenceId, refChild.occurrenceId]);
  });

  it("promotes canonical occurrence and moves semantic children to the new owner", async () => {
    const doc = new Engine();
    const source = await createPlainNode(doc);
    const holder = await createPlainNode(doc);
    const ref = await createReference(doc, source.nodeId, holder.occurrenceId);
    const child = await createPlainNode(doc, source.occurrenceId);

    await promoteCanonicalOccurrence(doc, source.nodeId, ref.occurrenceId);

    expect((await doc.getOccurrence(source.occurrenceId))?.canonicalOccurrenceId).toBe(
      ref.occurrenceId,
    );
    expect(await doc.getOccurrenceChildren(source.occurrenceId)).toEqual([]);
    expect(
      (await doc.getOccurrenceChildren(ref.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([child.occurrenceId]);
    expect(
      (await getSemanticChildren(doc, source.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([child.occurrenceId]);
  });

  it("clones an occurrence into an independent semantic subtree", async () => {
    const doc = new Engine();
    const source = await createPlainNode(doc);
    const holder = await createPlainNode(doc);
    const ref = await createReference(doc, source.nodeId, holder.occurrenceId);
    const child = await createPlainNode(doc, source.occurrenceId);
    await doc.replaceDeltas(source.occurrenceId, [{ insert: "source" }]);
    await doc.replaceDeltas(child.occurrenceId, [{ insert: "child" }]);

    const clone = await cloneOccurrence(doc, ref.occurrenceId, holder.occurrenceId);
    await doc.replaceDeltas(clone.occurrenceId, [{ insert: "clone" }]);

    expect(clone.nodeId).not.toBe(source.nodeId);
    expect((await doc.getOccurrence(source.occurrenceId))?.deltas).toEqual([{ insert: "source" }]);
    expect((await doc.getOccurrence(clone.occurrenceId))?.deltas).toEqual([{ insert: "clone" }]);
    expect((await getSemanticChildren(doc, clone.occurrenceId)).map((node) => node.deltas)).toEqual(
      [[{ insert: "child" }]],
    );
  });

  it("removes a non-canonical occurrence without deleting the entity", async () => {
    const doc = new Engine();
    const source = await createPlainNode(doc);
    const holder = await createPlainNode(doc);
    const ref = await createReference(doc, source.nodeId, holder.occurrenceId);

    await removeOccurrenceOrHardDelete(doc, ref.occurrenceId);

    expect(await doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect((await doc.getOccurrence(source.occurrenceId))?.nodeId).toBe(source.nodeId);
  });

  it("removes physical children before removing a non-canonical occurrence", async () => {
    const doc = new Engine();
    const source = await createPlainNode(doc);
    const holder = await createPlainNode(doc);
    const ref = await createReference(doc, source.nodeId, holder.occurrenceId);
    const refChild = await doc.createNode(ref.occurrenceId);

    await removeOccurrenceOrHardDelete(doc, ref.occurrenceId);

    expect(await doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(refChild.occurrenceId)).toBeUndefined();
    await expect(doc.getCanonicalOccurrenceId(refChild.nodeId)).rejects.toThrow(
      /Node entity not found/,
    );
    expect((await doc.getOccurrence(source.occurrenceId))?.nodeId).toBe(source.nodeId);
  });

  it("hard deletes semantic child subtrees recursively", async () => {
    const doc = new Engine();
    const source = await createPlainNode(doc);
    const child = await createPlainNode(doc, source.occurrenceId);
    const grandchild = await createPlainNode(doc, child.occurrenceId);
    const holder = await createPlainNode(doc);
    const childRef = await createReference(doc, child.nodeId, holder.occurrenceId);

    await hardDeleteNode(doc, source.nodeId);

    expect(await doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(child.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(grandchild.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(childRef.occurrenceId)).toBeUndefined();
  });

  it("hard deletes physical children under every occurrence before deleting the entity", async () => {
    const doc = new Engine();
    const source = await createPlainNode(doc);
    const holder = await createPlainNode(doc);
    const ref = await createReference(doc, source.nodeId, holder.occurrenceId);
    const refChild = await doc.createNode(ref.occurrenceId);

    await hardDeleteNode(doc, source.nodeId);

    expect(await doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(refChild.occurrenceId)).toBeUndefined();
    await expect(doc.getCanonicalOccurrenceId(refChild.nodeId)).rejects.toThrow(
      /Node entity not found/,
    );
  });

  it("hard deletes a node when removing its canonical occurrence", async () => {
    const doc = new Engine();
    const source = await createPlainNode(doc);
    const child = await createPlainNode(doc, source.occurrenceId);

    await removeOccurrenceOrHardDelete(doc, source.occurrenceId);

    expect(await doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(child.occurrenceId)).toBeUndefined();
  });
});
