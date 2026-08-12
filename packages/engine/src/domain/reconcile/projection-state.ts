import { type ContributionFact, type JsonValue, type SequenceAnchor } from "../fact/index.js";
import type { TextAtom } from "./projection-types.js";
import { insertAtAnchor, listFor, removePlacement } from "./sequence.js";

export type MutableOccurrence = {
  occurrenceId: string;
  nodeId: string;
  parentOccurrenceId: string | null;
  properties: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
  managed: boolean;
};

export type MutableNode = {
  nodeId: string;
  text: TextAtom[];
  properties: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
};

export function createNodes(active: readonly ContributionFact[]): Map<string, MutableNode> {
  const created = new Map<string, MutableNode>();
  const deletionFactIds = new Map<string, string[]>();
  const restoredDeletionIds = new Set<string>();

  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "node-create" && !created.has(mutation.nodeId)) {
      created.set(mutation.nodeId, {
        nodeId: mutation.nodeId,
        text: [],
        properties: {},
        metadata: {},
      });
    } else if (mutation.kind === "node-delete") {
      const deletions = deletionFactIds.get(mutation.nodeId) ?? [];
      deletions.push(fact.id);
      deletionFactIds.set(mutation.nodeId, deletions);
    } else if (mutation.kind === "node-restore") {
      restoredDeletionIds.add(mutation.deletionFactId);
    }
  }

  for (const [nodeId, deletionIds] of deletionFactIds) {
    if (deletionIds.some((id) => !restoredDeletionIds.has(id))) {
      created.delete(nodeId);
    }
  }
  return created;
}

export function createOccurrences(
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
): {
  occurrences: Map<string, MutableOccurrence>;
  children: Map<string, string[]>;
} {
  const occurrences = new Map<string, MutableOccurrence>();
  const children = new Map<string, string[]>();
  const createdIdentities = new Set<string>();
  const restoredDeletionIds = new Set(
    active.flatMap((fact) =>
      fact.body.mutation.kind === "occurrence-restore" ? [fact.body.mutation.deletionFactId] : [],
    ),
  );
  const deletionIds = occurrenceDeletionIds(active);

  for (const fact of active) {
    const mutation = fact.body.mutation;
    switch (mutation.kind) {
      case "occurrence-create":
        if (nodes.has(mutation.nodeId) && !createdIdentities.has(mutation.occurrenceId)) {
          createdIdentities.add(mutation.occurrenceId);
          const parentOccurrenceId =
            mutation.parentOccurrenceId !== null &&
            !occurrences.has(mutation.parentOccurrenceId) &&
            mutation.parentPolicy === "rehome"
              ? null
              : mutation.parentOccurrenceId;
          placeOccurrence(
            occurrences,
            children,
            newOccurrence(mutation.occurrenceId, mutation.nodeId, parentOccurrenceId),
            mutation.anchor,
          );
        }
        break;
      case "occurrence-move": {
        const occurrence = occurrences.get(mutation.occurrenceId);
        if (
          occurrence &&
          parentExists(mutation.parentOccurrenceId, occurrences) &&
          !createsCycle(mutation.occurrenceId, mutation.parentOccurrenceId, occurrences)
        ) {
          removePlacement(children, mutation.occurrenceId);
          occurrence.parentOccurrenceId = mutation.parentOccurrenceId;
          insertAtAnchor(
            listFor(children, mutation.parentOccurrenceId),
            mutation.occurrenceId,
            mutation.anchor,
          );
        }
        break;
      }
      case "occurrence-delete":
        if (!restoredDeletionIds.has(fact.id)) {
          deleteOccurrence(mutation.occurrenceId, mutation.childPolicy, occurrences, children);
        }
        break;
      case "occurrence-restore":
        if (!hasUnrestoredDeletion(mutation.occurrenceId, deletionIds, restoredDeletionIds)) {
          restoreOccurrence(active, mutation, occurrences, children, nodes);
        }
        break;
      case "node-create":
      case "node-delete":
      case "node-restore":
      case "canonical-occurrence-set":
      case "schema-apply":
      case "schema-remove":
      case "schema-field-add":
      case "schema-field-remove":
      case "schema-field-configure":
      case "schema-extension-add":
      case "schema-extension-remove":
      case "field-materialize":
      case "field-initialize":
      case "text-splice":
      case "text-mark":
      case "value-set":
      case "value-unset":
        break;
    }
  }

  for (const [id, occurrence] of occurrences) {
    if (!nodes.has(occurrence.nodeId)) {
      deleteOccurrence(id, "cascade", occurrences, children);
    }
  }
  return { occurrences, children };
}

function occurrenceDeletionIds(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "occurrence-delete") {
      const ids = result.get(mutation.occurrenceId) ?? [];
      ids.push(fact.id);
      result.set(mutation.occurrenceId, ids);
    }
  }
  return result;
}

function hasUnrestoredDeletion(
  occurrenceId: string,
  deletionIds: ReadonlyMap<string, readonly string[]>,
  restoredDeletionIds: ReadonlySet<string>,
): boolean {
  return (deletionIds.get(occurrenceId) ?? []).some(
    (deletionId) => !restoredDeletionIds.has(deletionId),
  );
}

export function validateStoredTree(occurrences: ReadonlyMap<string, MutableOccurrence>): void {
  for (const occurrence of occurrences.values()) {
    const seen = new Set<string>();
    let cursor: MutableOccurrence | undefined = occurrence;
    while (cursor) {
      if (seen.has(cursor.occurrenceId)) {
        throw new Error(`Occurrence tree cycle: ${occurrence.occurrenceId}`);
      }
      seen.add(cursor.occurrenceId);
      cursor = cursor.parentOccurrenceId ? occurrences.get(cursor.parentOccurrenceId) : undefined;
    }
  }
}

function restoreOccurrence(
  active: readonly ContributionFact[],
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "occurrence-restore" }>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  const create = active.find(
    (candidate) =>
      candidate.body.mutation.kind === "occurrence-create" &&
      candidate.body.mutation.occurrenceId === mutation.occurrenceId,
  );
  if (
    create?.body.mutation.kind !== "occurrence-create" ||
    !nodes.has(create.body.mutation.nodeId)
  ) {
    return;
  }
  const existing = occurrences.get(mutation.occurrenceId);
  if (existing) {
    removePlacement(children, mutation.occurrenceId);
    existing.parentOccurrenceId = mutation.parentOccurrenceId;
    insertAtAnchor(
      listFor(children, mutation.parentOccurrenceId),
      mutation.occurrenceId,
      mutation.anchor,
    );
    return;
  }
  placeOccurrence(
    occurrences,
    children,
    newOccurrence(mutation.occurrenceId, create.body.mutation.nodeId, mutation.parentOccurrenceId),
    mutation.anchor,
  );
}

function newOccurrence(
  occurrenceId: string,
  nodeId: string,
  parentOccurrenceId: string | null,
): MutableOccurrence {
  return {
    occurrenceId,
    nodeId,
    parentOccurrenceId,
    properties: {},
    metadata: {},
    managed: false,
  };
}

function deleteOccurrence(
  occurrenceId: string,
  childPolicy: "cascade" | "rehome",
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
): void {
  const occurrence = occurrences.get(occurrenceId);
  if (!occurrence) {
    return;
  }
  const directChildren = [...(children.get(occurrenceId) ?? [])];
  if (childPolicy === "cascade") {
    for (const childId of directChildren) {
      deleteOccurrence(childId, "cascade", occurrences, children);
    }
  } else {
    const destination = listFor(children, occurrence.parentOccurrenceId);
    const removedIndex = destination.indexOf(occurrenceId);
    const insertionIndex = removedIndex < 0 ? destination.length : removedIndex;
    for (const childId of directChildren) {
      const child = occurrences.get(childId);
      if (child) {
        child.parentOccurrenceId = occurrence.parentOccurrenceId;
      }
    }
    destination.splice(insertionIndex, 0, ...directChildren);
  }
  children.delete(occurrenceId);
  removePlacement(children, occurrenceId);
  occurrences.delete(occurrenceId);
}

function placeOccurrence(
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  occurrence: MutableOccurrence,
  anchor: SequenceAnchor,
): void {
  if (!parentExists(occurrence.parentOccurrenceId, occurrences)) {
    return;
  }
  occurrences.set(occurrence.occurrenceId, occurrence);
  insertAtAnchor(listFor(children, occurrence.parentOccurrenceId), occurrence.occurrenceId, anchor);
}

function parentExists(
  parentOccurrenceId: string | null,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): boolean {
  return parentOccurrenceId === null || occurrences.has(parentOccurrenceId);
}

function createsCycle(
  occurrenceId: string,
  parentOccurrenceId: string | null,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): boolean {
  let cursor = parentOccurrenceId;
  while (cursor !== null) {
    if (cursor === occurrenceId) {
      return true;
    }
    cursor = occurrences.get(cursor)?.parentOccurrenceId ?? null;
  }
  return false;
}
