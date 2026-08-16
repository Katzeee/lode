import type { SupertagMutation } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplySupertagDirectTail(projection: Projection, mutation: SupertagMutation): boolean {
  switch (mutation.kind) {
    case "supertag-apply":
    case "supertag-remove":
      return hasNodes(projection, mutation.nodeId, mutation.supertagId);
    case "supertag-template-node-add":
    case "supertag-template-node-remove":
      return hasNodes(projection, mutation.supertagId, mutation.templateNodeId);
    case "supertag-field-add":
    case "supertag-field-remove":
    case "supertag-field-configure":
      return hasNodes(projection, mutation.supertagId, mutation.fieldDefinitionId);
    case "supertag-extension-add":
    case "supertag-extension-remove":
      return hasNodes(projection, mutation.supertagId, mutation.baseSupertagId);
  }
}

function hasNodes(projection: Projection, ...nodeIds: readonly string[]): boolean {
  return nodeIds.every((nodeId) => projection.nodes[nodeId] !== undefined);
}
