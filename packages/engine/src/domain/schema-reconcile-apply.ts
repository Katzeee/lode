import type { Engine, NodeOccurrence } from "../core/index.js";
import { ManagedKind } from "./model/managed-child.js";
import { readManagedChildState, writeManagedChildState } from "./managed-child-state.js";
import { isField, markField, readFieldDefId } from "./system-entity.js";
import { createPlainNode, createReference, getSemanticChildren } from "./node.js";
import {
  type AppliedManagedChildren,
  type DesiredManagedChild,
  isSameProvenance,
  provenanceKeyOf,
} from "./model/reconcile.js";

export function applyDesiredManagedChildren(
  doc: Engine,
  target: NodeOccurrence,
  desired: DesiredManagedChild[],
): AppliedManagedChildren {
  const changes: AppliedManagedChildren["changes"] = [];
  const reserved = new Set<string>();
  const assignedProvenanceByOccurrence = new Map<string, DesiredManagedChild["provenance"]>();
  const managedOrder: string[] = [];

  for (const desiredChild of desired) {
    const existing = findMatchingChild(
      doc,
      doc.getOccurrenceChildren(target.occurrenceId),
      desiredChild,
      reserved,
    );
    if (!existing && !desiredChild.createIfMissing) {
      continue;
    }

    let child = existing;
    if (child) {
      reserved.add(child.occurrenceId);
      changes.push({
        kind: desiredChild.managedKind,
        reason: "reused",
        nodeId: child.nodeId,
        occurrenceId: child.occurrenceId,
      });
    } else {
      child = createManagedChild(doc, target, desiredChild);
      reserved.add(child.occurrenceId);
      changes.push({
        kind: desiredChild.managedKind,
        reason: "created",
        nodeId: child.nodeId,
        occurrenceId: child.occurrenceId,
      });
    }

    if (updateProvenance(doc, child, desiredChild)) {
      changes.push({
        kind: desiredChild.managedKind,
        reason: "provenanceUpdated",
        nodeId: child.nodeId,
        occurrenceId: child.occurrenceId,
      });
      child = doc.mustGetOccurrence(child.occurrenceId);
    }
    assignedProvenanceByOccurrence.set(
      child.occurrenceId,
      desiredChild.provenance.map((entry) => ({ ...entry })),
    );
    managedOrder.push(child.occurrenceId);
  }

  return { changes, assignedProvenanceByOccurrence, managedOrder };
}

function createManagedChild(
  doc: Engine,
  target: NodeOccurrence,
  desired: DesiredManagedChild,
): NodeOccurrence {
  if (desired.managedKind === ManagedKind.FieldSlot) {
    const field = createPlainNode(doc, target.occurrenceId);
    markField(doc, field.occurrenceId, desired.fieldDefNodeId);
    return field;
  }
  return createReference(doc, desired.templateNodeId, target.occurrenceId);
}

function updateProvenance(
  doc: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): boolean {
  const oldManaged = readManagedChildState(doc, child.occurrenceId);
  const oldManagedKind = oldManaged.status === "valid" ? oldManaged.kind : null;
  const oldManagedBy = oldManaged.status === "valid" ? oldManaged.provenance : [];
  const nextManagedBy = desired.provenance.map((entry) => ({ ...entry }));

  let updated = false;
  if (oldManagedKind !== desired.managedKind || !isSameProvenance(oldManagedBy, nextManagedBy)) {
    writeManagedChildState(doc, child.occurrenceId, desired.managedKind, nextManagedBy);
    updated = true;
  }
  return updated;
}

function findMatchingChild(
  doc: Engine,
  children: NodeOccurrence[],
  desired: DesiredManagedChild,
  reserved: Set<string>,
): NodeOccurrence | undefined {
  const candidates = children.filter(
    (child) =>
      !reserved.has(child.occurrenceId) &&
      matchesDesiredTarget(doc, child, desired) &&
      isReusableCandidate(doc, child, desired),
  );

  const desiredProvenanceKeys = new Set(desired.provenance.map(provenanceKeyOf));
  const provenanceMatch = candidates.find((child) => {
    const managed = readManagedChildState(doc, child.occurrenceId);
    if (managed.status !== "valid" || managed.kind !== desired.managedKind) {
      return false;
    }
    return managed.provenance.some((entry) => desiredProvenanceKeys.has(provenanceKeyOf(entry)));
  });
  if (provenanceMatch) {
    return provenanceMatch;
  }

  return candidates.find(() => true);
}

function isReusableCandidate(
  doc: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): boolean {
  if (desired.managedKind !== ManagedKind.FieldSlot || desired.createIfMissing) {
    return true;
  }
  return getSemanticChildren(doc, child.occurrenceId).length > 0;
}

function matchesDesiredTarget(
  doc: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): boolean {
  if (desired.managedKind === ManagedKind.FieldSlot) {
    return isField(doc, child) && readFieldDefId(doc, child) === desired.fieldDefNodeId;
  }
  return child.nodeId === desired.templateNodeId;
}
