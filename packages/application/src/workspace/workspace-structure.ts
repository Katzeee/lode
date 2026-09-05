import { END_SEQUENCE_ANCHOR, START_SEQUENCE_ANCHOR, type EditAction, type SequenceAnchor } from "@lode/sdk";
import type { OutlineContent } from "@lode/ui";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import { editNodeSource } from "./node-edit.js";

export function createNodeActions(
  graph: WorkspaceSnapshot,
  parentNodeId: string,
  content: OutlineContent = [],
  anchor: SequenceAnchor = END_SEQUENCE_ANCHOR,
  identity: Readonly<{ nodeId: string; occurrenceId: string }> = {
    nodeId: crypto.randomUUID(),
    occurrenceId: crypto.randomUUID(),
  },
): readonly EditAction[] {
  const { nodeId, occurrenceId } = identity;
  const field = Object.values(graph.materializedFields)
    .flat()
    .find((field) => field.fieldNodeId === parentNodeId);
  const create: EditAction = field
    ? {
        kind: "field-value-create",
        ownerNodeId: field.ownerNodeId,
        fieldDefinitionId: field.fieldDefinitionId,
        valueNodeId: nodeId,
        valueOccurrenceId: occurrenceId,
        anchor,
      }
    : { kind: "node-create", nodeId, occurrenceId, parentNodeId, anchor };
  return [create, ...editNodeSource({ nodeId, content: [], intrinsicNodeType: null }, content, graph)];
}
export function insertionParent(
  graph: WorkspaceSnapshot,
  occurrenceId: string | null,
  placement: "before" | "after" | "child",
) {
  const occurrence = occurrenceId === null ? undefined : graph.occurrences[occurrenceId];
  if (occurrenceId !== null && !occurrence) {
    throw new Error("The insertion location is no longer available");
  }
  return {
    parentNodeId: occurrence ? (placement === "child" ? occurrence.nodeId : occurrence.parentNodeId) : graph.rootNodeId,
    anchor: {
      ...(placement === "child" ? START_SEQUENCE_ANCHOR : END_SEQUENCE_ANCHOR),
      before: placement === "before" ? occurrenceId : null,
      after: placement === "after" ? occurrenceId : null,
    },
  };
}

export function removeAppearanceAction(graph: WorkspaceSnapshot, occurrenceId: string): EditAction {
  const fields = Object.values(graph.materializedFields).flat();
  const field = fields.find((field) => field.fieldOccurrenceId === occurrenceId);
  if (field) {
    return {
      kind: "materialized-field-clear",
      ownerNodeId: field.ownerNodeId,
      fieldDefinitionId: field.fieldDefinitionId,
    };
  }
  if (fields.some((field) => field.valueOccurrenceIds.includes(occurrenceId))) {
    return { kind: "field-value-remove", valuePlacementId: occurrenceId };
  }
  return { kind: "occurrence-delete", occurrenceId };
}

/** Replacement cannot anchor to the appearance it removes in the same edit. */
export function replacementAnchor(graph: WorkspaceSnapshot, occurrenceId: string): SequenceAnchor {
  const occurrence = graph.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error("The replacement location is no longer available");
  }
  const siblings = graph.childOccurrences[occurrence.parentNodeId] ?? [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: siblings[index - 1] ?? null,
    before: siblings[index + 1] ?? null,
    affinity: "after",
    fallback: index <= 0 ? "start" : "end",
  };
}
