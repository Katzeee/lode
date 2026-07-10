import { describe, expect, it } from "vitest";
import { Engine } from "../../core/engine.js";
import { SystemEntityMeta, SystemKind } from "../bundle/system-schema.js";
import { createFieldDef } from "../field/field.js";
import {
  createPlainNode,
  createReference,
  createWorkspaceRoot,
  getSemanticChildren,
  hardDeleteNode,
  moveOccurrence,
  removeOccurrence,
  removeOccurrenceOrHardDelete,
} from "./node.js";
import { applySchema, createSchema } from "../schema/schema.js";

/**
 * Guards live on the domain primitives, not the RPC handlers — so every caller hits them, not just
 * the two services handlers that used to. These cases drive the primitives directly (the
 * domain-composition / editing / cascade paths an internal caller takes), proving the managed-child
 * and protected-node guards fire without going through RPC. The RPC-path equivalent is covered by
 * the daemon `schema-field` integration test.
 */

/** Build a engine with one active managed child: a normal field slot a schema applied to `target`
 *  creates. Mirrors the daemon `schema-field` "protects active managed children" setup. */
async function docWithManagedChild(): Promise<{
  engine: Engine;
  slot: { nodeId: string; occurrenceId: string };
  other: { occurrenceId: string };
}> {
  const engine = new Engine();
  const root = await createWorkspaceRoot(engine);
  const schema = await createSchema(engine, "S", root.occurrenceId);
  const defs = await createPlainNode(engine, root.occurrenceId);
  const fieldDef = await createFieldDef(engine, defs.occurrenceId, "F", "plain", "normal");
  await createReference(engine, fieldDef.nodeId, schema.occurrenceId);
  const target = await createPlainNode(engine, root.occurrenceId);
  await applySchema(engine, target.occurrenceId, schema.nodeId);
  const slot = (await getSemanticChildren(engine, target.occurrenceId))[0];
  if (slot === undefined) {
    throw new Error("setup failed: schema apply did not create a managed field slot");
  }
  const other = await createPlainNode(engine, root.occurrenceId);
  return { engine, slot, other };
}

describe("domain primitives carry managed-child / hard-delete guards (non-RPC paths)", () => {
  it("moveOccurrence rejects an active managed child (the indent/outdent/editing path)", async () => {
    const { engine, slot, other } = await docWithManagedChild();
    await expect(moveOccurrence(engine, slot.occurrenceId, other.occurrenceId)).rejects.toThrow(
      "active_managed_child",
    );
  });

  it("removeOccurrence rejects an active managed child", async () => {
    const { engine, slot } = await docWithManagedChild();
    await expect(removeOccurrence(engine, slot.occurrenceId)).rejects.toThrow(
      "active_managed_child",
    );
  });

  it("removeOccurrenceOrHardDelete rejects an active managed child (cascade path)", async () => {
    const { engine, slot } = await docWithManagedChild();
    await expect(removeOccurrenceOrHardDelete(engine, slot.occurrenceId)).rejects.toThrow(
      "active_managed_child",
    );
  });

  it("hardDeleteNode rejects a protected managed node (cascade path)", async () => {
    const { engine, slot } = await docWithManagedChild();
    await expect(hardDeleteNode(engine, slot.nodeId)).rejects.toThrow("protected_node_hard_delete");
  });

  it("a plain (non-managed) node passes through the guards untouched", async () => {
    const engine = new Engine();
    const root = await createWorkspaceRoot(engine);
    const parent = await createPlainNode(engine, root.occurrenceId);
    const child = await createPlainNode(engine, parent.occurrenceId);
    const other = await createPlainNode(engine, root.occurrenceId);
    await moveOccurrence(engine, child.occurrenceId, other.occurrenceId);
    expect((await engine.getOccurrence(child.occurrenceId))?.parentOccurrenceId).toBe(
      other.occurrenceId,
    );
    await removeOccurrenceOrHardDelete(engine, child.occurrenceId);
    expect(await engine.getOccurrence(child.occurrenceId)).toBeUndefined();
  });

  it("hardDeleteNode catches a protected node under a non-canonical occurrence (one closure)", async () => {
    // The guard must walk the SAME closure the cascade removes. A protected entity physically
    // parented under a non-canonical occurrence is in that closure but outside the canonical
    // subtree — a canonical-only guard walk would miss it and let the cascade delete it.
    const engine = new Engine();
    const root = await createWorkspaceRoot(engine);
    const source = await createPlainNode(engine, root.occurrenceId);
    const holder = await createPlainNode(engine, root.occurrenceId);
    const ref = await createReference(engine, source.nodeId, holder.occurrenceId); // non-canonical
    // Attach a protected entity directly under the non-canonical occurrence (bypasses the
    // canonicalization createPlainNode does, so it sits in ref's subtree, not source's).
    const hidden = await engine.createNode(ref.occurrenceId);
    await engine.setEntityMeta(hidden.occurrenceId, SystemEntityMeta.SystemKind, SystemKind.Schema);

    await expect(hardDeleteNode(engine, source.nodeId)).rejects.toThrow(
      "protected_node_hard_delete",
    );
    // The guard fired before apply, so nothing was removed.
    expect(await engine.getOccurrence(source.occurrenceId)).toBeDefined();
    expect(await engine.getOccurrence(hidden.occurrenceId)).toBeDefined();
  });
});
