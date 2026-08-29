import { projectNodeGraphStructure } from "./node-graph-structure.js";
import { projectionStage } from "./projection-stage.js";

export const nodeGraphProjectionStage = projectionStage({
  key: "nodeGraphStructure",
  dependencies: ["activation", "storedNodes", "authoredStructure", "metanodes"],
  project: (context) =>
    projectNodeGraphStructure(
      context.workspaceNodeId,
      context.activation.actions,
      context.authoredStructure.occurrences,
      context.authoredStructure.childOccurrences,
      context.storedNodes,
      context.metanodes,
    ),
});
