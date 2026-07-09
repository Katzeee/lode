import type { Engine, NodeOccurrence } from "../../core/index.js";
import { invalidDomainInput } from "../errors.js";
import { requireOccurrence } from "../lookup.js";
import { isActiveManagedChild } from "./managed-child-state.js";
import { isFieldDef, readFieldDefId, readFieldDefPresence } from "../system-entity.js";

export async function assertNotActiveManagedChild(
  doc: Engine,
  occurrenceId: string,
): Promise<void> {
  const child = await requireOccurrence(doc, occurrenceId);
  if (!child.parentOccurrenceId) {
    return;
  }
  const parent = await doc.getOccurrence(child.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if (await isActiveManagedChild(doc, parent, child)) {
    throwActiveManagedChild(occurrenceId, parent.occurrenceId);
  }
}

export async function assertFieldRemoveAllowed(doc: Engine, field: NodeOccurrence): Promise<void> {
  if (!field.parentOccurrenceId) {
    return;
  }
  const parent = await doc.getOccurrence(field.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if (!(await isActiveManagedChild(doc, parent, field)) || !(await isNormalFieldSlot(doc, field))) {
    return;
  }
  throwActiveManagedChild(field.occurrenceId, parent.occurrenceId);
}

async function isNormalFieldSlot(doc: Engine, field: NodeOccurrence): Promise<boolean> {
  const fieldDefNodeId = await readFieldDefId(doc, field);
  if (!fieldDefNodeId) {
    return false;
  }
  let fieldDefOccurrenceId: string;
  try {
    fieldDefOccurrenceId = await doc.getCanonicalOccurrenceId(fieldDefNodeId);
  } catch {
    return false;
  }
  const fieldDef = await doc.getOccurrence(fieldDefOccurrenceId);
  if (!fieldDef || !(await isFieldDef(doc, fieldDef))) {
    return false;
  }
  return (await readFieldDefPresence(doc, fieldDef.occurrenceId)) !== "optional";
}

function throwActiveManagedChild(occurrenceId: string, parentOccurrenceId: string): never {
  invalidDomainInput(`Cannot mutate active managed child: ${occurrenceId} (active_managed_child)`, {
    reason: "active_managed_child",
    occurrenceId,
    parentOccurrenceId,
  });
}
