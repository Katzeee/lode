import { projectFieldDefinitionConfigurations } from "./field-definition-configurations.js";
import { projectionRule } from "./projection-rule.js";

export const fieldDefinitionProjectionRule = projectionRule({
  key: "field-definition",
  dependencies: ["activation", "node", "node-graph"],
  evaluate: (context) => ({
    fieldDefinitionConfigurations: projectFieldDefinitionConfigurations(
      context.workspaceNodeId,
      context.activation.actions,
      context.storedNodes,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.childOccurrences,
      context.nodeGraphStructure.nodeOwners,
      context.nodeGraphStructure.workspaceSystemNodes,
    ),
  }),
});
