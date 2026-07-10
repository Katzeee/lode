import type { Engine, NodeOccurrence } from "../../core/index.js";
import type { DomainChange } from "../model/changes.js";
import type { SchemaProvenance } from "../model/managed-child.js";
import {
  isActiveManagedChild,
  readManagedChildState,
  requireManagedKind,
  writeManagedProvenance,
} from "../managed/managed-child-state.js";
import { readSchemaIds } from "./schema-membership.js";
import { isSameProvenance } from "../model/reconcile.js";

export async function reorderTargetChildren(
  engine: Engine,
  target: NodeOccurrence,
  managedOrder: string[],
): Promise<DomainChange[]> {
  const changes: DomainChange[] = [];
  const placementChildren = await engine.getOccurrenceChildren(target.occurrenceId);
  const managedOrderSet = new Set(managedOrder);
  // Async predicate (isActiveManagedChild faults a shard) — gather sequentially.
  const activeManagedRemainder: string[] = [];
  for (const child of placementChildren) {
    if (
      !managedOrderSet.has(child.occurrenceId) &&
      (await isActiveManagedChild(engine, target, child))
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
    const current = await engine.getOccurrenceChildren(target.occurrenceId);
    const atIndex = current[index];
    if (!atIndex || atIndex.occurrenceId === occurrenceId) {
      continue;
    }
    // Bare core move (no managed-child guard): reorder is a SYSTEM operation — the schema enforces
    // field order on its own managed children. The product guard `moveOccurrence` would reject moving
    // an active managed child; system reorder is authorized to, like `removeField`'s bare cascade.
    // target is the canonical occurrence, so its id is the direct move parent (no resolution needed).
    // Only managed children ever reach here: `finalOrder`'s unmanaged tail is derived from the current
    // order, so an unmanaged child is always already at its target index and the `continue` above
    // skips it — a moved item is always managed.
    await engine.moveOccurrence(occurrenceId, target.occurrenceId, index);
    const moved = await engine.mustGetOccurrence(occurrenceId);
    changes.push({
      kind: requireManagedKind(engine, moved),
      reason: "moved",
      nodeId: moved.nodeId,
      occurrenceId: moved.occurrenceId,
    });
  }

  return changes;
}

export async function trimStaleManagedProvenance(
  engine: Engine,
  target: NodeOccurrence,
  assignedProvenanceByOccurrence: Map<string, SchemaProvenance[]>,
): Promise<DomainChange[]> {
  const activeSchemaIds = new Set(await readSchemaIds(engine, target.occurrenceId));
  const changes: DomainChange[] = [];

  for (const child of await engine.getOccurrenceChildren(target.occurrenceId)) {
    const managed = readManagedChildState(engine, child.occurrenceId);
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
      await writeManagedProvenance(engine, child.occurrenceId, next);
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
