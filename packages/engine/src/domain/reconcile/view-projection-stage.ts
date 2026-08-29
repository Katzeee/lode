import { projectionStage } from "./projection-stage.js";
import { projectSharedDefaultViewDefinitions } from "./shared-default-view-definitions.js";

export const viewProjectionStage = projectionStage({
  key: "sharedDefaultViewDefinitions",
  dependencies: ["activation", "storedNodes", "nodeGraphStructure", "supertagRelations"],
  project: (context) =>
    projectSharedDefaultViewDefinitions(
      context.workspaceNodeId,
      context.activation.actions,
      context.storedNodes,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.childOccurrences,
      context.nodeGraphStructure.nodeOwners,
      context.nodeGraphStructure.metanodes,
      context.nodeGraphStructure.workspaceSystemNodes,
      context.supertagRelations.materializedFields,
    ),
});
