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

export async function applyDesiredManagedChildren(
  doc: Engine,
  target: NodeOccurrence,
  desired: DesiredManagedChild[],
): Promise<AppliedManagedChildren> {
  const changes: AppliedManagedChildren["changes"] = [];
  const reserved = new Set<string>();
  const assignedProvenanceByOccurrence = new Map<string, DesiredManagedChild["provenance"]>();
  const managedOrder: string[] = [];

  for (const desiredChild of desired) {
    const targetChildren = await doc.getOccurrenceChildren(target.occurrenceId);
    const existing = await findMatchingChild(doc, targetChildren, desiredChild, reserved);
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
      child = await createManagedChild(doc, target, desiredChild);
      reserved.add(child.occurrenceId);
      changes.push({
        kind: desiredChild.managedKind,
        reason: "created",
        nodeId: child.nodeId,
        occurrenceId: child.occurrenceId,
      });
    }

    if (await updateProvenance(doc, child, desiredChild)) {
      changes.push({
        kind: desiredChild.managedKind,
        reason: "provenanceUpdated",
        nodeId: child.nodeId,
        occurrenceId: child.occurrenceId,
      });
      child = await doc.mustGetOccurrence(child.occurrenceId);
    }
    assignedProvenanceByOccurrence.set(
      child.occurrenceId,
      desiredChild.provenance.map((entry) => ({ ...entry })),
    );
    managedOrder.push(child.occurrenceId);
  }

  return { changes, assignedProvenanceByOccurrence, managedOrder };
}

async function createManagedChild(
  doc: Engine,
  target: NodeOccurrence,
  desired: DesiredManagedChild,
): Promise<NodeOccurrence> {
  if (desired.managedKind === ManagedKind.FieldSlot) {
    const field = await createPlainNode(doc, target.occurrenceId);
    await markField(doc, field.occurrenceId, desired.fieldDefNodeId);
    return field;
  }
  return createReference(doc, desired.templateNodeId, target.occurrenceId);
}

async function updateProvenance(
  doc: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): Promise<boolean> {
  const oldManaged = readManagedChildState(doc, child.occurrenceId);
  const oldManagedKind = oldManaged.status === "valid" ? oldManaged.kind : null;
  const oldManagedBy = oldManaged.status === "valid" ? oldManaged.provenance : [];
  const nextManagedBy = desired.provenance.map((entry) => ({ ...entry }));

  if (oldManagedKind !== desired.managedKind || !isSameProvenance(oldManagedBy, nextManagedBy)) {
    await writeManagedChildState(doc, child.occurrenceId, desired.managedKind, nextManagedBy);
    return true;
  }
  return false;
}

async function findMatchingChild(
  doc: Engine,
  children: NodeOccurrence[],
  desired: DesiredManagedChild,
  reserved: Set<string>,
): Promise<NodeOccurrence | undefined> {
  // Async predicates (matchesDesiredTarget / isReusableCandidate fault shards) — gather
  // candidates sequentially, then the provenance lookup is a sync readManagedChildState.
  const candidates: NodeOccurrence[] = [];
  for (const child of children) {
    if (reserved.has(child.occurrenceId)) {
      continue;
    }
    if (
      (await matchesDesiredTarget(doc, child, desired)) &&
      (await isReusableCandidate(doc, child, desired))
    ) {
      candidates.push(child);
    }
  }

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

async function isReusableCandidate(
  doc: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): Promise<boolean> {
  if (desired.managedKind !== ManagedKind.FieldSlot || desired.createIfMissing) {
    return true;
  }
  return (await getSemanticChildren(doc, child.occurrenceId)).length > 0;
}

async function matchesDesiredTarget(
  doc: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): Promise<boolean> {
  if (desired.managedKind === ManagedKind.FieldSlot) {
    return (
      (await isField(doc, child)) && (await readFieldDefId(doc, child)) === desired.fieldDefNodeId
    );
  }
  return child.nodeId === desired.templateNodeId;
}
