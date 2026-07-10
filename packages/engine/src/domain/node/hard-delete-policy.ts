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
export async function authorizeHardDelete(engine: Engine, removed: Set<string>): Promise<void> {
  for (const occId of removed) {
    const occ = await engine.getOccurrence(occId);
    if (occ) {
      await assertOccurrenceHardDeleteAllowed(engine, occ);
    }
  }
}

async function assertOccurrenceHardDeleteAllowed(
  engine: Engine,
  occurrence: NodeOccurrence,
): Promise<void> {
  if (
    (await isSystemEntity(engine, occurrence)) ||
    (await readSchemaIds(engine, occurrence.occurrenceId)).length > 0
  ) {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }

  const managed = readManagedChildState(engine, occurrence.occurrenceId);
  if (managed.status !== "none") {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }

  if (!occurrence.parentOccurrenceId) {
    return;
  }
  const parent = await engine.getOccurrence(occurrence.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if (
    (await isSchema(engine, parent)) ||
    (await isActiveManagedChild(engine, parent, occurrence))
  ) {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }
}

async function isSystemEntity(engine: Engine, node: NodeOccurrence): Promise<boolean> {
  return (
    (await isSchema(engine, node)) ||
    (await isFieldDef(engine, node)) ||
    (await isField(engine, node))
  );
}

function throwProtectedHardDelete(nodeId: string, occurrenceId: string): never {
  invalidDomainInput(`Cannot hard delete protected node: ${nodeId} (protected_node_hard_delete)`, {
    reason: "protected_node_hard_delete",
    nodeId,
    occurrenceId,
  });
}
