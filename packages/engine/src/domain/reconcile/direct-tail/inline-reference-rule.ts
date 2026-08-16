import type { InlineReferenceMutation } from "../../fact/index.js";
import { locateInlineReference } from "../node-graph.js";
import type { Projection } from "../projection-types.js";

export function canApplyInlineReferenceDirectTail(projection: Projection, mutation: InlineReferenceMutation): boolean {
  if (mutation.kind === "inline-reference-create") {
    return projection.nodes[mutation.hostNodeId] !== undefined && projection.nodes[mutation.targetNodeId] !== undefined;
  }
  const location = locateInlineReference(projection.nodes, mutation.inlineReferenceId);
  if (mutation.kind === "inline-reference-delete") {
    return location !== null;
  }
  return location !== null && projection.nodes[mutation.aliasNodeId] !== undefined;
}
