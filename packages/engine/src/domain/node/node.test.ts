import { describe, expect, it } from "vitest";
import { Engine } from "../../core/engine.js";
import { NotFoundError } from "../../errors.js";
import {
  cloneOccurrence,
  createPlainNode,
  createReference,
  createWorkspaceRoot,
  getSemanticChildren,
  hardDeleteNode,
  moveOccurrence,
  promoteCanonicalOccurrence,
  removeOccurrenceOrHardDelete,
} from "./node.js";

describe("domain node semantics", () => {
  it("creates plain and reference children through the canonical child owner", async () => {
    const doc = new Engine();
    const source = await doc.createNode(null);
    const holder = await doc.createNode(null);
    const refParent = await createReference(doc, source.nodeId, holder.occurrenceId);
    const target = await doc.createNode(null);

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
    const source = await doc.createNode(null);
    const holder = await doc.createNode(null);
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
    const source = await doc.createNode(null);
    const holder = await doc.createNode(null);
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
    const source = await doc.createNode(null);
    const holder = await doc.createNode(null);
    const ref = await createReference(doc, source.nodeId, holder.occurrenceId);

    await removeOccurrenceOrHardDelete(doc, ref.occurrenceId);

    expect(await doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect((await doc.getOccurrence(source.occurrenceId))?.nodeId).toBe(source.nodeId);
  });

  it("removes physical children before removing a non-canonical occurrence", async () => {
    const doc = new Engine();
    const source = await doc.createNode(null);
    const holder = await doc.createNode(null);
    const ref = await createReference(doc, source.nodeId, holder.occurrenceId);
    const refChild = await doc.createNode(ref.occurrenceId);

    await removeOccurrenceOrHardDelete(doc, ref.occurrenceId);

    expect(await doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(refChild.occurrenceId)).toBeUndefined();
    const lookup = doc.getCanonicalOccurrenceId(refChild.nodeId);
    await expect(lookup).rejects.toBeInstanceOf(NotFoundError);
    await expect(lookup).rejects.toHaveProperty("kind", "entity");
    expect((await doc.getOccurrence(source.occurrenceId))?.nodeId).toBe(source.nodeId);
  });

  it("hard deletes semantic child subtrees recursively", async () => {
    const doc = new Engine();
    const source = await doc.createNode(null);
    const child = await createPlainNode(doc, source.occurrenceId);
    const grandchild = await createPlainNode(doc, child.occurrenceId);
    const holder = await doc.createNode(null);
    const childRef = await createReference(doc, child.nodeId, holder.occurrenceId);

    await hardDeleteNode(doc, source.nodeId);

    expect(await doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(child.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(grandchild.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(childRef.occurrenceId)).toBeUndefined();
  });

  it("hard deletes physical children under every occurrence before deleting the entity", async () => {
    const doc = new Engine();
    const source = await doc.createNode(null);
    const holder = await doc.createNode(null);
    const ref = await createReference(doc, source.nodeId, holder.occurrenceId);
    const refChild = await doc.createNode(ref.occurrenceId);

    await hardDeleteNode(doc, source.nodeId);

    expect(await doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(refChild.occurrenceId)).toBeUndefined();
    const lookup = doc.getCanonicalOccurrenceId(refChild.nodeId);
    await expect(lookup).rejects.toBeInstanceOf(NotFoundError);
    await expect(lookup).rejects.toHaveProperty("kind", "entity");
  });

  it("hard deletes a node when removing its canonical occurrence", async () => {
    const doc = new Engine();
    const source = await doc.createNode(null);
    const child = await createPlainNode(doc, source.occurrenceId);

    await removeOccurrenceOrHardDelete(doc, source.occurrenceId);

    expect(await doc.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await doc.getOccurrence(child.occurrenceId)).toBeUndefined();
  });
});

describe("createWorkspaceRoot: the single rooting entry", () => {
  it("plants the one root and is idempotent (a second call returns it unchanged)", async () => {
    const doc = new Engine();
    const first = await createWorkspaceRoot(doc, "WS");
    expect((await doc.getRootOccurrences()).map((root) => root.occurrenceId)).toEqual([
      first.occurrenceId,
    ]);

    const second = await createWorkspaceRoot(doc, "ignored");
    expect(second.occurrenceId).toBe(first.occurrenceId);
    expect(await doc.getRootOccurrences()).toHaveLength(1);
    // Idempotent: the displayName is not overwritten on the no-op re-root.
    expect((await doc.getOccurrence(first.occurrenceId))?.deltas).toEqual([{ insert: "WS" }]);
  });

  it("rejects an empty parent at the shared resolver (parent_required)", async () => {
    const doc = new Engine();
    const root = await createWorkspaceRoot(doc);
    const child = await createPlainNode(doc, root.occurrenceId);
    // Every creator + move funnels through canonicalChildOwnerOf, which rejects an empty parent
    // (a client sending no parent over the wire) as an invalid argument, not a not-found.
    await expect(createPlainNode(doc, "")).rejects.toThrow("parent_required");
    await expect(moveOccurrence(doc, child.occurrenceId, "")).rejects.toThrow("parent_required");
  });
});
