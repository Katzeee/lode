import type { Engine, NodeOccurrence } from "../core/index.js";
import type { DomainChange } from "./model/changes.js";
import { ManagedKind } from "./model/managed-child.js";
import { isActiveManagedChild, managedKindValue } from "./managed-child-state.js";
import { isField } from "./system-entity.js";
import { getSemanticChildren, removeOccurrenceOrHardDelete } from "./node.js";
import { applyDesiredManagedChildren } from "./schema-reconcile-apply.js";
import { collectDesiredManagedChildren } from "./schema-reconcile-desired.js";
import { reorderTargetChildren, trimStaleManagedProvenance } from "./schema-reconcile-order.js";
import { requireCanonicalOccurrence } from "./lookup.js";

export function reconcileTargetSchemas(doc: Engine, targetOccurrenceId: string): DomainChange[] {
  const target = requireCanonicalOccurrence(doc, targetOccurrenceId);
  const desired = collectDesiredManagedChildren(doc, target);
  const applied = applyDesiredManagedChildren(doc, target, desired);
  const changes = [...applied.changes];

  changes.push(...trimStaleManagedProvenance(doc, target, applied.assignedProvenanceByOccurrence));
  changes.push(...reorderTargetChildren(doc, target, applied.managedOrder));

  return changes;
}

export function cleanupInactiveManagedChildren(
  doc: Engine,
  targetOccurrenceId: string,
): DomainChange[] {
  const target = doc.mustGetOccurrence(targetOccurrenceId);
  const changes: DomainChange[] = [];

  for (const child of doc.getOccurrenceChildren(targetOccurrenceId)) {
    if (isActiveManagedChild(doc, target, child)) {
      continue;
    }
    const managedKind = managedKindValue(doc, child);
    if (!managedKind) {
      continue;
    }

    if (managedKind === ManagedKind.FieldSlot && isField(doc, child)) {
      changes.push(cleanupInactiveFieldSlot(doc, child));
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

function cleanupInactiveFieldSlot(doc: Engine, child: NodeOccurrence): DomainChange {
  const hasValues = getSemanticChildren(doc, child.occurrenceId).length > 0;
  if (hasValues) {
    return {
      kind: ManagedKind.FieldSlot,
      reason: "kept",
      nodeId: child.nodeId,
      occurrenceId: child.occurrenceId,
    };
  }
  removeOccurrenceOrHardDelete(doc, child.occurrenceId);
  return {
    kind: ManagedKind.FieldSlot,
    reason: "deleted",
    nodeId: child.nodeId,
    occurrenceId: child.occurrenceId,
  };
}
