import type { SupertagMutation } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplySupertagDirectTail(projection: Projection, mutation: SupertagMutation): boolean {
  switch (mutation.kind) {
    case "supertag-apply":
    case "supertag-remove":
      return hasNodes(projection, mutation.hostNodeId, mutation.supertagId, mutation.applicationNodeId);
    case "supertag-template-node-add":
    case "supertag-template-node-remove":
      return hasNodes(projection, mutation.supertagId, mutation.templateNodeId);
    case "supertag-template-field-discoverability-set":
    case "supertag-template-field-visibility-configure":
      return hasNodes(projection, mutation.supertagId, mutation.templateFieldNodeId, mutation.fieldDefinitionId);
    case "supertag-template-field-attach":
    case "supertag-template-field-existing-attach":
    case "supertag-template-field-detach":
      return hasNodes(
        projection,
        mutation.supertagId,
        mutation.templateFieldNodeId,
        mutation.fieldDefinitionId,
        mutation.staticDefaultValueNodeId,
      );
    case "supertag-optional-field-contribution-attach":
    case "supertag-optional-field-contribution-detach":
      return hasNodes(
        projection,
        mutation.supertagId,
        mutation.fieldNurseryNodeId,
        mutation.nurseryValueNodeId,
        mutation.contributionNodeId,
        mutation.fieldDefinitionId,
        mutation.valueNodeId,
      );
    case "supertag-extension-add":
    case "supertag-extension-remove":
      return hasNodes(projection, mutation.supertagId, mutation.baseSupertagId);
  }
}

function hasNodes(projection: Projection, ...nodeIds: readonly string[]): boolean {
  return nodeIds.every((nodeId) => projection.nodes[nodeId] !== undefined);
}
