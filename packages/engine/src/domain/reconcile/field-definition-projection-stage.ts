import { projectFieldDefinitionConfigurations } from "./field-definition-configurations.js";
import { projectionStage } from "./projection-stage.js";

export const fieldDefinitionProjectionStage = projectionStage({
  key: "fieldDefinitionConfigurations",
  dependencies: ["activation", "storedNodes", "nodeGraphStructure"],
  project: (context) =>
    projectFieldDefinitionConfigurations(
      context.workspaceNodeId,
      context.activation.actions,
      context.storedNodes,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.childOccurrences,
      context.nodeGraphStructure.nodeOwners,
      context.nodeGraphStructure.workspaceSystemNodes,
    ),
});
