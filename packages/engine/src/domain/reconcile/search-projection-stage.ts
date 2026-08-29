import { projectionStage } from "./projection-stage.js";
import { projectSearchExpressions } from "./search-expressions.js";

export const searchProjectionStage = projectionStage({
  key: "searchExpressions",
  dependencies: ["activation", "storedNodes", "nodeGraphStructure"],
  project: (context) =>
    projectSearchExpressions(
      context.workspaceNodeId,
      context.activation.actions,
      context.storedNodes,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.childOccurrences,
      context.nodeGraphStructure.nodeOwners,
      context.nodeGraphStructure.metanodes,
      context.nodeGraphStructure.workspaceSystemNodes,
    ),
});
