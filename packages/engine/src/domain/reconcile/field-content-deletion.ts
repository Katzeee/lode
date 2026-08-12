import type { ContributionFact, Mutation } from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { insertAtAnchor, listFor } from "./sequence.js";

export function fieldContentDeletionOccurrenceId(mutation: Mutation): string | null {
  if (mutation.kind === "field-value-delete") {
    return mutation.valueOccurrenceId;
  }
  return mutation.kind === "materialized-field-delete" ? mutation.fieldOccurrenceId : null;
}

export function occurrenceDeletionIds(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const fact of active) {
    const mutation = fact.body.mutation;
    const occurrenceId =
      mutation.kind === "occurrence-delete"
        ? mutation.occurrenceId
        : fieldContentDeletionOccurrenceId(mutation);
    if (occurrenceId) {
      const ids = result.get(occurrenceId) ?? [];
      ids.push(fact.id);
      result.set(occurrenceId, ids);
    }
  }
  return result;
}

export function hasUnrestoredDeletion(
  occurrenceId: string,
  deletionIds: ReadonlyMap<string, readonly string[]>,
  restoredDeletionIds: ReadonlySet<string>,
): boolean {
  return (deletionIds.get(occurrenceId) ?? []).some(
    (deletionId) => !restoredDeletionIds.has(deletionId),
  );
}

export function restoreMaterializedFieldDescendants(
  active: readonly ContributionFact[],
  deletionFactId: string,
  parentOccurrenceId: string,
  deletionIds: ReadonlyMap<string, readonly string[]>,
  restoredDeletionIds: ReadonlySet<string>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  const restoresField = active.some(
    (fact) => fact.id === deletionFactId && fact.body.mutation.kind === "materialized-field-delete",
  );
  if (restoresField) {
    const candidatesByParent = createdOccurrencesByParent(active);
    restoreCreatedDescendants(
      candidatesByParent,
      parentOccurrenceId,
      deletionIds,
      restoredDeletionIds,
      occurrences,
      children,
      nodes,
    );
  }
}

type OccurrenceCreation = Extract<Mutation, { kind: "occurrence-create" }>;

function createdOccurrencesByParent(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly OccurrenceCreation[]> {
  const result = new Map<string, OccurrenceCreation[]>();
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "occurrence-create" || mutation.parentOccurrenceId === null) {
      continue;
    }
    const values = result.get(mutation.parentOccurrenceId) ?? [];
    values.push(mutation);
    result.set(mutation.parentOccurrenceId, values);
  }
  return result;
}

function restoreCreatedDescendants(
  candidatesByParent: ReadonlyMap<string, readonly OccurrenceCreation[]>,
  parentOccurrenceId: string,
  deletionIds: ReadonlyMap<string, readonly string[]>,
  restoredDeletionIds: ReadonlySet<string>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  for (const mutation of candidatesByParent.get(parentOccurrenceId) ?? []) {
    if (
      occurrences.has(mutation.occurrenceId) ||
      !nodes.has(mutation.nodeId) ||
      hasUnrestoredDeletion(mutation.occurrenceId, deletionIds, restoredDeletionIds)
    ) {
      continue;
    }
    occurrences.set(mutation.occurrenceId, {
      occurrenceId: mutation.occurrenceId,
      nodeId: mutation.nodeId,
      parentOccurrenceId,
      properties: {},
      metadata: {},
      managed: false,
    });
    insertAtAnchor(listFor(children, parentOccurrenceId), mutation.occurrenceId, mutation.anchor);
    restoreCreatedDescendants(
      candidatesByParent,
      mutation.occurrenceId,
      deletionIds,
      restoredDeletionIds,
      occurrences,
      children,
      nodes,
    );
  }
}
