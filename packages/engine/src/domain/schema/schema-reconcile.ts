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
  doc: Engine,
  targetOccurrenceId: string,
): Promise<DomainChange[]> {
  const target = await requireCanonicalOccurrence(doc, targetOccurrenceId);
  const desired = await collectDesiredManagedChildren(doc, target);
  const applied = await applyDesiredManagedChildren(doc, target, desired);
  const changes = [...applied.changes];

  changes.push(
    ...(await trimStaleManagedProvenance(doc, target, applied.assignedProvenanceByOccurrence)),
  );
  changes.push(...(await reorderTargetChildren(doc, target, applied.managedOrder)));

  return changes;
}

export async function cleanupInactiveManagedChildren(
  doc: Engine,
  targetOccurrenceId: string,
): Promise<DomainChange[]> {
  const target = await doc.mustGetOccurrence(targetOccurrenceId);
  const changes: DomainChange[] = [];

  for (const child of await doc.getOccurrenceChildren(targetOccurrenceId)) {
    if (await isActiveManagedChild(doc, target, child)) {
      continue;
    }
    const managedKind = managedKindValue(doc, child);
    if (!managedKind) {
      continue;
    }

    if (managedKind === ManagedKind.FieldSlot && (await isField(doc, child))) {
      changes.push(await cleanupInactiveFieldSlot(doc, child));
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

async function cleanupInactiveFieldSlot(doc: Engine, child: NodeOccurrence): Promise<DomainChange> {
  const hasValues = (await getSemanticChildren(doc, child.occurrenceId)).length > 0;
  if (hasValues) {
    return {
      kind: ManagedKind.FieldSlot,
      reason: "kept",
      nodeId: child.nodeId,
      occurrenceId: child.occurrenceId,
    };
  }
  await removeOccurrenceOrHardDelete(doc, child.occurrenceId);
  return {
    kind: ManagedKind.FieldSlot,
    reason: "deleted",
    nodeId: child.nodeId,
    occurrenceId: child.occurrenceId,
  };
}
