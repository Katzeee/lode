import { isOccurrenceMutation, type ContributionFact, type JsonValue } from "../fact/index.js";
import type { TextAtom } from "./projection-types.js";
import { insertAtAnchor, listFor, removePlacement } from "./sequence.js";
import { hasUnrestoredDeletion, occurrenceDeletionIds } from "./field-content-deletion.js";
import { removeOccurrencesWithMissingNodes } from "./occurrence-tree.js";
import {
  createdOccurrenceNodeId,
  hasPlacement,
  newOccurrence,
  placeCreatedOccurrence,
  placeOccurrence,
} from "./occurrence-creation.js";

export type MutableOccurrence = {
  occurrenceId: string;
  nodeId: string;
  parentNodeId: string;
  properties: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
  derived: boolean;
};

export type MutableNode = {
  nodeId: string;
  text: TextAtom[];
  properties: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
};

export type AuthoredStructure = Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  children: Map<string, string[]>;
}>;

export function createOccurrences(
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
): AuthoredStructure {
  const occurrences = new Map<string, MutableOccurrence>();
  const children = new Map<string, string[]>();
  const createdIdentities = new Set<string>();
  const restoredDeletionIds = restoredOccurrenceDeletionIds(active);
  const deletionIds = occurrenceDeletionIds(active);

  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (!isOccurrenceMutation(mutation)) {
      continue;
    }
    switch (mutation.kind) {
      case "occurrence-create":
        placeCreatedOccurrence(mutation, occurrences, children, nodes, createdIdentities);
        break;
      case "occurrence-move": {
        const occurrence = occurrences.get(mutation.occurrenceId);
        if (
          occurrence &&
          nodes.has(mutation.parentNodeId) &&
          !hasPlacement(occurrences, occurrence.nodeId, mutation.parentNodeId, mutation.occurrenceId)
        ) {
          removePlacement(children, mutation.occurrenceId);
          occurrence.parentNodeId = mutation.parentNodeId;
          insertAtAnchor(listFor(children, mutation.parentNodeId), mutation.occurrenceId, mutation.anchor);
        }
        break;
      }
      case "occurrence-delete":
        if (!restoredDeletionIds.has(fact.id)) {
          deleteOccurrence(mutation.occurrenceId, occurrences, children);
        }
        break;
      case "occurrence-restore":
        applyOccurrenceRestore(active, mutation, deletionIds, restoredDeletionIds, occurrences, children, nodes);
        break;
    }
  }

  removeOccurrencesWithMissingNodes(nodes, occurrences, children);
  return { occurrences, children };
}

function restoredOccurrenceDeletionIds(active: readonly ContributionFact[]): ReadonlySet<string> {
  return new Set(
    active.flatMap((fact) =>
      fact.body.mutation.kind === "occurrence-restore" ? [fact.body.mutation.deletionFactId] : [],
    ),
  );
}

function applyOccurrenceRestore(
  active: readonly ContributionFact[],
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "occurrence-restore" }>,
  deletionIds: ReadonlyMap<string, readonly string[]>,
  restoredDeletionIds: ReadonlySet<string>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  if (hasUnrestoredDeletion(mutation.occurrenceId, deletionIds, restoredDeletionIds)) {
    return;
  }
  restoreOccurrence(active, mutation, occurrences, children, nodes);
}

function restoreOccurrence(
  active: readonly ContributionFact[],
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "occurrence-restore" }>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  const nodeId = createdOccurrenceNodeId(active, mutation.occurrenceId);
  if (nodeId === null || !nodes.has(nodeId)) {
    return;
  }
  const existing = occurrences.get(mutation.occurrenceId);
  if (existing) {
    removePlacement(children, mutation.occurrenceId);
    existing.parentNodeId = mutation.parentNodeId;
    insertAtAnchor(listFor(children, mutation.parentNodeId), mutation.occurrenceId, mutation.anchor);
    return;
  }
  placeOccurrence(
    occurrences,
    children,
    newOccurrence(mutation.occurrenceId, nodeId, mutation.parentNodeId),
    mutation.anchor,
    nodes,
  );
}

function deleteOccurrence(
  occurrenceId: string,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
): void {
  removePlacement(children, occurrenceId);
  occurrences.delete(occurrenceId);
}
