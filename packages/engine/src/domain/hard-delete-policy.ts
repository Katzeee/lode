import type { Engine, NodeOccurrence } from "../core/index.js";
import { invalidDomainInput } from "./errors.js";
import { requireNodeById } from "./lookup.js";
import { isActiveManagedChild, readManagedChildState } from "./managed-child-state.js";
import { readSchemaIds } from "./schema-membership.js";
import { isField, isFieldDef, isSchema } from "./system-entity.js";

export function assertNodeHardDeleteAllowed(doc: Engine, nodeId: string): void {
  const canonical = requireNodeById(doc, nodeId);
  assertOccurrenceHardDeleteAllowed(doc, canonical);

  for (const occurrence of doc.getOccurrences(nodeId)) {
    assertOccurrenceHardDeleteAllowed(doc, occurrence);
  }

  for (const descendant of collectOccurrenceSubtree(doc, canonical.occurrenceId)) {
    assertOccurrenceHardDeleteAllowed(doc, descendant);
  }
}

function collectOccurrenceSubtree(doc: Engine, occurrenceId: string): NodeOccurrence[] {
  const out: NodeOccurrence[] = [];
  for (const child of doc.getOccurrenceChildren(occurrenceId)) {
    out.push(child);
    out.push(...collectOccurrenceSubtree(doc, child.occurrenceId));
  }
  return out;
}

function assertOccurrenceHardDeleteAllowed(doc: Engine, occurrence: NodeOccurrence): void {
  if (isSystemEntity(doc, occurrence) || readSchemaIds(doc, occurrence.occurrenceId).length > 0) {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }

  const managed = readManagedChildState(doc, occurrence.occurrenceId);
  if (managed.status !== "none") {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }

  if (!occurrence.parentOccurrenceId) {
    return;
  }
  const parent = doc.getOccurrence(occurrence.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if (isSchema(doc, parent) || isActiveManagedChild(doc, parent, occurrence)) {
    throwProtectedHardDelete(occurrence.nodeId, occurrence.occurrenceId);
  }
}

function isSystemEntity(doc: Engine, node: NodeOccurrence): boolean {
  return isSchema(doc, node) || isFieldDef(doc, node) || isField(doc, node);
}

function throwProtectedHardDelete(nodeId: string, occurrenceId: string): never {
  invalidDomainInput(`Cannot hard delete protected node: ${nodeId} (protected_node_hard_delete)`, {
    reason: "protected_node_hard_delete",
    nodeId,
    occurrenceId,
  });
}
