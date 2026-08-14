import type { OccurrenceMutation } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyOccurrenceDirectTail(
  projection: Projection,
  mutation: OccurrenceMutation,
): boolean {
  switch (mutation.kind) {
    case "occurrence-create":
      return (
        projection.occurrences[mutation.occurrenceId] === undefined &&
        projection.nodes[mutation.nodeId] !== undefined &&
        projection.nodes[mutation.parentNodeId] !== undefined
      );
    case "occurrence-delete":
      return projection.occurrences[mutation.occurrenceId] !== undefined;
    case "occurrence-restore":
      return (
        projection.occurrences[mutation.occurrenceId] === undefined &&
        projection.nodes[mutation.parentNodeId] !== undefined
      );
    case "occurrence-move":
      return (
        projection.occurrences[mutation.occurrenceId] !== undefined &&
        projection.nodes[mutation.parentNodeId] !== undefined
      );
  }
}
