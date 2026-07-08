import { describe, expect, it } from "vitest";
import { Engine } from "../core/engine.js";
import { createFieldDef } from "./field.js";
import {
  createPlainNode,
  createReference,
  getSemanticChildren,
  hardDeleteNode,
  moveOccurrence,
  removeOccurrence,
  removeOccurrenceOrHardDelete,
} from "./node.js";
import { applySchema, createSchema } from "./schema.js";

/**
 * Guards live on the domain primitives, not the RPC handlers — so every caller hits them, not just
 * the two services handlers that used to. These cases drive the primitives directly (the
 * domain-composition / editing / cascade paths an internal caller takes), proving the managed-child
 * and protected-node guards fire without going through RPC. The RPC-path equivalent is covered by
 * the daemon `schema-field` integration test.
 */

/** Build a doc with one active managed child: a normal field slot a schema applied to `target`
 *  creates. Mirrors the daemon `schema-field` "protects active managed children" setup. */
async function docWithManagedChild(): Promise<{
  doc: Engine;
  slot: { nodeId: string; occurrenceId: string };
  other: { occurrenceId: string };
}> {
  const doc = new Engine();
  const schema = await createSchema(doc, "S");
  const defs = await createPlainNode(doc);
  const fieldDef = await createFieldDef(doc, defs.occurrenceId, "F", "plain", "normal");
  await createReference(doc, fieldDef.nodeId, schema.occurrenceId);
  const target = await createPlainNode(doc);
  await applySchema(doc, target.occurrenceId, schema.nodeId);
  const slot = (await getSemanticChildren(doc, target.occurrenceId))[0];
  if (slot === undefined) {
    throw new Error("setup failed: schema apply did not create a managed field slot");
  }
  const other = await createPlainNode(doc);
  return { doc, slot, other };
}

describe("domain primitives carry managed-child / hard-delete guards (non-RPC paths)", () => {
  it("moveOccurrence rejects an active managed child (the indent/outdent/editing path)", async () => {
    const { doc, slot, other } = await docWithManagedChild();
    await expect(moveOccurrence(doc, slot.occurrenceId, other.occurrenceId)).rejects.toThrow(
      "active_managed_child",
    );
  });

  it("removeOccurrence rejects an active managed child", async () => {
    const { doc, slot } = await docWithManagedChild();
    await expect(removeOccurrence(doc, slot.occurrenceId)).rejects.toThrow("active_managed_child");
  });

  it("removeOccurrenceOrHardDelete rejects an active managed child (cascade path)", async () => {
    const { doc, slot } = await docWithManagedChild();
    await expect(removeOccurrenceOrHardDelete(doc, slot.occurrenceId)).rejects.toThrow(
      "active_managed_child",
    );
  });

  it("hardDeleteNode rejects a protected managed node (cascade path)", async () => {
    const { doc, slot } = await docWithManagedChild();
    await expect(hardDeleteNode(doc, slot.nodeId)).rejects.toThrow("protected_node_hard_delete");
  });

  it("a plain (non-managed) node passes through the guards untouched", async () => {
    const doc = new Engine();
    const parent = await createPlainNode(doc);
    const child = await createPlainNode(doc, parent.occurrenceId);
    const other = await createPlainNode(doc);
    await moveOccurrence(doc, child.occurrenceId, other.occurrenceId);
    expect((await doc.getOccurrence(child.occurrenceId))?.parentOccurrenceId).toBe(
      other.occurrenceId,
    );
    await removeOccurrenceOrHardDelete(doc, child.occurrenceId);
    expect(await doc.getOccurrence(child.occurrenceId)).toBeUndefined();
  });
});
