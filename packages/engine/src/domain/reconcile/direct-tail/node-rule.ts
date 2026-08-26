import type { GraphNodeAction } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";
import { nodeLocation } from "../node-graph.js";

export function canApplyNodeDirectTail(projection: Projection, action: GraphNodeAction): boolean {
  switch (action.kind) {
    case "workspace-bootstrap":
      return false;
    case "node-create":
      return (
        projection.nodes[action.nodeId] === undefined &&
        !Object.values(projection.conflictIssues).some(
          (issue) => issue.kind === "unsupported-direct-intent" && issue.requiredNodeIds.includes(action.nodeId),
        )
      );
    case "node-trash":
      return nodeLocation(projection.identity.workspaceNodeId, projection, action.nodeId) === "active";
    case "node-restore":
      return nodeLocation(projection.identity.workspaceNodeId, projection, action.nodeId) === "trash";
    case "original-promote":
      return projection.occurrences[action.placementId]?.nodeId === action.nodeId;
  }
}
