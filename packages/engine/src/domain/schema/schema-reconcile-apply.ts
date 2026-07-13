import type { Engine, NodeOccurrence } from "../../core/index.js";
import { ManagedKind } from "../model/managed-child.js";
import { readManagedChildState, writeManagedChildState } from "../managed/managed-child-state.js";
import { markField, matchesFieldDef } from "../system-entity.js";
import { createPlainNode, createReference, getSemanticChildren } from "../node/node.js";
import {
  type AppliedManagedChildren,
  type DesiredManagedChild,
  isSameProvenance,
  provenanceKeyOf,
} from "../model/reconcile.js";

export async function applyDesiredManagedChildren(
  engine: Engine,
  target: NodeOccurrence,
  desired: DesiredManagedChild[],
): Promise<AppliedManagedChildren> {
  const changes: AppliedManagedChildren["changes"] = [];
  const reserved = new Set<string>();
  const assignedProvenanceByOccurrence = new Map<string, DesiredManagedChild["provenance"]>();
  const managedOrder: string[] = [];

  // Fetch the target's children once: findMatchingChild only reads them to find a match, and a child
  // created in an earlier iteration is added to `reserved` (which findMatchingChild skips) — a
  // per-iteration re-fetch returns the same effective candidate set.
  const targetChildren = await engine.getOccurrenceChildren(target.occurrenceId);
  for (const desiredChild of desired) {
    const existing = await findMatchingChild(engine, targetChildren, desiredChild, reserved);
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
      child = await createManagedChild(engine, target, desiredChild);
      reserved.add(child.occurrenceId);
      changes.push({
        kind: desiredChild.managedKind,
        reason: "created",
        nodeId: child.nodeId,
        occurrenceId: child.occurrenceId,
      });
    }

    if (await updateProvenance(engine, child, desiredChild)) {
      changes.push({
        kind: desiredChild.managedKind,
        reason: "provenanceUpdated",
        nodeId: child.nodeId,
        occurrenceId: child.occurrenceId,
      });
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
  engine: Engine,
  target: NodeOccurrence,
  desired: DesiredManagedChild,
): Promise<NodeOccurrence> {
  if (desired.managedKind === ManagedKind.FieldSlot) {
    const field = await createPlainNode(engine, target.occurrenceId);
    await markField(engine, field.occurrenceId, desired.fieldDefNodeId);
    return field;
  }
  return createReference(engine, desired.templateNodeId, target.occurrenceId);
}

async function updateProvenance(
  engine: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): Promise<boolean> {
  const oldManaged = readManagedChildState(engine, child.occurrenceId);
  const oldManagedKind = oldManaged.status === "valid" ? oldManaged.kind : null;
  const oldManagedBy = oldManaged.status === "valid" ? oldManaged.provenance : [];
  const nextManagedBy = desired.provenance.map((entry) => ({ ...entry }));

  if (oldManagedKind !== desired.managedKind || !isSameProvenance(oldManagedBy, nextManagedBy)) {
    await writeManagedChildState(engine, child.occurrenceId, desired.managedKind, nextManagedBy);
    return true;
  }
  return false;
}

async function findMatchingChild(
  engine: Engine,
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
      (await matchesDesiredTarget(engine, child, desired)) &&
      (await isReusableCandidate(engine, child, desired))
    ) {
      candidates.push(child);
    }
  }

  const desiredProvenanceKeys = new Set(desired.provenance.map(provenanceKeyOf));
  const provenanceMatch = candidates.find((child) => {
    const managed = readManagedChildState(engine, child.occurrenceId);
    if (managed.status !== "valid" || managed.kind !== desired.managedKind) {
      return false;
    }
    return managed.provenance.some((entry) => desiredProvenanceKeys.has(provenanceKeyOf(entry)));
  });
  if (provenanceMatch) {
    return provenanceMatch;
  }

  return candidates[0];
}

async function isReusableCandidate(
  engine: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): Promise<boolean> {
  if (desired.managedKind !== ManagedKind.FieldSlot || desired.createIfMissing) {
    return true;
  }
  return (await getSemanticChildren(engine, child.occurrenceId)).length > 0;
}

async function matchesDesiredTarget(
  engine: Engine,
  child: NodeOccurrence,
  desired: DesiredManagedChild,
): Promise<boolean> {
  if (desired.managedKind === ManagedKind.FieldSlot) {
    return matchesFieldDef(engine, child, desired.fieldDefNodeId);
  }
  return child.nodeId === desired.templateNodeId;
}
