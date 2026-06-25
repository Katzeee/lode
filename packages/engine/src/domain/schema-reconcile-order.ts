import type { Engine, NodeOccurrence } from "../core/index.js";
import type { DomainChange } from "./changes.js";
import {
  type SchemaProvenance,
  isActiveManagedChild,
  readManagedChildState,
  requireManagedKind,
  writeManagedProvenance,
} from "./managed-child-state.js";
import { readSchemaIds } from "./schema-membership.js";
import { moveOccurrence } from "./node.js";
import { isSameProvenance } from "./schema-reconcile-model.js";

export function reorderTargetChildren(
  doc: Engine,
  target: NodeOccurrence,
  managedOrder: string[],
): DomainChange[] {
  const changes: DomainChange[] = [];
  const placementChildren = doc.getOccurrenceChildren(target.occurrenceId);
  const managedOrderSet = new Set(managedOrder);
  const activeManagedRemainder = placementChildren
    .filter(
      (child) =>
        !managedOrderSet.has(child.occurrenceId) && isActiveManagedChild(doc, target, child),
    )
    .map((child) => child.occurrenceId);
  const managedAll = [...managedOrder, ...activeManagedRemainder];
  const managedAllSet = new Set(managedAll);
  const unmanaged = placementChildren
    .filter((child) => !managedAllSet.has(child.occurrenceId))
    .map((child) => child.occurrenceId);
  const finalOrder = [...managedAll, ...unmanaged];

  for (const [index, occurrenceId] of finalOrder.entries()) {
    const current = doc.getOccurrenceChildren(target.occurrenceId);
    const atIndex = current[index];
    if (!atIndex || atIndex.occurrenceId === occurrenceId) {
      continue;
    }
    moveOccurrence(doc, occurrenceId, target.occurrenceId, index);
    const moved = doc.mustGetOccurrence(occurrenceId);
    changes.push({
      kind: managedAllSet.has(occurrenceId) ? requireManagedKind(doc, moved) : "templateRef",
      reason: "moved",
      nodeId: moved.nodeId,
      occurrenceId: moved.occurrenceId,
    });
  }

  return changes;
}

export function trimStaleManagedProvenance(
  doc: Engine,
  target: NodeOccurrence,
  assignedProvenanceByOccurrence: Map<string, SchemaProvenance[]>,
): DomainChange[] {
  const activeSchemaIds = new Set(readSchemaIds(doc, target.occurrenceId));
  const changes: DomainChange[] = [];

  for (const child of doc.getOccurrenceChildren(target.occurrenceId)) {
    const managed = readManagedChildState(doc, child.occurrenceId);
    const managedKind = managed.status === "valid" ? managed.kind : null;
    if (!managedKind) {
      continue;
    }
    const current = managed.status === "valid" ? managed.provenance : [];
    const assigned = assignedProvenanceByOccurrence.get(child.occurrenceId);
    const next = assigned
      ? assigned.map((entry) => ({ ...entry }))
      : current.filter((entry) => !activeSchemaIds.has(entry.schemaId));
    if (!isSameProvenance(current, next)) {
      writeManagedProvenance(doc, child.occurrenceId, next);
      changes.push({
        kind: managedKind,
        reason: "provenanceUpdated",
        nodeId: child.nodeId,
        occurrenceId: child.occurrenceId,
      });
    }
  }

  return changes;
}
