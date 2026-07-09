import type { Engine, NodeOccurrence } from "../../core/index.js";
import { invalidDomainInput } from "../errors.js";
import { isActiveManagedChild, readManagedChildState } from "../managed/managed-child-state.js";
import { readSchemaIds } from "../schema/schema-membership.js";
import { isField, isFieldDef, isSchema } from "../system-entity.js";

/** Authorize a hard-delete against the exact closure the core cascade will remove — guard and
 *  delete share one traversal, so there is no second closure that could diverge. Every occurrence
 *  in the closure is checked, so a protected entity anywhere in it — including one nested under a
 *  non-canonical occurrence, which a canonical-only walk would miss — is caught before any
 *  mutation. */
export async function authorizeHardDelete(doc: Engine, removed: Set<string>): Promise<void> {
  for (const occId of removed) {
    const occ = await doc.getOccurrence(occId);
    if (occ) {
      await assertOccurrenceHardDeleteAllowed(doc, occ);
    }
  }
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
