import {
  fieldContentDeletionOccurrenceId,
  isFieldContentDeletionMutation,
  type FieldMutation,
} from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyFieldDirectTail(projection: Projection, mutation: FieldMutation): boolean {
  if (isFieldContentDeletionMutation(mutation)) {
    return projection.occurrences[fieldContentDeletionOccurrenceId(mutation)] !== undefined;
  }
  switch (mutation.kind) {
    case "field-materialize":
      return (
        hasNodes(projection, mutation.ownerNodeId, mutation.fieldDefinitionId, mutation.fieldNodeId) &&
        projection.occurrences[mutation.fieldOccurrenceId]?.nodeId === mutation.fieldNodeId
      );
    case "field-initialize":
      return (
        hasNodes(projection, mutation.ownerNodeId, mutation.schemaId, mutation.fieldDefinitionId) &&
        mutation.values.every((value) => value.kind !== "reference" || projection.nodes[value.nodeId] !== undefined)
      );
  }
}

function hasNodes(projection: Projection, ...nodeIds: readonly string[]): boolean {
  return nodeIds.every((nodeId) => projection.nodes[nodeId] !== undefined);
}
