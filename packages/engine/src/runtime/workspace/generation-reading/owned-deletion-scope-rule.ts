import type { Mutation, ProjectionPerspective } from "../../../domain/fact/index.js";
import type { ProjectedOccurrence } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import { readIndex } from "./index-reader.js";
import { includeOccurrenceAncestors } from "./occurrence-ancestry-reader.js";
import { readOwnedNodeClosure } from "./owner-closure-reader.js";
import type { GenerationReadScope } from "./read-plan.js";

export async function includeOwnedDeletionScope(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  mutations: readonly Mutation[],
  initialOccurrences: Record<string, ProjectedOccurrence>,
  nodeOwners: Record<string, string | null>,
  scope: GenerationReadScope,
): Promise<Record<string, ProjectedOccurrence>> {
  const ownedNodeOwners = await readOwnedNodeClosure(
    store,
    generationId,
    perspective,
    deletionOwnershipRoots(mutations, initialOccurrences, nodeOwners),
  );
  Object.assign(nodeOwners, ownedNodeOwners);
  const ownedNodeIds = Object.keys(ownedNodeOwners);
  ownedNodeIds.forEach((nodeId) => scope.nodes.add(nodeId));
  if (ownedNodeIds.length === 0) {
    return initialOccurrences;
  }
  const occurrenceIds = await readIndex(store, generationId, perspective, "occurrenceIdsByNode", ownedNodeIds);
  const batch = await store.read(generationId, perspective, "occurrences", occurrenceIds);
  const occurrences = await includeOccurrenceAncestors(store, generationId, perspective, {
    ...initialOccurrences,
    ...Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value])),
  });
  includeOccurrenceScope(scope, occurrences);
  return occurrences;
}

function deletionOwnershipRoots(
  mutations: readonly Mutation[],
  occurrences: Record<string, ProjectedOccurrence>,
  nodeOwners: Record<string, string | null>,
): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === "node-delete") {
      roots.add(mutation.nodeId);
      continue;
    }
    const occurrenceId = deletedOccurrenceId(mutation);
    const occurrence = occurrenceId ? occurrences[occurrenceId] : undefined;
    if (occurrence && nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
      roots.add(occurrence.nodeId);
    }
  }
  return roots;
}

function deletedOccurrenceId(mutation: Mutation): string | null {
  if (mutation.kind === "occurrence-delete") {
    return mutation.occurrenceId;
  }
  if (mutation.kind === "materialized-field-delete") {
    return mutation.fieldOccurrenceId;
  }
  if (mutation.kind === "supertag-template-node-remove") {
    return mutation.templateOccurrenceId;
  }
  return mutation.kind === "field-value-delete" ? mutation.valueOccurrenceId : null;
}

function includeOccurrenceScope(scope: GenerationReadScope, occurrences: Record<string, ProjectedOccurrence>): void {
  for (const occurrence of Object.values(occurrences)) {
    scope.nodes.add(occurrence.nodeId);
    scope.nodes.add(occurrence.parentNodeId);
    scope.childOccurrences.add(occurrence.parentNodeId);
  }
}
