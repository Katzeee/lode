import type { NodeMutation } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";
import { nodeLocation } from "../node-graph.js";

export function canApplyNodeDirectTail(projection: Projection, mutation: NodeMutation): boolean {
  switch (mutation.kind) {
    case "node-create":
      return (
        projection.nodes[mutation.nodeId] === undefined &&
        !Object.values(projection.conflictIssues).some(
          (issue) => issue.kind === "unsupported-direct-intent" && issue.requiredNodeIds.includes(mutation.nodeId),
        )
      );
    case "node-delete":
      return nodeLocation(projection.identity.workspaceNodeId, projection, mutation.nodeId) === "active";
    case "node-restore":
      return nodeLocation(projection.identity.workspaceNodeId, projection, mutation.nodeId) === "trash";
    case "node-owner-set":
      return (
        projection.nodes[mutation.nodeId] !== undefined &&
        projection.nodes[mutation.ownerNodeId] !== undefined &&
        Object.values(projection.occurrences).some(
          (occurrence) => occurrence.nodeId === mutation.nodeId && occurrence.parentNodeId === mutation.ownerNodeId,
        )
      );
    case "node-type-declare":
      return false;
  }
}
