import type { Engine, NodeOccurrence } from "../../core/index.js";
import { invalidDomainInput } from "../errors.js";
import { requireOccurrence } from "../lookup.js";
import { isActiveManagedChild } from "./managed-child-state.js";
import { isFieldDef, readFieldDefId, readFieldDefPresence } from "../system-entity.js";

export async function assertNotActiveManagedChild(
  engine: Engine,
  occurrenceId: string,
): Promise<void> {
  const child = await requireOccurrence(engine, occurrenceId);
  if (!child.parentOccurrenceId) {
    return;
  }
  const parent = await engine.getOccurrence(child.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if (await isActiveManagedChild(engine, parent, child)) {
    throwActiveManagedChild(occurrenceId, parent.occurrenceId);
  }
}

export async function assertFieldRemoveAllowed(
  engine: Engine,
  field: NodeOccurrence,
): Promise<void> {
  if (!field.parentOccurrenceId) {
    return;
  }
  const parent = await engine.getOccurrence(field.parentOccurrenceId);
  if (!parent) {
    return;
  }
  if (
    !(await isActiveManagedChild(engine, parent, field)) ||
    !(await isNormalFieldSlot(engine, field))
  ) {
    return;
  }
  throwActiveManagedChild(field.occurrenceId, parent.occurrenceId);
}

async function isNormalFieldSlot(engine: Engine, field: NodeOccurrence): Promise<boolean> {
  const fieldDefNodeId = await readFieldDefId(engine, field);
  if (!fieldDefNodeId) {
    return false;
  }
  let fieldDefOccurrenceId: string;
  try {
    fieldDefOccurrenceId = await engine.getCanonicalOccurrenceId(fieldDefNodeId);
  } catch {
    return false;
  }
  const fieldDef = await engine.getOccurrence(fieldDefOccurrenceId);
  if (!fieldDef || !(await isFieldDef(engine, fieldDef))) {
    return false;
  }
  return (await readFieldDefPresence(engine, fieldDef.occurrenceId)) !== "optional";
}

function throwActiveManagedChild(occurrenceId: string, parentOccurrenceId: string): never {
  invalidDomainInput(`Cannot mutate active managed child: ${occurrenceId} (active_managed_child)`, {
    reason: "active_managed_child",
    occurrenceId,
    parentOccurrenceId,
  });
}
