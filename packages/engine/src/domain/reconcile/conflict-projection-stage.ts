import { projectConflictIssues } from "./projection-conflicts.js";
import { projectionStage } from "./projection-stage.js";

export const conflictProjectionStage = projectionStage({
  key: "conflictIssues",
  dependencies: ["activation", "nodeGraphStructure", "supertagRelations"],
  project: (context) =>
    projectConflictIssues(
      context.snapshot,
      context.supertagRelations.supertagExtensionConflicts,
      context.activation.actions,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.nodeOwners,
      context.originActivation ?? context.activation.evidence,
    ),
});
