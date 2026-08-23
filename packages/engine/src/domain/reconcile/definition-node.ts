import type { DefinitionIntrinsicNodeType } from "../fact/index.js";
import type { Projection } from "./projection-types.js";
import { nodeLocation } from "./node-graph.js";

type DefinitionNodeState = "active" | "deleted" | "absent";

export function definitionNodeState(
  projection: Pick<
    Projection,
    "identity" | "nodes" | "occurrences" | "childOccurrences" | "nodeOwners" | "workspaceSystemNodes"
  >,
  definitionId: string,
  intrinsicNodeType: DefinitionIntrinsicNodeType,
): DefinitionNodeState {
  if (projection.nodes[definitionId]?.intrinsicNodeType !== intrinsicNodeType) {
    return "absent";
  }
  const location = nodeLocation(projection.identity.workspaceNodeId, projection, definitionId);
  return location === "trash" ? "deleted" : location;
}
