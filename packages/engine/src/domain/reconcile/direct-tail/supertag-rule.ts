import type { SupertagAction } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplySupertagDirectTail(projection: Projection, action: SupertagAction): boolean {
  switch (action.kind) {
    case "supertag-application-add":
    case "supertag-membership-remove":
      return hasNodes(projection, action.hostNodeId, action.supertagId);
    case "template-member-add":
    case "template-member-remove":
      return hasNodes(projection, action.supertagId, action.templateNodeId);
    case "template-field-add":
    case "template-field-remove":
    case "template-field-restore":
    case "template-field-visibility-set":
    case "template-field-static-default-set":
    case "optional-field-contribution-add":
    case "optional-field-contribution-remove":
      return false;
    case "supertag-extension-add":
    case "supertag-extension-remove":
      return hasNodes(projection, action.supertagId, action.baseSupertagId);
  }
}

function hasNodes(projection: Projection, ...nodeIds: readonly string[]): boolean {
  return nodeIds.every((nodeId) => projection.nodes[nodeId] !== undefined);
}
