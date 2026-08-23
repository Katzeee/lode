import type { PlacementAction } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyPlacementDirectTail(projection: Projection, action: PlacementAction): boolean {
  switch (action.kind) {
    case "placement-create":
      return (
        projection.occurrences[action.placementId] === undefined &&
        projection.nodes[action.nodeId] !== undefined &&
        projection.nodes[action.parentNodeId] !== undefined
      );
    case "placement-remove":
      return projection.occurrences[action.placementId] !== undefined;
    case "placement-move":
      return (
        projection.occurrences[action.placementId] !== undefined && projection.nodes[action.parentNodeId] !== undefined
      );
  }
}
