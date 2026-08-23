import {
  fieldDefinitionEndpointOccurrenceId,
  type AuthoredAction,
  type ProjectionPerspective,
} from "../../../domain/fact/index.js";
import type { ProjectedOccurrence } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../projection/index.js";
import { readIndex } from "./index-reader.js";
import { includeOccurrenceAncestors } from "./occurrence-ancestry-reader.js";
import { readOwnedNodeClosure } from "./owner-closure-reader.js";
import type { GenerationReadScope } from "./read-scope.js";

export async function includeOwnedDeletionScope(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  actions: readonly AuthoredAction[],
  initialOccurrences: Record<string, ProjectedOccurrence>,
  nodeOwners: Record<string, string | null>,
  scope: GenerationReadScope,
): Promise<Record<string, ProjectedOccurrence>> {
  const ownedNodeOwners = await readOwnedNodeClosure(
    store,
    generationId,
    perspective,
    deletionOwnershipRoots(actions, initialOccurrences, nodeOwners),
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
  actions: readonly AuthoredAction[],
  occurrences: Record<string, ProjectedOccurrence>,
  nodeOwners: Record<string, string | null>,
): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const authoredAction of actions) {
    if (authoredAction.kind === "node-trash") {
      roots.add(authoredAction.nodeId);
      continue;
    }
    for (const occurrenceId of deletedOccurrenceIds(authoredAction, occurrences)) {
      const occurrence = occurrences[occurrenceId];
      if (occurrence && nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
        roots.add(occurrence.nodeId);
      }
    }
  }
  return roots;
}

function deletedOccurrenceIds(
  authoredAction: AuthoredAction,
  occurrences: Readonly<Record<string, ProjectedOccurrence>>,
): readonly string[] {
  if (authoredAction.kind === "placement-remove") {
    return [authoredAction.placementId];
  }
  if (authoredAction.kind === "materialized-field-clear") {
    return Object.values(occurrences)
      .filter((occurrence) => {
        if (occurrence.parentNodeId !== authoredAction.ownerNodeId) {
          return false;
        }
        const endpoint = occurrences[fieldDefinitionEndpointOccurrenceId(occurrence.occurrenceId)];
        return endpoint?.nodeId === authoredAction.fieldDefinitionId && endpoint.parentNodeId === occurrence.nodeId;
      })
      .map((occurrence) => occurrence.occurrenceId);
  }
  return authoredAction.kind === "field-value-remove" ? [authoredAction.valuePlacementId] : [];
}

function includeOccurrenceScope(scope: GenerationReadScope, occurrences: Record<string, ProjectedOccurrence>): void {
  for (const occurrence of Object.values(occurrences)) {
    scope.nodes.add(occurrence.nodeId);
    scope.nodes.add(occurrence.parentNodeId);
    scope.childOccurrences.add(occurrence.parentNodeId);
  }
}
