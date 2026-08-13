import type { Mutation, ViewMode } from "../../domain/fact/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";
import { includeOccurrenceAncestors } from "./occurrence-ancestry-reader.js";
import { readIndex } from "./mutation-generation-index-reader.js";
import { isProjectedOccurrence, type MutationReadScope } from "./mutation-read-scope.js";
import { readOwnedNodeClosure } from "./owner-generation-reader.js";

export async function includeOwnedDeletionSubtree(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  mutations: readonly (Mutation | EditMutation)[],
  initialOccurrences: Record<string, unknown>,
  nodeOwners: Record<string, unknown>,
  wanted: MutationReadScope,
): Promise<Record<string, unknown>> {
  const ownedNodeOwners = await readOwnedNodeClosure(
    store,
    generationId,
    view,
    deletionOwnershipRoots(mutations, initialOccurrences, nodeOwners),
  );
  Object.assign(nodeOwners, ownedNodeOwners);
  const ownedNodeIds = Object.keys(ownedNodeOwners);
  ownedNodeIds.forEach((nodeId) => wanted.nodes.add(nodeId));
  if (ownedNodeIds.length === 0) {
    return initialOccurrences;
  }
  const occurrenceIds = await readIndex(
    store,
    generationId,
    view,
    "occurrenceIdsByNode",
    ownedNodeIds,
  );
  const batch = await store.read(generationId, view, "occurrences", occurrenceIds);
  const occurrences = await includeOccurrenceAncestors(store, generationId, view, {
    ...initialOccurrences,
    ...Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value])),
  });
  for (const occurrence of Object.values(occurrences)) {
    if (isProjectedOccurrence(occurrence)) {
      wanted.nodes.add(occurrence.nodeId);
      wanted.nodes.add(occurrence.parentNodeId);
      wanted.children.add(occurrence.parentNodeId);
    }
  }
  return occurrences;
}

function deletionOwnershipRoots(
  mutations: readonly (Mutation | EditMutation)[],
  occurrences: Record<string, unknown>,
  nodeOwners: Record<string, unknown>,
): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === "node-delete") {
      roots.add(mutation.nodeId);
    } else {
      const occurrenceId = deletedOccurrenceId(mutation);
      const occurrence = occurrenceId ? occurrences[occurrenceId] : undefined;
      if (
        isProjectedOccurrence(occurrence) &&
        nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
      ) {
        roots.add(occurrence.nodeId);
      }
    }
  }
  return roots;
}

function deletedOccurrenceId(mutation: Mutation | EditMutation): string | null {
  if (mutation.kind === "occurrence-delete") {
    return mutation.occurrenceId;
  }
  if (mutation.kind === "schema-field-remove" || mutation.kind === "materialized-field-delete") {
    return mutation.fieldOccurrenceId;
  }
  if (mutation.kind === "schema-template-node-remove") {
    return mutation.templateOccurrenceId;
  }
  return mutation.kind === "field-value-delete" ? mutation.valueOccurrenceId : null;
}
