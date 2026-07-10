import type { Engine, NodeOccurrence } from "../../core/index.js";
import type { DomainChange } from "../model/changes.js";
import { ManagedKind } from "../model/managed-child.js";
import { isActiveManagedChild, managedKindValue } from "../managed/managed-child-state.js";
import { isField } from "../system-entity.js";
import { getSemanticChildren, removeOccurrenceOrHardDelete } from "../node/node.js";
import { applyDesiredManagedChildren } from "./schema-reconcile-apply.js";
import { collectDesiredManagedChildren } from "./schema-reconcile-desired.js";
import { reorderTargetChildren, trimStaleManagedProvenance } from "./schema-reconcile-order.js";
import { requireCanonicalOccurrence } from "../lookup.js";

export async function reconcileTargetSchemas(
  engine: Engine,
  targetOccurrenceId: string,
): Promise<DomainChange[]> {
  const target = await requireCanonicalOccurrence(engine, targetOccurrenceId);
  const desired = await collectDesiredManagedChildren(engine, target);
  const applied = await applyDesiredManagedChildren(engine, target, desired);
  const changes = [...applied.changes];

  changes.push(
    ...(await trimStaleManagedProvenance(engine, target, applied.assignedProvenanceByOccurrence)),
  );
  changes.push(...(await reorderTargetChildren(engine, target, applied.managedOrder)));

  return changes;
}

export async function cleanupInactiveManagedChildren(
  engine: Engine,
  targetOccurrenceId: string,
): Promise<DomainChange[]> {
  const target = await engine.mustGetOccurrence(targetOccurrenceId);
  const changes: DomainChange[] = [];

  for (const child of await engine.getOccurrenceChildren(targetOccurrenceId)) {
    if (await isActiveManagedChild(engine, target, child)) {
      continue;
    }
    const managedKind = managedKindValue(engine, child);
    if (!managedKind) {
      continue;
    }

    if (managedKind === ManagedKind.FieldSlot && (await isField(engine, child))) {
      changes.push(await cleanupInactiveFieldSlot(engine, child));
      continue;
    }

    changes.push({
      kind: ManagedKind.TemplateRef,
      reason: "kept",
      nodeId: child.nodeId,
      occurrenceId: child.occurrenceId,
    });
  }

  return changes;
}

async function cleanupInactiveFieldSlot(
  engine: Engine,
  child: NodeOccurrence,
): Promise<DomainChange> {
  const hasValues = (await getSemanticChildren(engine, child.occurrenceId)).length > 0;
  if (hasValues) {
    return {
      kind: ManagedKind.FieldSlot,
      reason: "kept",
      nodeId: child.nodeId,
      occurrenceId: child.occurrenceId,
    };
  }
  await removeOccurrenceOrHardDelete(engine, child.occurrenceId);
  return {
    kind: ManagedKind.FieldSlot,
    reason: "deleted",
    nodeId: child.nodeId,
    occurrenceId: child.occurrenceId,
  };
}
