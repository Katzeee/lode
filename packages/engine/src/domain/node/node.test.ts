import { describe, expect, it } from "vitest";
import { Engine } from "../../core/engine.js";
import { NotFoundError } from "../../errors/index.js";
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
    const engine = new Engine();
    const source = await engine.createNode(null);
    const holder = await engine.createNode(null);
    const refParent = await createReference(engine, source.nodeId, holder.occurrenceId);
    const target = await engine.createNode(null);

    const plainChild = await createPlainNode(engine, refParent.occurrenceId);
    const refChild = await createReference(engine, target.nodeId, refParent.occurrenceId);

    expect((await engine.getOccurrence(plainChild.occurrenceId))?.parentOccurrenceId).toBe(
      source.occurrenceId,
    );
    expect((await engine.getOccurrence(refChild.occurrenceId))?.parentOccurrenceId).toBe(
      source.occurrenceId,
    );
    expect(
      (await getSemanticChildren(engine, source.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([plainChild.occurrenceId, refChild.occurrenceId]);
    expect(
      (await getSemanticChildren(engine, refParent.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([plainChild.occurrenceId, refChild.occurrenceId]);
  });

  it("promotes canonical occurrence and moves semantic children to the new owner", async () => {
    const engine = new Engine();
    const source = await engine.createNode(null);
    const holder = await engine.createNode(null);
    const ref = await createReference(engine, source.nodeId, holder.occurrenceId);
    const child = await createPlainNode(engine, source.occurrenceId);

    await promoteCanonicalOccurrence(engine, source.nodeId, ref.occurrenceId);

    expect((await engine.getOccurrence(source.occurrenceId))?.canonicalOccurrenceId).toBe(
      ref.occurrenceId,
    );
    expect(await engine.getOccurrenceChildren(source.occurrenceId)).toEqual([]);
    expect(
      (await engine.getOccurrenceChildren(ref.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([child.occurrenceId]);
    expect(
      (await getSemanticChildren(engine, source.occurrenceId)).map((node) => node.occurrenceId),
    ).toEqual([child.occurrenceId]);
  });

  it("clones an occurrence into an independent semantic subtree", async () => {
    const engine = new Engine();
    const source = await engine.createNode(null);
    const holder = await engine.createNode(null);
    const ref = await createReference(engine, source.nodeId, holder.occurrenceId);
    const child = await createPlainNode(engine, source.occurrenceId);
    await engine.replaceDeltas(source.occurrenceId, [{ insert: "source" }]);
    await engine.replaceDeltas(child.occurrenceId, [{ insert: "child" }]);

    const clone = await cloneOccurrence(engine, ref.occurrenceId, holder.occurrenceId);
    await engine.replaceDeltas(clone.occurrenceId, [{ insert: "clone" }]);

    expect(clone.nodeId).not.toBe(source.nodeId);
    expect((await engine.getOccurrence(source.occurrenceId))?.deltas).toEqual([
      { insert: "source" },
    ]);
    expect((await engine.getOccurrence(clone.occurrenceId))?.deltas).toEqual([{ insert: "clone" }]);
    expect(
      (await getSemanticChildren(engine, clone.occurrenceId)).map((node) => node.deltas),
    ).toEqual([[{ insert: "child" }]]);
  });

  it("removes a non-canonical occurrence without deleting the entity", async () => {
    const engine = new Engine();
    const source = await engine.createNode(null);
    const holder = await engine.createNode(null);
    const ref = await createReference(engine, source.nodeId, holder.occurrenceId);

    await removeOccurrenceOrHardDelete(engine, ref.occurrenceId);

    expect(await engine.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect((await engine.getOccurrence(source.occurrenceId))?.nodeId).toBe(source.nodeId);
  });

  it("removes physical children before removing a non-canonical occurrence", async () => {
    const engine = new Engine();
    const source = await engine.createNode(null);
    const holder = await engine.createNode(null);
    const ref = await createReference(engine, source.nodeId, holder.occurrenceId);
    const refChild = await engine.createNode(ref.occurrenceId);

    await removeOccurrenceOrHardDelete(engine, ref.occurrenceId);

    expect(await engine.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(await engine.getOccurrence(refChild.occurrenceId)).toBeUndefined();
    const lookup = engine.getCanonicalOccurrenceId(refChild.nodeId);
    await expect(lookup).rejects.toBeInstanceOf(NotFoundError);
    await expect(lookup).rejects.toHaveProperty("kind", "entity");
    expect((await engine.getOccurrence(source.occurrenceId))?.nodeId).toBe(source.nodeId);
  });

  it("hard deletes semantic child subtrees recursively", async () => {
    const engine = new Engine();
    const source = await engine.createNode(null);
    const child = await createPlainNode(engine, source.occurrenceId);
    const grandchild = await createPlainNode(engine, child.occurrenceId);
    const holder = await engine.createNode(null);
    const childRef = await createReference(engine, child.nodeId, holder.occurrenceId);

    await hardDeleteNode(engine, source.nodeId);

    expect(await engine.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await engine.getOccurrence(child.occurrenceId)).toBeUndefined();
    expect(await engine.getOccurrence(grandchild.occurrenceId)).toBeUndefined();
    expect(await engine.getOccurrence(childRef.occurrenceId)).toBeUndefined();
  });

  it("hard deletes physical children under every occurrence before deleting the entity", async () => {
    const engine = new Engine();
    const source = await engine.createNode(null);
    const holder = await engine.createNode(null);
    const ref = await createReference(engine, source.nodeId, holder.occurrenceId);
    const refChild = await engine.createNode(ref.occurrenceId);

    await hardDeleteNode(engine, source.nodeId);

    expect(await engine.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await engine.getOccurrence(ref.occurrenceId)).toBeUndefined();
    expect(await engine.getOccurrence(refChild.occurrenceId)).toBeUndefined();
    const lookup = engine.getCanonicalOccurrenceId(refChild.nodeId);
    await expect(lookup).rejects.toBeInstanceOf(NotFoundError);
    await expect(lookup).rejects.toHaveProperty("kind", "entity");
  });

  it("hard deletes a node when removing its canonical occurrence", async () => {
    const engine = new Engine();
    const source = await engine.createNode(null);
    const child = await createPlainNode(engine, source.occurrenceId);

    await removeOccurrenceOrHardDelete(engine, source.occurrenceId);

    expect(await engine.getOccurrence(source.occurrenceId)).toBeUndefined();
    expect(await engine.getOccurrence(child.occurrenceId)).toBeUndefined();
  });
});

describe("createWorkspaceRoot: the single rooting entry", () => {
  it("plants the one root and is idempotent (a second call returns it unchanged)", async () => {
    const engine = new Engine();
    const first = await createWorkspaceRoot(engine, "WS");
    expect((await engine.getRootOccurrences()).map((root) => root.occurrenceId)).toEqual([
      first.occurrenceId,
    ]);

    const second = await createWorkspaceRoot(engine, "ignored");
    expect(second.occurrenceId).toBe(first.occurrenceId);
    expect(await engine.getRootOccurrences()).toHaveLength(1);
    // Idempotent: the displayName is not overwritten on the no-op re-root.
    expect((await engine.getOccurrence(first.occurrenceId))?.deltas).toEqual([{ insert: "WS" }]);
  });

  it("rejects an empty parent at the shared resolver (parent_required)", async () => {
    const engine = new Engine();
    const root = await createWorkspaceRoot(engine);
    const child = await createPlainNode(engine, root.occurrenceId);
    // Every creator + move funnels through canonicalChildOwnerOf, which rejects an empty parent
    // (a client sending no parent over the wire) as an invalid argument, not a not-found.
    await expect(createPlainNode(engine, "")).rejects.toThrow("parent_required");
    await expect(moveOccurrence(engine, child.occurrenceId, "")).rejects.toThrow("parent_required");
  });
});
