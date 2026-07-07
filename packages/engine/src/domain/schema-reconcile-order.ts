import type { Engine, NodeOccurrence } from "../core/index.js";
import type { DomainChange } from "./model/changes.js";
import type { SchemaProvenance } from "./model/managed-child.js";
import {
  isActiveManagedChild,
  readManagedChildState,
  requireManagedKind,
  writeManagedProvenance,
} from "./managed-child-state.js";
import { readSchemaIds } from "./schema-membership.js";
import { moveOccurrence } from "./node.js";
import { isSameProvenance } from "./model/reconcile.js";

export async function reorderTargetChildren(
  doc: Engine,
  target: NodeOccurrence,
  managedOrder: string[],
): Promise<DomainChange[]> {
  const changes: DomainChange[] = [];
  const placementChildren = await doc.getOccurrenceChildren(target.occurrenceId);
  const managedOrderSet = new Set(managedOrder);
  // Async predicate (isActiveManagedChild faults a shard) — gather sequentially.
  const activeManagedRemainder: string[] = [];
  for (const child of placementChildren) {
    if (
      !managedOrderSet.has(child.occurrenceId) &&
      (await isActiveManagedChild(doc, target, child))
    ) {
      activeManagedRemainder.push(child.occurrenceId);
    }
  }
  const managedAll = [...managedOrder, ...activeManagedRemainder];
  const managedAllSet = new Set(managedAll);
  const unmanaged = placementChildren
    .filter((child) => !managedAllSet.has(child.occurrenceId))
    .map((child) => child.occurrenceId);
  const finalOrder = [...managedAll, ...unmanaged];

  for (const [index, occurrenceId] of finalOrder.entries()) {
    const current = await doc.getOccurrenceChildren(target.occurrenceId);
    const atIndex = current[index];
    if (!atIndex || atIndex.occurrenceId === occurrenceId) {
      continue;
    }
    await moveOccurrence(doc, occurrenceId, target.occurrenceId, index);
    const moved = await doc.mustGetOccurrence(occurrenceId);
    changes.push({
      kind: managedAllSet.has(occurrenceId) ? requireManagedKind(doc, moved) : "templateRef",
      reason: "moved",
      nodeId: moved.nodeId,
      occurrenceId: moved.occurrenceId,
    });
  }

  return changes;
}

export async function trimStaleManagedProvenance(
  doc: Engine,
  target: NodeOccurrence,
  assignedProvenanceByOccurrence: Map<string, SchemaProvenance[]>,
): Promise<DomainChange[]> {
  const activeSchemaIds = new Set(await readSchemaIds(doc, target.occurrenceId));
  const changes: DomainChange[] = [];

  for (const child of await doc.getOccurrenceChildren(target.occurrenceId)) {
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
      await writeManagedProvenance(doc, child.occurrenceId, next);
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
