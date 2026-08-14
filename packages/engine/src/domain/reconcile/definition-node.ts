import type { DefinitionNodeType } from "../fact/index.js";
import type { Projection } from "./projection-types.js";

export type DefinitionNodeState = "active" | "deleted" | "absent";

export function definitionNodeState(
  projection: Pick<Projection, "nodes" | "nodeStatuses">,
  definitionId: string,
  nodeType: DefinitionNodeType,
): DefinitionNodeState {
  const status = projection.nodeStatuses[definitionId];
  if (status?.nodeType !== nodeType) {
    return "absent";
  }
  if (projection.nodes[definitionId]) {
    return "active";
  }
  return status.state === "deleted" ? "deleted" : "absent";
}
