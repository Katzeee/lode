import type { InlineReferenceAction } from "../../fact/index.js";
import { locateInlineReference } from "../node-graph.js";
import type { Projection } from "../projection-types.js";

export function canApplyInlineReferenceDirectTail(projection: Projection, action: InlineReferenceAction): boolean {
  if (action.kind === "inline-reference-create") {
    return projection.nodes[action.hostNodeId] !== undefined && projection.nodes[action.targetNodeId] !== undefined;
  }
  const location = locateInlineReference(projection.nodes, action.inlineReferenceId);
  if (action.kind === "inline-reference-remove") {
    return location !== null;
  }
  return location !== null && projection.nodes[action.aliasNodeId] !== undefined;
}
