import type { Engine, NodeOccurrence } from "../core/index.js";
import { invalidDomainInput } from "./errors.js";
import { requireNodeById } from "./lookup.js";
import { isActiveManagedChild, readManagedChildState } from "./managed-child-state.js";
import { readSchemaIds } from "./schema-membership.js";
import { isField, isFieldDef, isSchema } from "./system-entity.js";

export async function assertNodeHardDeleteAllowed(doc: Engine, nodeId: string): Promise<void> {
  const canonical = await requireNodeById(doc, nodeId);
  await assertOccurrenceHardDeleteAllowed(doc, canonical);

  for (const occurrence of await doc.getOccurrences(nodeId)) {
    await assertOccurrenceHardDeleteAllowed(doc, occurrence);
  }

  for (const descendant of await collectOccurrenceSubtree(doc, canonical.occurrenceId)) {
    await assertOccurrenceHardDeleteAllowed(doc, descendant);
  }
}

async function collectOccurrenceSubtree(
  doc: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence[]> {
  const out: NodeOccurrence[] = [];
  for (const child of await doc.getOccurrenceChildren(occurrenceId)) {
    out.push(child);
    out.push(...(await collectOccurrenceSubtree(doc, child.occurrenceId)));
  }
  return out;
}

async function assertOccurrenceHardDeleteAllowed(
  doc: Engine,
  occurrence: NodeOccurrence,
): Promise<void> {
  if (
    (await isSystemEntity(doc, occurrence)) ||
    (await readSchemaIds(doc, occurrence.occurrenceId)).length > 0
  ) {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }

  const managed = readManagedChildState(doc, occurrence.occurrenceId);
  if (managed.status !== "none") {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }

  if (!occurrence.parentOccurrenceId) {
    return;
  }
  const parent = await doc.getOccurrence(occurrence.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if ((await isSchema(doc, parent)) || (await isActiveManagedChild(doc, parent, occurrence))) {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }
}

async function isSystemEntity(doc: Engine, node: NodeOccurrence): Promise<boolean> {
  return (await isSchema(doc, node)) || (await isFieldDef(doc, node)) || (await isField(doc, node));
}

function throwProtectedHardDelete(nodeId: string, occurrenceId: string): never {
  invalidDomainInput(`Cannot hard delete protected node: ${nodeId} (protected_node_hard_delete)`, {
    reason: "protected_node_hard_delete",
    nodeId,
    occurrenceId,
  });
}
