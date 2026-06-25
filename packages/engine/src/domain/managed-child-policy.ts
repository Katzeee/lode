import type { Engine, NodeOccurrence } from "../core/index.js";
import { invalidDomainInput } from "./errors.js";
import { requireOccurrence } from "./lookup.js";
import { isActiveManagedChild } from "./managed-child-state.js";
import { isFieldDef, readFieldDefId, readFieldDefPresence } from "./system-entity.js";

export function assertNotActiveManagedChild(doc: Engine, occurrenceId: string): void {
  const child = requireOccurrence(doc, occurrenceId);
  if (!child.parentOccurrenceId) {
    return;
  }
  const parent = doc.getOccurrence(child.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if (isActiveManagedChild(doc, parent, child)) {
    throwActiveManagedChild(occurrenceId, parent.occurrenceId);
  }
}

export function assertFieldRemoveAllowed(doc: Engine, field: NodeOccurrence): void {
  if (!field.parentOccurrenceId) {
    return;
  }
  const parent = doc.getOccurrence(field.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if (!isActiveManagedChild(doc, parent, field) || !isNormalFieldSlot(doc, field)) {
    return;
  }
  throwActiveManagedChild(field.occurrenceId, parent.occurrenceId);
}

function isNormalFieldSlot(doc: Engine, field: NodeOccurrence): boolean {
  const fieldDefNodeId = readFieldDefId(doc, field);
  if (!fieldDefNodeId) {
    return false;
  }
  let fieldDefOccurrenceId: string;
  try {
    fieldDefOccurrenceId = doc.getCanonicalOccurrenceId(fieldDefNodeId);
  } catch {
    return false;
  }
  const fieldDef = doc.getOccurrence(fieldDefOccurrenceId);
  if (!fieldDef || !isFieldDef(doc, fieldDef)) {
    return false;
  }
  return readFieldDefPresence(doc, fieldDef.occurrenceId) !== "optional";
}

function throwActiveManagedChild(occurrenceId: string, parentOccurrenceId: string): never {
  invalidDomainInput(`Cannot mutate active managed child: ${occurrenceId} (active_managed_child)`, {
    reason: "active_managed_child",
    occurrenceId,
    parentOccurrenceId,
  });
}
