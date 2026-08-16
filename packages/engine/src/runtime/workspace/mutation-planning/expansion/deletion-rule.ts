import type { Mutation } from "../../../../domain/fact/index.js";
import { singleMutationWrite, type MutationWrite } from "../../../../domain/edit/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";

export function expandNodeDeletion(
  mutation: Extract<Mutation, { kind: "node-delete" }>,
  _available: ScopedProjection,
): MutationWrite {
  return singleMutationWrite(mutation);
}

export function expandOccurrenceDeletion(
  mutation: Extract<Mutation, { kind: "occurrence-delete" }>,
  available: ScopedProjection,
): MutationWrite {
  const occurrence = available.occurrences[mutation.occurrenceId];
  return occurrence && available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? singleMutationWrite({ kind: "node-delete", nodeId: occurrence.nodeId })
    : singleMutationWrite(mutation);
}

export function deletePlacement(occurrenceId: string, available: ScopedProjection): readonly Mutation[] {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    return [];
  }
  return available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? [{ kind: "node-delete", nodeId: occurrence.nodeId }]
    : [{ kind: "occurrence-delete", occurrenceId }];
}
