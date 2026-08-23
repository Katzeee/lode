import type { FieldAction } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyFieldDirectTail(projection: Projection, action: FieldAction): boolean {
  if (action.kind === "field-value-remove") {
    return projection.occurrences[action.valuePlacementId] !== undefined;
  }
  if (action.kind === "materialized-field-clear") {
    return (
      projection.materializedFields[action.ownerNodeId]?.some(
        (field) => field.fieldDefinitionId === action.fieldDefinitionId,
      ) ?? false
    );
  }
  return (
    hasNodes(projection, action.ownerNodeId, action.fieldDefinitionId, action.fieldNodeId) &&
    projection.occurrences[action.fieldOccurrenceId]?.nodeId === action.fieldNodeId
  );
}

function hasNodes(projection: Projection, ...nodeIds: readonly string[]): boolean {
  return nodeIds.every((nodeId) => projection.nodes[nodeId] !== undefined);
}
